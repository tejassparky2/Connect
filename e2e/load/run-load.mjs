/**
 * HTTP load test: seeded demo data + 100k residents and 20k posts around HSR Layout.
 *   PGPASSWORD=postgres node load/run-load.mjs
 * Prints throughput and latency percentiles per endpoint and fails on any non-2xx.
 */
import { execSync, spawn } from 'node:child_process';
import autocannon from 'autocannon';

const ROOT = new URL('../..', import.meta.url).pathname;
const DB = 'postgresql://postgres:postgres@localhost:5432/mohalla_load?schema=public';
const PORT = 4700;
const BASE = `http://localhost:${PORT}`;
const sh = (cmd, cwd = ROOT) => execSync(cmd, { cwd, stdio: 'pipe', env: { ...process.env, DATABASE_URL: DB } }).toString();

sh(`psql -h localhost -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='mohalla_load'" | grep -q 1 || psql -h localhost -U postgres -c 'CREATE DATABASE mohalla_load'`);
sh('npx prisma migrate deploy', `${ROOT}apps/api`);
sh('npx tsx prisma/seed.ts', `${ROOT}apps/api`);
sh(`psql "${DB.split('?')[0]}" -q -c "
  INSERT INTO users (id, phone, name, \\"verificationLevel\\", \\"homeLocation\\", \\"updatedAt\\")
  SELECT gen_random_uuid(), '+9170' || lpad(g::text, 8, '0'), 'Load ' || g, 'LOCATION',
         ST_Project(ST_SetSRID(ST_MakePoint(77.6474, 12.9116), 4326)::geography, sqrt(random()) * 3000, radians(random() * 360)), now()
  FROM generate_series(1, 100000) g;
  INSERT INTO posts (id, \\"authorId\\", body, type, location, \\"createdAt\\", \\"updatedAt\\")
  SELECT gen_random_uuid(), (SELECT id FROM users WHERE phone = '+919900000002'), 'Load post ' || g, 'GENERAL',
         ST_SnapToGrid(ST_Project(ST_SetSRID(ST_MakePoint(77.6474, 12.9116), 4326)::geography, sqrt(random()) * 3000, radians(random() * 360))::geometry, 0.0015)::geography,
         now() - random() * interval '30 days', now()
  FROM generate_series(1, 20000) g;
  ANALYZE;"`);

const api = spawn('npx', ['tsx', 'src/server.ts'], {
  cwd: `${ROOT}apps/api`,
  env: { ...process.env, NODE_ENV: 'development', PORT: String(PORT), DATABASE_URL: DB, OTP_PROVIDER: 'dev', LOG_LEVEL: 'error', RATE_LIMIT_PER_MIN: '10000000' },
  stdio: 'inherit',
  detached: true,
});
const stop = () => { try { process.kill(-api.pid, 'SIGTERM'); } catch {} };
process.on('exit', stop);
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${BASE}/health`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const otp = await (await fetch(`${BASE}/v1/auth/otp/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"phone":"9900000002"}' })).json();
const login = await (await fetch(`${BASE}/v1/auth/otp/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '9900000002', code: otp.devCode }) })).json();
const headers = { authorization: `Bearer ${login.accessToken}` };

const targets = ['/v1/feed', '/v1/me/neighbors', '/v1/businesses', '/v1/providers', '/v1/me/neighborhood', '/v1/me/badges'];
const results = [];
let failed = false;
for (const path of targets) {
  const r = await autocannon({ url: `${BASE}${path}`, connections: 50, duration: 10, headers });
  const bad = r.non2xx + r.errors + r.timeouts;
  if (bad) failed = true;
  results.push({ endpoint: path, 'req/s': Math.round(r.requests.average), p50: r.latency.p50, p97_5: r.latency.p97_5, p99: r.latency.p99, max: r.latency.max, errors: bad, total: r.requests.total });
}
console.log('\nLoad test: 50 concurrent connections × 10 s per endpoint; 100k residents + 20k posts within 3 km');
console.table(results);
stop();
process.exit(failed ? 1 : 0);
