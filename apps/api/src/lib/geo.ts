/**
 * PostGIS access layer.
 *
 * Prisma can't read/write `geography` columns, so every spatial read/write goes
 * through the tagged-template helpers below. `Prisma.sql` parameterises every
 * value, so none of this is injectable.
 *
 * Performance rules followed everywhere in this file
 * ──────────────────────────────────────────────────
 *  1. Filter with ST_DWithin(geog, centre, metres) — it is index-aware (GIST)
 *     and does a bounding-box pre-filter before the exact spheroid check.
 *     Never filter with `ST_Distance(...) < r` — that forces a full scan.
 *  2. Centre points are passed as literal parameters (not joined from another
 *     row), so the planner always sees a constant and picks the GIST index.
 *  3. Order "nearest first" with the KNN operator `<->`, which walks the GIST
 *     index in distance order and stops after LIMIT rows — querying the
 *     nearest 50 of 10,000 users touches ~50 index entries, not 10,000.
 *  4. Paginate with keyset cursors (distance,id) / (createdAt,id); never OFFSET.
 *     For distance cursors the SAME expression (`<->`, sphere distance) is used
 *     for ORDER BY, the cursor predicate and the returned value. Mixing it with
 *     ST_Distance (spheroid, ~0.3% different) makes pages skip/repeat rows.
 *     The cursor distance is bound as a string: Prisma serialises JS floats
 *     with ~15 significant digits, which would re-include the cursor row.
 *  5. Distances returned to clients are bucketed (rounded up to 100 m) so that
 *     nobody can trilaterate a neighbour's flat.
 */
import { Prisma, PostType } from '@prisma/client';
import { prisma } from './prisma';
import { likeEscape } from './validators';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Roughly the bounding box of India (incl. islands) — rejects swapped/garbage coords. */
export function isInIndia({ lat, lng }: LatLng): boolean {
  return lat >= 6 && lat <= 37.5 && lng >= 68 && lng <= 97.5;
}

