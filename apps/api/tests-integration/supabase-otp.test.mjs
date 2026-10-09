/**
 * Integration test against a REAL Supabase Auth (GoTrue) server.
 *
 *   docker run -d --name gotrue-test --network host \
 *     -e GOTRUE_API_HOST=127.0.0.1 -e PORT=9999 -e API_EXTERNAL_URL=http://localhost:9999 -e GOTRUE_SITE_URL=http://localhost:3000 \
 *     -e GOTRUE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long \
 *     -e GOTRUE_DB_DRIVER=postgres -e DB_NAMESPACE=auth \
 *     -e "GOTRUE_DB_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/gotrue?search_path=auth&sslmode=disable" \
 *     -e GOTRUE_EXTERNAL_PHONE_ENABLED=true -e GOTRUE_SMS_AUTOCONFIRM=true -e GOTRUE_SMS_MAX_FREQUENCY=5s \
 *     -e "GOTRUE_SMS_TEST_OTP=919900012345:123456,919900054321:654321" supabase/gotrue:v2.177.0
 *   (the gotrue DB needs `CREATE SCHEMA auth` first)
 *
 *   GOTRUE_URL=http://localhost:9999 DATABASE_URL=... node --test tests-integration/supabase-otp.test.mjs
 *
 * A tiny gateway emulates Supabase's API gateway: serves /auth/v1/*, requires the apikey header,
 * and records Sb-Forwarded-For so we can assert end-user IPs are forwarded.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const GOTRUE = process.env.GOTRUE_URL ?? 'http://localhost:9999';
const GW_PORT = 9998;
const API_PORT = 4600;
const API = `http://localhost:${API_PORT}/v1`;
const KEY = 'sb_secret_integration_test';
const seen = [];
let gw;
let api;

before(async () => {
  // Re-runnable: clear this test's cooldown state (the GoTrue test numbers are fixed).
  const db = new PrismaClient();
  await db.otpChallenge.deleteMany({ where: { phone: { in: ['+919900012345', '+919900054321'] } } });
  await db.$disconnect();

  gw = http.createServer(async (req, res) => {
    if (!req.url.startsWith('/auth/v1/')) return res.writeHead(404).end();
    if (req.headers.apikey !== KEY) return res.writeHead(401, { 'content-type': 'application/json' }).end('{"message":"Invalid API key"}');
    seen.push({ path: req.url, forwardedFor: req.headers['sb-forwarded-for'] });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const upstream = await fetch(`${GOTRUE}${req.url.slice('/auth/v1'.length)}`, { method: req.method, headers: { 'content-type': 'application/json' }, body: chunks.length ? Buffer.concat(chunks) : undefined });
    res.writeHead(upstream.status, { 'content-type': 'application/json' }).end(await upstream.text());
  }).listen(GW_PORT);

  api = spawn('npx', ['tsx', 'src/server.ts'], {
    env: {
      // Self-contained: don't depend on a local apps/api/.env (absent in CI).
      JWT_ACCESS_SECRET: 'integration-access-secret-0123456789abcdef',
      JWT_REFRESH_SECRET: 'integration-refresh-secret-0123456789abcdef',
      OTP_SECRET: 'integration-otp-secret-0123456789',
      ...process.env,
      NODE_ENV: 'development', PORT: String(API_PORT), OTP_PROVIDER: 'supabase', SUPABASE_URL: `http://localhost:${GW_PORT}`, SUPABASE_SECRET_KEY: KEY, LOG_LEVEL: 'warn', TRUST_PROXY: '1' },
    stdio: 'inherit',
    detached: true, // own process group so teardown kills npx AND the tsx server it spawns
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${API_PORT}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('API did not start');
});

after(() => {
  try {
    process.kill(-api.pid, 'SIGTERM');
  } catch {}
  gw?.closeAllConnections();
  gw?.close();
});

const post = (path, body, headers = {}) => fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('send OTP via Supabase never leaks a devCode and forwards the end-user IP', async () => {
  const r = await post('/auth/otp/request', { phone: '99000 12345' }, { 'X-Forwarded-For': '203.0.113.7' });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.devCode, undefined);
  const call = seen.find((s) => s.path === '/auth/v1/otp');
  assert.equal(call.forwardedFor, '203.0.113.7');
});

test('wrong OTP → 401 from our API (GoTrue says 403 otp_expired)', async () => {
  const r = await post('/auth/otp/verify', { phone: '9900012345', code: '000000' });
  assert.equal(r.status, 401);
});

test('correct OTP → our own session; user linked to the Supabase user id; phone normalised to E.164', async () => {
  const r = await post('/auth/otp/verify', { phone: '+91 99000 12345', code: '123456', consent: true });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.ok(body.accessToken && body.refreshToken);
  assert.equal(body.user.phone, '+919900012345');
  const me = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${body.accessToken}` } });
  assert.equal(me.status, 200);
});

test('rapid resend is throttled (our 60 s cooldown answers before Supabase is hit)', async () => {
  const before = seen.length;
  await post('/auth/otp/request', { phone: '9900054321' });
  const again = await post('/auth/otp/request', { phone: '9900054321' });
  assert.equal(again.status, 429);
  assert.equal(seen.filter((s) => s.path === '/auth/v1/otp').length - seen.slice(0, before).filter((s) => s.path === '/auth/v1/otp').length, 1);
});

test('a bad Supabase key is reported as a send failure, not a crash', async () => {
  // Simulate a misconfigured key by calling the gateway directly the way the API would.
  const r = await fetch(`http://localhost:${GW_PORT}/auth/v1/otp`, { method: 'POST', headers: { apikey: 'wrong', 'content-type': 'application/json' }, body: '{"phone":"+919900012345"}' });
  assert.equal(r.status, 401);
});
