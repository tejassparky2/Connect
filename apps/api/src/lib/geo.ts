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

/**
 * User count within a radius — SERVER-SIDE ONLY (never return it raw: see bucketCount).
 * `cap` stops counting early (the displayed value is bucketed anyway), keeping this O(cap)
 * instead of O(everyone in range): 100k residents in range took 80 ms uncapped.
 */
export async function countUsersWithin(center: LatLng, radiusM: number, opts: { verifiedOnly?: boolean; cap?: number } = {}): Promise<number> {
  const lvl = opts.verifiedOnly ? Prisma.sql`AND "verificationLevel" IN ('LOCATION', 'ADDRESS')` : Prisma.empty;
  const pt = pointSql(center);
  if (opts.cap) {
    // KNN walk of at most `cap` nearest rows, counting those in range: always an index walk,
    // independent of PostGIS's (badly wrong for clustered data) selectivity estimates.
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) FILTER (WHERE in_range) AS n FROM (
        SELECT ST_DWithin("homeLocation", ${pt}, ${radiusM}::float8) AS in_range
        FROM users
        WHERE "homeLocation" IS NOT NULL AND "deletedAt" IS NULL AND NOT "isBanned" ${lvl}
        ORDER BY "homeLocation" <-> ${pt}
        LIMIT ${opts.cap}
      ) s`;
    return Number(rows[0].n);
  }
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM users
    WHERE "homeLocation" IS NOT NULL AND "deletedAt" IS NULL AND NOT "isBanned" ${lvl}
      AND ST_DWithin("homeLocation", ${pt}, ${radiusM}::float8)`;
  return Number(rows[0].n);
}