/** SQL fragment for a geography point. Note PostGIS takes (lng, lat) order. */
export function pointSql({ lat, lng }: LatLng): Prisma.Sql {
  return Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography`;
}

/**
 * Privacy-preserving point: snap to a ~150 m grid (0.0015° ≈ 166 m N-S,
 * ~150 m E-W at Indian latitudes). Deterministic, so averaging many posts
 * can't recover the true location (unlike random jitter).
 */
export function fuzzedPointSql(p: LatLng): Prisma.Sql {
  return Prisma.sql`ST_SnapToGrid(ST_SetSRID(ST_MakePoint(${p.lng}::float8, ${p.lat}::float8), 4326), 0.0015)::geography`;
}

/** Round a distance up to the next 100 m for display. */
export function bucketDistance(m: number): number {
  return Math.max(100, Math.ceil(m / 100) * 100);
}

export function clampRadius(r: number | undefined, min: number, max: number, fallback: number): number {
  if (r == null || Number.isNaN(r)) return fallback;
  return Math.min(max, Math.max(min, Math.round(r)));
}

// ─────────────────────────── Generic setters / getters ───────────────────────────

type GeoTable = 'users' | 'addresses' | 'societies' | 'posts' | 'businesses' | 'service_providers' | 'ad_campaigns' | 'location_checks';
type GeoColumn = 'homeLocation' | 'location';

const ALLOWED: Record<GeoTable, GeoColumn> = {
  users: 'homeLocation',
  addresses: 'location',
  societies: 'location',
  posts: 'location',
  businesses: 'location',
  service_providers: 'location',
  ad_campaigns: 'location',
  location_checks: 'location',
};

/** Write a point column. Table/column come from a fixed allow-list (identifiers can't be parameterised). */
export async function setPoint(
  table: GeoTable,
  id: string,
  p: LatLng,
  opts: { fuzz?: boolean; tx?: Prisma.TransactionClient } = {},
): Promise<void> {
  const column = ALLOWED[table];
  const db = opts.tx ?? prisma;
  const value = opts.fuzz ? fuzzedPointSql(p) : pointSql(p);
  await db.$executeRaw`UPDATE ${Prisma.raw(`"${table}"`)} SET ${Prisma.raw(`"${column}"`)} = ${value} WHERE id = ${id}::uuid`;
}

export async function getPoint(table: GeoTable, id: string): Promise<LatLng | null> {
  const column = ALLOWED[table];
  const rows = await prisma.$queryRaw<{ lat: number | null; lng: number | null }[]>`
    SELECT ST_Y(${Prisma.raw(`"${column}"`)}::geometry) AS lat, ST_X(${Prisma.raw(`"${column}"`)}::geometry) AS lng
    FROM ${Prisma.raw(`"${table}"`)} WHERE id = ${id}::uuid`;
  const r = rows[0];
  return r && r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : null;
}

/** The user's verified home pin — the immutable centre of all their geo queries. */
export function getUserHome(userId: string): Promise<LatLng | null> {
  return getPoint('users', userId);
}

export async function distanceBetween(a: LatLng, b: LatLng): Promise<number> {
  const rows = await prisma.$queryRaw<{ d: number }[]>`SELECT ST_Distance(${pointSql(a)}, ${pointSql(b)}) AS d`;
  return rows[0].d;
}

// ─────────────────────────── Neighbourhoods ───────────────────────────

/**
 * Resolve which neighbourhood a point falls in. Prefer polygon containment
 * (ST_Covers on the GIST-indexed boundary); fall back to the nearest seeded
 * neighbourhood centre within 2 km so edge-of-polygon users still get a home.
 */
export async function findNeighborhoodForPoint(p: LatLng): Promise<{ id: string; name: string } | null> {
  const pt = pointSql(p);
  const inside = await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT id, name FROM neighborhoods
    WHERE ST_Covers(boundary, ${pt})
    ORDER BY ST_Area(boundary) ASC
    LIMIT 1`;
  if (inside[0]) return inside[0];
  const near = await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT id, name FROM neighborhoods
    WHERE ST_DWithin(center, ${pt}, 2000)
    ORDER BY center <-> ${pt}
    LIMIT 1`;
  return near[0] ?? null;
}

/** Exact count — SERVER-SIDE ONLY (never return it raw: see bucketCount). */
export async function countUsersWithin(center: LatLng, radiusM: number, opts: { verifiedOnly?: boolean } = {}): Promise<number> {
  const lvl = opts.verifiedOnly ? Prisma.sql`AND "verificationLevel" IN ('LOCATION', 'ADDRESS')` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM users
    WHERE "homeLocation" IS NOT NULL AND "deletedAt" IS NULL AND NOT "isBanned" ${lvl}
      AND ST_DWithin("homeLocation", ${pointSql(center)}, ${radiusM}::float8)`;
  return Number(rows[0].n);
}

/**
 * Coarse, monotone bucketing for any user count shown to clients.
 * An exact count is a location oracle: move a disc's edge across a victim and
 * watch the count flip 0→1 (an audit recovered a home to 0 m this way).
 * Buckets: <10 → 0 ("fewer than 10"), then 10s, 50s, 100s.
 */
export function bucketCount(n: number): number {
  if (n < 10) return 0;
  if (n < 100) return Math.floor(n / 10) * 10;
  if (n < 1000) return Math.floor(n / 50) * 50;
  return Math.floor(n / 100) * 100;
}

// ─────────────────────────── Nearby users (the hard one) ───────────────────────────

export interface NearbyUserRow {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  verificationLevel: string;
  neighborhoodName: string | null;
  distanceM: number;
}

export interface NearbyUsersCursor {
  d: number; // exact distance of the last row (server-side only, opaque to clients)
  id: string;
}

/**
 * Page through users near a centre, nearest first.
 *
 * Why this survives 10,000+ users in a 2 km radius:
 *   • ST_DWithin bounds the candidate set using the GIST index on homeLocation.
 *   • ORDER BY homeLocation <-> centre is an index-ordered KNN scan; with LIMIT
 *     Postgres stops after `limit + 1` rows instead of sorting all 10k.
 *   • The keyset predicate (distance, id) > (cursor.d, cursor.id) makes page N
 *     cost the same as page 1. OFFSET would re-scan all previous pages.
 *   • Only LOCATION/ADDRESS-verified, non-banned, non-deleted, non-blocked
 *     users are returned; the caller is excluded.
 */
