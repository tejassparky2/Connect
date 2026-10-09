import { beforeAll, describe, expect, it } from 'vitest';
import { findNearbyUsers, findNeighborhoodForPoint, streamUserIdsWithin, countUsersWithin } from '../src/lib/geo';
import { bulkUsers, createNeighborhood, HSR, KORA, login, offset, prisma, resetDb, setHome } from './helpers';

/**
 * The scale scenario from the brief (10,000 users inside 2 km) — tested at 10× that:
 * 100k users in 2 km + 2k decoys in 2–6 km. Asserts correctness, index-ordered KNN and latency.
 */
describe('PostGIS: nearby-user queries at scale', () => {
  let viewerId: string;

  beforeAll(async () => {
    await resetDb();
    await bulkUsers(100_000, HSR, 2000);
    // A ring of users 2–6 km away (must never appear in a 2 km query).
    await prisma.$executeRaw`
      INSERT INTO users (id, phone, name, "verificationLevel", "homeLocation", "updatedAt")
      SELECT gen_random_uuid(), '+9160' || lpad(g::text, 8, '0'), 'Far ' || g, 'LOCATION',
             ST_Project(ST_SetSRID(ST_MakePoint(${HSR.lng}::float8, ${HSR.lat}::float8), 4326)::geography, 2100 + random() * 3900, radians(random() * 360)),
             now()
      FROM generate_series(1, 2000) g`;
    await prisma.$executeRaw`ANALYZE users`;
    const viewer = await login();
    viewerId = viewer.id;
  });

  it('counts exactly the users inside the radius', async () => {
    expect(await countUsersWithin(HSR, 2000)).toBe(100_000);
    expect(await countUsersWithin(HSR, 7000)).toBe(102_000);
  });

  it('returns nearest-first pages with bucketed distances, and keyset pagination never repeats or skips', async () => {
    const seen = new Set<string>();
    let cursor = null;
    let prevMax = 0;
    let pages = 0;
    do {
      const r: Awaited<ReturnType<typeof findNearbyUsers>> = await findNearbyUsers({ center: HSR, radiusM: 300, viewerId, limit: 100, cursor });
      for (const row of r.rows) {
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
        expect(row.distanceM % 100).toBe(0);
        expect(row.distanceM).toBeGreaterThanOrEqual(prevMax);
        prevMax = Math.max(prevMax, row.distanceM);
        expect(row.distanceM).toBeLessThanOrEqual(300);
      }
      cursor = r.nextCursor;
      pages++;
    } while (cursor && pages < 50);
    expect(seen.size).toBe(await countUsersWithin(HSR, 300));
  });

  it('is an index-ordered KNN walk (no Seq Scan, no full sort) even when every row is in range', async () => {
    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`
      EXPLAIN SELECT id, ST_DWithin("homeLocation", ST_SetSRID(ST_MakePoint(${HSR.lng}, ${HSR.lat}), 4326)::geography, 2000) AS in_range
      FROM users
      WHERE "homeLocation" IS NOT NULL AND "deletedAt" IS NULL AND NOT "isBanned"
      ORDER BY "homeLocation" <-> ST_SetSRID(ST_MakePoint(${HSR.lng}, ${HSR.lat}), 4326)::geography
      LIMIT 95`);
    const text = plan.map((p) => p['QUERY PLAN']).join('\n');
    expect(text).toMatch(/Index Scan using "?users_homeLocation_idx"?/);
    expect(text).toMatch(/Order By: \("homeLocation" <->/);
    expect(text).not.toMatch(/Seq Scan|Sort Method/);
  });

  it('first page of 30 nearest out of 100k answers in well under 100 ms', async () => {
    await findNearbyUsers({ center: HSR, radiusM: 2000, viewerId, limit: 30 }); // warm
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) await findNearbyUsers({ center: offset(HSR, i * 50, i * 30), radiusM: 2000, viewerId, limit: 30 });
    const avg = (performance.now() - t0) / 10;
    expect(avg).toBeLessThan(100);
  });

  it('streams fan-out recipients in fixed-size batches covering everyone exactly once', async () => {
    const all = new Set<string>();
    let batches = 0;
    for await (const batch of streamUserIdsWithin({ center: HSR, radiusM: 2000, batchSize: 1500 })) {
      expect(batch.length).toBeLessThanOrEqual(1500);
      batch.forEach((id) => all.add(id));
      batches++;
    }
    expect(all.size).toBe(100_000);
    expect(batches).toBe(67);
  });

  it('exact-distance ties larger than the buffer still paginate correctly (fallback path)', async () => {
    const spot = offset(HSR, 20000, 0); // far from the bulk disc AND the 2–6 km decoy ring
    await prisma.$executeRaw`
      INSERT INTO users (id, phone, "verificationLevel", "homeLocation", "updatedAt")
      SELECT gen_random_uuid(), '+9150' || lpad(g::text, 8, '0'), 'LOCATION',
             ST_SetSRID(ST_MakePoint(${spot.lng}::float8, ${spot.lat}::float8), 4326)::geography, now()
      FROM generate_series(1, 150) g`; // 150 users at the IDENTICAL point
    const seen = new Set<string>();
    let cursor = null;
    do {
      const r: Awaited<ReturnType<typeof findNearbyUsers>> = await findNearbyUsers({ center: spot, radiusM: 50, viewerId, limit: 40, cursor });
      for (const row of r.rows) {
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      cursor = r.nextCursor;
    } while (cursor);
    expect(seen.size).toBe(150);
  });

  it('excludes PHONE-only users, banned users and blocked users from the directory', async () => {
    const near = offset(HSR, 5, 5);
    const ids = await prisma.$queryRaw<{ id: string; lvl: string }[]>`
      INSERT INTO users (id, phone, "verificationLevel", "isBanned", "homeLocation", "updatedAt") VALUES
        (gen_random_uuid(), '+919111111111', 'PHONE', false, ST_SetSRID(ST_MakePoint(${near.lng}::float8, ${near.lat}::float8), 4326)::geography, now()),
        (gen_random_uuid(), '+919111111112', 'LOCATION', true, ST_SetSRID(ST_MakePoint(${near.lng}::float8, ${near.lat}::float8), 4326)::geography, now()),
        (gen_random_uuid(), '+919111111113', 'LOCATION', false, ST_SetSRID(ST_MakePoint(${near.lng}::float8, ${near.lat}::float8), 4326)::geography, now())
      RETURNING id, "verificationLevel"::text AS lvl`;
    await prisma.block.create({ data: { blockerId: ids[2].id, blockedId: viewerId } });
    const { rows } = await findNearbyUsers({ center: near, radiusM: 50, viewerId, limit: 100 });
    const got = new Set(rows.map((r) => r.id));
    for (const r of ids) expect(got.has(r.id)).toBe(false);
  });
});