/** Same KNN-capped counting for recent posts in range. */
export async function countRecentPostsWithin(center: LatLng, radiusM: number, sinceDays: number, cap: number): Promise<number> {
  const pt = pointSql(center);
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) FILTER (WHERE in_range) AS n FROM (
      SELECT ST_DWithin(p.location, ${pt}, ${radiusM}::float8) AS in_range
      FROM posts p
      WHERE p.status = 'ACTIVE' AND p."createdAt" > now() - make_interval(days => ${sinceDays}::int)
      ORDER BY p.location <-> ${pt}
      LIMIT ${cap}
    ) s`;
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
 *   • ORDER BY homeLocation <-> centre (single key — see knnPage) is an index-ordered
 *     KNN scan; with LIMIT Postgres stops after a page's worth of rows instead of
 *     sorting every candidate (verified with EXPLAIN on PostgreSQL 16 and 17).
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
  const rows = await knnPage<Omit<NearbyUserRow, 'distanceM'> & { distance: number }>({
    want: limit + 1,
    maxRadiusM: opts.radiusM,
    cursor: opts.cursor,
    query: ({ orderBy, limit: n, floor, range }) => {
      const dist = Prisma.sql`u."homeLocation" <-> ${pt}`;
      const inRange = Prisma.sql`ST_DWithin(u."homeLocation", ${pt}, ${opts.radiusM}::float8)`;
      return prisma.$queryRaw`
        SELECT u.id, u.name, u."avatarUrl", u."verificationLevel"::text AS "verificationLevel",
               n.name AS "neighborhoodName", ${dist} AS distance, ${inRange} AS "inRange"
        FROM users u
        LEFT JOIN neighborhoods n ON n.id = u."neighborhoodId"
        WHERE u."homeLocation" IS NOT NULL
          AND u."deletedAt" IS NULL
          AND NOT u."isBanned"
          AND u."verificationLevel" IN ('LOCATION', 'ADDRESS')
          AND u.id <> ${opts.viewerId}::uuid
          AND NOT EXISTS (
            SELECT 1 FROM blocks b
            WHERE (b."blockerId" = ${opts.viewerId}::uuid AND b."blockedId" = u.id)
               OR (b."blockerId" = u.id AND b."blockedId" = ${opts.viewerId}::uuid)
          )
          ${range(inRange)} ${floor(dist, Prisma.sql`u.id`)}
        ORDER BY ${orderBy(dist, Prisma.sql`u.id`)}
        LIMIT ${n}`;
    },
  });

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
export function countPostsWithin(center: LatLng, radiusM: number, sinceDays = 30): Promise<number> {
  return countRecentPostsWithin(center, radiusM, sinceDays, 50);
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
  return knnPage<{ id: string; distance: number }>({
    want: opts.limit,
    maxRadiusM: opts.radiusM,
    cursor: opts.cursor,
    query: ({ orderBy, limit: n, floor, range }) => {
      const dist = Prisma.sql`b.location <-> ${pt}`;
      const inRange = Prisma.sql`ST_DWithin(b.location, ${pt}, ${opts.radiusM}::float8)`;
      return prisma.$queryRaw`
        SELECT b.id, ${dist} AS distance, ${inRange} AS "inRange"
        FROM businesses b
        WHERE b.status = 'ACTIVE' ${cat} ${q} ${range(inRange)} ${floor(dist, Prisma.sql`b.id`)}
        ORDER BY ${orderBy(dist, Prisma.sql`b.id`)}
        LIMIT ${n}`;
    },
  });
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
  // 20 km is the max serviceRadiusM, so nothing beyond it can be in range.
  return knnPage<{ id: string; distance: number }>({
    want: opts.limit,
    maxRadiusM: 20000,
    cursor: opts.cursor,
    query: ({ orderBy, limit: n, floor, range }) => {
      const dist = Prisma.sql`s.location <-> ${pt}`;
      const inRange = Prisma.sql`ST_DWithin(s.location, ${pt}, s."serviceRadiusM")`;
      return prisma.$queryRaw`
        SELECT s.id, ${dist} AS distance, ${inRange} AS "inRange"
        FROM service_providers s
        WHERE s.status = 'ACTIVE' ${skill} ${q} ${range(inRange)} ${floor(dist, Prisma.sql`s.id`)}
        ORDER BY ${orderBy(dist, Prisma.sql`s.id`)}
        LIMIT ${n}`;
    },
  });
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

// ─────────────────────────── KNN keyset pagination helper ───────────────────────────

/** Extra rows fetched beyond the page to absorb exact-distance ties at the page boundary. */
const KNN_TIE_BUFFER = 64;

type SqlFrag = Prisma.Sql;
export interface KnnParts {
  /** ORDER BY expression list. */
  orderBy: (dist: SqlFrag, id: SqlFrag) => SqlFrag;
  /** Row cap. */
  limit: number;
  /** Cursor predicate (AND …) or empty. */
  floor: (dist: SqlFrag, id: SqlFrag) => SqlFrag;
  /** Radius predicate (AND …) — empty in the fast path, where rows report `inRange` instead. */
  range: (inRange: SqlFrag) => SqlFrag;
}

/**
 * Nearest-first keyset page that is ALWAYS an index-ordered KNN walk.
 *
 * Measured on PostgreSQL 16 with 100k users inside 2 km:
 *   • `WHERE ST_DWithin(..) ORDER BY dist, id` → Seq Scan + sort (≈620 ms): PostGIS
 *     estimates ~10 matching rows when all 100k match, so the planner picks a seq scan,
 *     and two-key ordering can't use the GiST ordering before PG17 anyway.
 *   • `ORDER BY dist LIMIT n` with no radius predicate → GiST KNN walk, stops after n rows.
 * So the fast path orders by distance alone, computes `inRange` (exact spheroid
 * ST_DWithin) per row instead of filtering on it, applies the (dist, id) keyset in JS,
 * and stops once rows are past the radius. If exact-distance ties overflow the buffer,
 * it falls back to the exact (slower) query, so results are always correct.
 */
async function knnPage<T extends { id: string; distance: number }>(opts: {
  want: number;
  maxRadiusM: number;
  cursor?: { d: number; id: string } | null;
  query: (p: KnnParts) => Promise<(T & { inRange: boolean })[]>;
}): Promise<T[]> {
  const c = opts.cursor;
  const after = (r: T) => !c || r.distance > c.d || (r.distance === c.d && r.id > c.id);
  const byKey = (a: T, b: T) => a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const strip = ({ inRange: _i, ...r }: T & { inRange: boolean }) => r as unknown as T;
  const innerLimit = opts.want + KNN_TIE_BUFFER;

  const fast = await opts.query({
    orderBy: (dist) => dist,
    limit: innerLimit,
    floor: (dist) => (c ? Prisma.sql`AND ${dist} >= ${String(c.d)}::float8` : Prisma.empty),
    range: () => Prisma.empty,
  });
  const page = fast.filter((r) => r.inRange && after(r)).sort(byKey);
  const lastFetched = fast[fast.length - 1];
  // `<->` is sphere distance; ST_DWithin is spheroid (≤0.5% apart) — keep a 1% margin.
  const exhausted = fast.length < innerLimit || (lastFetched && lastFetched.distance > opts.maxRadiusM * 1.01);
  const fullAndTiesSafe = page.length >= opts.want && lastFetched.distance > page[opts.want - 1].distance;
  if (exhausted || fullAndTiesSafe) return page.slice(0, opts.want).map(strip);

  // Rare (huge exact-distance tie, or most nearby rows out of range): exact query.
  const exact = await opts.query({
    orderBy: (dist, id) => Prisma.sql`${dist}, ${id}`,
    limit: opts.want,
    floor: (dist, id) => (c ? Prisma.sql`AND (${dist}, ${id}) > (${String(c.d)}::float8, ${c.id}::uuid)` : Prisma.empty),
    range: (inRange) => Prisma.sql`AND ${inRange}`,
  });
  return exact.map(strip);
}