export async function findNearbyUsers(opts: {
  center: LatLng;
  radiusM: number;
  viewerId: string;
  limit?: number;
  cursor?: NearbyUsersCursor | null;
}): Promise<{ rows: NearbyUserRow[]; nextCursor: NearbyUsersCursor | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const pt = pointSql(opts.center);
  const cursorClause = opts.cursor
    ? Prisma.sql`AND (u."homeLocation" <-> ${pt}, u.id) > (${String(opts.cursor.d)}::float8, ${opts.cursor.id}::uuid)`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<(Omit<NearbyUserRow, 'distanceM'> & { distance: number })[]>`
    SELECT u.id, u.name, u."avatarUrl", u."verificationLevel"::text AS "verificationLevel",
           n.name AS "neighborhoodName",
           u."homeLocation" <-> ${pt} AS distance
    FROM users u
    LEFT JOIN neighborhoods n ON n.id = u."neighborhoodId"
    WHERE u."homeLocation" IS NOT NULL
      AND u."deletedAt" IS NULL
      AND NOT u."isBanned"
      AND u."verificationLevel" IN ('LOCATION', 'ADDRESS')
      AND u.id <> ${opts.viewerId}::uuid
      AND ST_DWithin(u."homeLocation", ${pt}, ${opts.radiusM}::float8)
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b."blockerId" = ${opts.viewerId}::uuid AND b."blockedId" = u.id)
           OR (b."blockerId" = u.id AND b."blockedId" = ${opts.viewerId}::uuid)
      )
      ${cursorClause}
    ORDER BY u."homeLocation" <-> ${pt}, u.id
    LIMIT ${limit + 1}`;

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    // Filter is spheroid (ST_DWithin), display is sphere (<->): cap so an edge row never shows "beyond" the radius.
    rows: page.map(({ distance, ...r }) => ({ ...r, distanceM: bucketDistance(Math.min(distance, opts.radiusM)) })),
    nextCursor: hasMore && last ? { d: last.distance, id: last.id } : null,
  };
}

/**
 * Stream ids of every user within a radius in fixed-size batches, for
 * notification fan-out (e.g. an emergency alert). Keyed by id (not distance)
 * because order doesn't matter and id keyset is the cheapest stable cursor.
 * Memory stays O(batchSize) even for 100k recipients.
 */
export async function* streamUserIdsWithin(opts: {
  center: LatLng;
  radiusM: number;
  excludeUserId?: string;
  batchSize?: number;
}): AsyncGenerator<string[]> {
  const batch = opts.batchSize ?? 500;
  const pt = pointSql(opts.center);
  let after = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users
      WHERE "homeLocation" IS NOT NULL AND "deletedAt" IS NULL AND NOT "isBanned"
        AND id > ${after}::uuid
        AND id <> ${opts.excludeUserId ?? '00000000-0000-0000-0000-000000000000'}::uuid
        AND ST_DWithin("homeLocation", ${pt}, ${opts.radiusM}::float8)
      ORDER BY id
      LIMIT ${batch}`;
    if (!rows.length) return;
    yield rows.map((r) => r.id);
    if (rows.length < batch) return;
    after = rows[rows.length - 1].id;
  }
}

// ─────────────────────────── Feed ───────────────────────────

export interface FeedCursor {
  t: string; // createdAt ISO
  id: string;
  r: number; // radius locked for the whole scroll session
}

/**
 * Geo-fenced, reverse-chronological feed page.
 * Returns post ids (+ bucketed distance); the caller hydrates them via Prisma.
 */
export async function queryFeedIds(opts: {
  center: LatLng;
  radiusM: number;
  viewerId: string;
  types?: PostType[];
  cursor?: FeedCursor | null;
  limit: number;
  authorId?: string;
}): Promise<{ id: string; distanceM: number; createdAt: Date }[]> {
  const pt = pointSql(opts.center);
  const typeClause = opts.types?.length
    ? Prisma.sql`AND p.type = ANY(${opts.types}::"PostType"[])`
    : Prisma.empty;
  const cursorClause = opts.cursor
    ? Prisma.sql`AND (p."createdAt", p.id) < ((${opts.cursor.t}::timestamptz AT TIME ZONE 'UTC'), ${opts.cursor.id}::uuid)`
    : Prisma.empty;
  const authorClause = opts.authorId ? Prisma.sql`AND p."authorId" = ${opts.authorId}::uuid` : Prisma.empty;

  const rows = await prisma.$queryRaw<{ id: string; distance: number; createdAt: Date }[]>`
    SELECT p.id, p."createdAt", ST_Distance(p.location, ${pt}) AS distance
    FROM posts p
    WHERE p.status = 'ACTIVE'
      AND ST_DWithin(p.location, ${pt}, ${opts.radiusM}::float8)
      AND (p."expiresAt" IS NULL OR p."expiresAt" > now())
      ${typeClause}
      ${authorClause}
      ${cursorClause}
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b."blockerId" = ${opts.viewerId}::uuid AND b."blockedId" = p."authorId")
           OR (b."blockerId" = p."authorId" AND b."blockedId" = ${opts.viewerId}::uuid)
      )
    ORDER BY p."createdAt" DESC, p.id DESC
    LIMIT ${opts.limit}`;
  return rows.map((r) => ({ id: r.id, createdAt: r.createdAt, distanceM: bucketDistance(r.distance) }));
}

/** How many live posts exist within a radius — used for adaptive cold-start radius. */
export async function countPostsWithin(center: LatLng, radiusM: number, sinceDays = 30): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM (
      SELECT 1 FROM posts p
      WHERE p.status = 'ACTIVE'
        AND p."createdAt" > now() - make_interval(days => ${sinceDays}::int)
        AND ST_DWithin(p.location, ${pointSql(center)}, ${radiusM}::float8)
      LIMIT 50
    ) s`;
  return Number(rows[0].n);
}

