import request from 'supertest';
import { Prisma } from '@prisma/client';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { drainJobs } from '../src/services/jobs';
import { recomputeLevel } from '../src/services/verification';

export const app = createApp();
export { prisma, drainJobs };

export type P = { lat: number; lng: number };
export const HSR: P = { lat: 12.9116, lng: 77.6474 };
export const KORA: P = { lat: 12.9352, lng: 77.6245 };
/** ~2,500 km away — never inside any radius. */
export const DELHI: P = { lat: 28.6139, lng: 77.209 };

/** Offset a point by metres north / east. */
export const offset = (p: P, northM: number, eastM: number): P => ({
  lat: p.lat + northM / 111_320,
  lng: p.lng + eastM / (111_320 * Math.cos((p.lat * Math.PI) / 180)),
});

export async function resetDb() {
  await drainJobs();
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
}

let phoneSeq = 0;
export const nextPhone = () => `+9198${String(76500000 + ++phoneSeq + Math.floor(Math.random() * 100000)).padStart(8, '0').slice(-8)}`;

export interface TestUser {
  id: string;
  phone: string;
  token: string;
  refreshToken: string;
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
  del: (url: string, body?: object) => request.Test;
}

export function asUser(token: string) {
  const h = { Authorization: `Bearer ${token}` };
  return {
    get: (url: string) => request(app).get(url).set(h),
    post: (url: string, body: object = {}) => request(app).post(url).set(h).send(body),
    put: (url: string, body: object = {}) => request(app).put(url).set(h).send(body),
    patch: (url: string, body: object = {}) => request(app).patch(url).set(h).send(body),
    del: (url: string, body: object = {}) => request(app).delete(url).set(h).send(body),
  };
}

/** Full OTP login through the public API (dev provider echoes the code). */
export async function login(phone = nextPhone(), name?: string): Promise<TestUser> {
  const r1 = await request(app).post('/v1/auth/otp/request').send({ phone });
  if (r1.status !== 200) throw new Error(`otp request failed: ${r1.status} ${JSON.stringify(r1.body)}`);
  const r2 = await request(app).post('/v1/auth/otp/verify').send({ phone, code: r1.body.devCode });
  if (r2.status !== 200) throw new Error(`otp verify failed: ${r2.status} ${JSON.stringify(r2.body)}`);
  const u = { id: r2.body.user.id, phone: r2.body.user.phone, token: r2.body.accessToken, refreshToken: r2.body.refreshToken, ...asUser(r2.body.accessToken) };
  if (name) await u.patch('/v1/me', { name });
  return u;
}

export async function setHome(u: TestUser, p: P, extra: Partial<{ unit: string; locality: string }> = {}) {
  const r = await u.put('/v1/me/address', { unit: extra.unit ?? 'A-101', locality: extra.locality ?? 'HSR Layout', city: 'Bengaluru', pincode: '560102', lat: p.lat, lng: p.lng });
  if (r.status !== 200) throw new Error(`setHome failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

/** Home + two passing on-device GPS checks → LOCATION level (gap is 0h in tests). */
export async function locationVerified(name?: string, p: P = HSR) {
  const u = await login(undefined, name);
  await setHome(u, p);
  for (let i = 0; i < 2; i++) {
    const r = await u.post('/v1/me/verification/gps', { lat: p.lat, lng: p.lng, accuracyM: 15 });
    if (!r.body.passed) throw new Error(`gps failed ${JSON.stringify(r.body)}`);
  }
  return u;
}

/** LOCATION + address marked verified (shortcut for tests not about the vouch/RWA paths). */
export async function addressVerified(name?: string, p: P = HSR) {
  const u = await locationVerified(name, p);
  await prisma.address.updateMany({ where: { userId: u.id, isPrimary: true }, data: { status: 'VERIFIED', method: 'DOCUMENT', verifiedAt: new Date() } });
  await recomputeLevel(u.id);
  return u;
}

export async function makeAdmin(u: TestUser) {
  await prisma.user.update({ where: { id: u.id }, data: { platformRole: 'ADMIN' } });
}

export async function createNeighborhood(name: string, center: P, halfM: number) {
  const sw = offset(center, -halfM, -halfM);
  const ne = offset(center, halfM, halfM);
  const gj = { type: 'MultiPolygon', coordinates: [[[[sw.lng, sw.lat], [ne.lng, sw.lat], [ne.lng, ne.lat], [sw.lng, ne.lat], [sw.lng, sw.lat]]]] };
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO neighborhoods (id, name, slug, city, state, boundary, center)
    VALUES (gen_random_uuid(), ${name}, ${name.toLowerCase().replace(/\W+/g, '-') + '-' + Date.now()}, 'Bengaluru', 'Karnataka',
            ST_GeomFromGeoJSON(${JSON.stringify(gj)})::geography,
            ST_SetSRID(ST_MakePoint(${center.lng}::float8, ${center.lat}::float8), 4326)::geography)
    RETURNING id`;
  return rows[0].id;
}

/** Bulk-insert N verified users around a point straight in SQL (for scale tests). */
export async function bulkUsers(n: number, center: P, maxRadiusM: number, level: 'LOCATION' | 'PHONE' = 'LOCATION') {
  await prisma.$executeRaw`
    INSERT INTO users (id, phone, name, "verificationLevel", "homeLocation", "updatedAt")
    SELECT gen_random_uuid(), '+9170' || lpad(g::text, 8, '0'), 'Bulk ' || g, ${level}::"VerificationLevel",
           ST_Project(ST_SetSRID(ST_MakePoint(${center.lng}::float8, ${center.lat}::float8), 4326)::geography,
                      sqrt(random()) * ${maxRadiusM}::float8, radians(random() * 360)),
           now()
    FROM generate_series(1, ${n}::int) g`;
}

export const sql = Prisma.sql;