describe('PostGIS: neighbourhood resolution', () => {
  beforeAll(resetDb);

  it('assigns by polygon containment, falls back to nearest centre within 2 km, else null', async () => {
    const hsr = await createNeighborhood('HSR Layout', HSR, 1500);
    const kora = await createNeighborhood('Koramangala', KORA, 1000);
    expect((await findNeighborhoodForPoint(offset(HSR, 500, 500)))?.id).toBe(hsr);
    expect((await findNeighborhoodForPoint(KORA))?.id).toBe(kora);
    // Just outside HSR's box but within 2 km of its centre → nearest centre.
    expect((await findNeighborhoodForPoint(offset(HSR, -1700, 0)))?.id).toBe(hsr);
    expect(await findNeighborhoodForPoint({ lat: 13.2, lng: 77.9 })).toBeNull();
  });

  it('setting a home address assigns the neighbourhood and updates member counts', async () => {
    const u = await login();
    const me = await setHome(u, offset(HSR, 100, 100));
    expect(me.neighborhood.name).toBe('HSR Layout');
    const hood = await prisma.neighborhood.findFirstOrThrow({ where: { name: 'HSR Layout' } });
    expect(hood.memberCount).toBe(1);
    // Moving to Koramangala moves the count.
    const moved = await setHome(u, KORA);
    expect(moved.neighborhood.name).toBe('Koramangala');
    expect((await prisma.neighborhood.findFirstOrThrow({ where: { name: 'HSR Layout' } })).memberCount).toBe(0);
  });

  it('rejects homes outside India', async () => {
    const u = await login();
    const r = await u.put('/v1/me/address', { unit: '1', locality: 'Soho', city: 'London', pincode: '560102', lat: 51.5, lng: -0.12 });
    expect(r.status).toBe(400);
  });

  it('the DB refuses to commit a post without a location (deferred constraint trigger)', async () => {
    const u = await login();
    await expect(prisma.post.create({ data: { authorId: u.id, body: 'no location' } })).rejects.toThrow(/location is required|Null constraint violation/);
  });
});