/** Active high-severity alerts near the user in the last 24h (pinned above the feed). */
export async function queryActiveAlertIds(center: LatLng, radiusM: number, viewerId: string): Promise<{ id: string; distanceM: number }[]> {
  const pt = pointSql(center);
  const rows = await prisma.$queryRaw<{ id: string; distance: number }[]>`
    SELECT p.id, ST_Distance(p.location, ${pt}) AS distance
    FROM posts p
    WHERE p.status = 'ACTIVE' AND p.type = 'ALERT'
      AND p.severity IN ('WARNING', 'CRITICAL')
      AND p."createdAt" > now() - interval '24 hours'
      AND (p."expiresAt" IS NULL OR p."expiresAt" > now())
      AND ST_DWithin(p.location, ${pt}, ${radiusM}::float8)
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b."blockerId" = ${viewerId}::uuid AND b."blockedId" = p."authorId")
    ORDER BY p.severity DESC, p."createdAt" DESC
    LIMIT 3`;
  return rows.map((r) => ({ id: r.id, distanceM: bucketDistance(r.distance) }));
}

// ─────────────────────────── Directory (businesses / workers) ───────────────────────────

export interface DirectoryCursor {
  d: number;
  id: string;
}

export async function queryNearbyBusinessIds(opts: {
  center: LatLng;
  radiusM: number;
  category?: string;
  q?: string;
  limit: number;
  cursor?: DirectoryCursor | null;
}): Promise<{ id: string; distance: number }[]> {
  const pt = pointSql(opts.center);
  const cat = opts.category ? Prisma.sql`AND b.category = ${opts.category}::"BusinessCategory"` : Prisma.empty;
  const q = opts.q ? Prisma.sql`AND (b.name ILIKE ${'%' + likeEscape(opts.q) + '%'} OR b.description ILIKE ${'%' + likeEscape(opts.q) + '%'})` : Prisma.empty;
  const cur = opts.cursor
    ? Prisma.sql`AND (b.location <-> ${pt}, b.id) > (${String(opts.cursor.d)}::float8, ${opts.cursor.id}::uuid)`
    : Prisma.empty;
  return prisma.$queryRaw<{ id: string; distance: number }[]>`
    SELECT b.id, b.location <-> ${pt} AS distance
    FROM businesses b
    WHERE b.status = 'ACTIVE'
      AND ST_DWithin(b.location, ${pt}, ${opts.radiusM}::float8)
      ${cat} ${q} ${cur}
    ORDER BY b.location <-> ${pt}, b.id
    LIMIT ${opts.limit}`;
}

/** Workers whose own service radius covers the viewer (not just "near me"). */
export async function queryNearbyProviderIds(opts: {
  center: LatLng;
  skill?: string;
  q?: string;
  limit: number;
  cursor?: DirectoryCursor | null;
}): Promise<{ id: string; distance: number }[]> {
  const pt = pointSql(opts.center);
  const skill = opts.skill ? Prisma.sql`AND ${opts.skill}::"ServiceSkill" = ANY(s.skills)` : Prisma.empty;
  const q = opts.q ? Prisma.sql`AND s.name ILIKE ${'%' + likeEscape(opts.q) + '%'}` : Prisma.empty;
  const cur = opts.cursor
    ? Prisma.sql`AND (s.location <-> ${pt}, s.id) > (${String(opts.cursor.d)}::float8, ${opts.cursor.id}::uuid)`
    : Prisma.empty;
  // 20 km is the max serviceRadiusM, so it's a safe index-friendly outer bound.
  return prisma.$queryRaw<{ id: string; distance: number }[]>`
    SELECT s.id, s.location <-> ${pt} AS distance
    FROM service_providers s
    WHERE s.status = 'ACTIVE'
      AND ST_DWithin(s.location, ${pt}, 20000)
      AND ST_DWithin(s.location, ${pt}, s."serviceRadiusM")
      ${skill} ${q} ${cur}
    ORDER BY s.location <-> ${pt}, s.id
    LIMIT ${opts.limit}`;
}

/** Societies near a point (for "find your society" during onboarding). */
export async function queryNearbySocieties(center: LatLng, radiusM: number, q?: string, limit = 20) {
  const pt = pointSql(center);
  const qc = q ? Prisma.sql`AND s.name ILIKE ${'%' + likeEscape(q) + '%'}` : Prisma.empty;
  return prisma.$queryRaw<{ id: string; name: string; addressLine: string; city: string; isVerified: boolean; memberCount: number; type: string; distance: number }[]>`
    SELECT s.id, s.name, s."addressLine", s.city, s."isVerified", s."memberCount", s.type::text AS type,
           ST_Distance(s.location, ${pt}) AS distance
    FROM societies s
    WHERE ST_DWithin(s.location, ${pt}, ${radiusM}::float8) ${qc}
    ORDER BY s.location <-> ${pt}
    LIMIT ${limit}`;
}

/** Is a point inside a society's compound (polygon if present, else 250 m radius)? */
export async function isPointInSociety(societyId: string, p: LatLng): Promise<{ inside: boolean; distanceM: number }> {
  const pt = pointSql(p);
  const rows = await prisma.$queryRaw<{ inside: boolean; distance: number }[]>`
    SELECT CASE WHEN boundary IS NOT NULL THEN ST_Covers(boundary, ${pt})
                ELSE ST_DWithin(location, ${pt}, 250) END AS inside,
           ST_Distance(location, ${pt}) AS distance
    FROM societies WHERE id = ${societyId}::uuid`;
  return rows[0] ? { inside: rows[0].inside, distanceM: rows[0].distance } : { inside: false, distanceM: Infinity };
}

// ─────────────────────────── Ads ───────────────────────────

/**
 * Eligible ad campaigns for a viewer: ACTIVE, in flight, budget remaining, and
 * the viewer's home inside the campaign's own targeting radius. Weighted
 * random by CPM bid so higher bids win more often without starving small shops.
 */
export async function queryEligibleAdIds(center: LatLng, limit: number): Promise<string[]> {
  const pt = pointSql(center);
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c.id FROM ad_campaigns c
    WHERE c.status = 'ACTIVE'
      AND now() BETWEEN c."startAt" AND c."endAt"
      AND c."spentPaise" < c."budgetPaise"
      AND ST_DWithin(c.location, ${pt}, 10000)
      AND ST_DWithin(c.location, ${pt}, c."radiusM")
    ORDER BY -ln(greatest(random(), 1e-9)) / c."cpmPaise" ASC
    LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

// ─────────────────────────── Create rows that carry a point ───────────────────────────

/**
 * Create a row with Prisma and set its point column in the SAME transaction.
 * The deferred `*_location_required` trigger rejects the commit if the point
 * is missing, so a half-written row can never be persisted.
 */
export async function createWithPoint<T extends { id: string }>(
  table: GeoTable,
  point: LatLng,
  create: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: { fuzz?: boolean; after?: (tx: Prisma.TransactionClient, row: T) => Promise<void> } = {},
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const row = await create(tx);
    await setPoint(table, row.id, point, { tx, fuzz: opts.fuzz });
    if (opts.after) await opts.after(tx, row);
    return row;
  });
}
