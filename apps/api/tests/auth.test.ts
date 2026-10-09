import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, login, nextPhone, prisma, resetDb } from './helpers';

beforeEach(resetDb);

describe('OTP login', () => {
  it('rejects invalid Indian numbers', async () => {
    const r = await request(app).post('/v1/auth/otp/request').send({ phone: '12345678901' });
    expect(r.status).toBe(400);
  });

  it('logs in a new user, flags isNewUser, and never stores the raw OTP', async () => {
    const phone = nextPhone();
    const r1 = await request(app).post('/v1/auth/otp/request').send({ phone: phone.replace('+91', '') });
    expect(r1.status).toBe(200);
    expect(r1.body.devCode).toMatch(/^\d{6}$/);
    const stored = await prisma.otpChallenge.findFirstOrThrow({ where: { phone } });
    expect(stored.codeHash).not.toContain(r1.body.devCode);

    // New accounts must affirmatively accept the privacy notice (DPDP Act 2023).
    const noConsent = await request(app).post('/v1/auth/otp/verify').send({ phone, code: r1.body.devCode });
    expect(noConsent.status).toBe(400);
    expect(noConsent.body.error.code).toBe('CONSENT_REQUIRED');

    const r2 = await request(app).post('/v1/auth/otp/verify').send({ phone, code: r1.body.devCode, consent: true });
    expect(r2.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { phone } });
    expect(row.consentAt).not.toBeNull();
    expect(row.consentVersion).toBe('2026-10');
    expect(r2.body.isNewUser).toBe(true);
    expect(r2.body.user.verificationLevel).toBe('PHONE');
    expect(r2.body.accessToken).toBeTruthy();

    // Same code cannot be reused.
    const r3 = await request(app).post('/v1/auth/otp/verify').send({ phone, code: r1.body.devCode });
    expect(r3.status).toBe(401);
  });

  it('enforces resend cooldown per phone', async () => {
    const phone = nextPhone();
    expect((await request(app).post('/v1/auth/otp/request').send({ phone })).status).toBe(200);
    const again = await request(app).post('/v1/auth/otp/request').send({ phone });
    expect(again.status).toBe(429);
    expect(again.body.error.message).toMatch(/wait/i);
  });

  it('locks a challenge after 5 wrong attempts', async () => {
    const phone = nextPhone();
    const { body } = await request(app).post('/v1/auth/otp/request').send({ phone });
    const wrong = body.devCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await request(app).post('/v1/auth/otp/verify').send({ phone, code: wrong, consent: true })).status).toBe(401);
    const locked = await request(app).post('/v1/auth/otp/verify').send({ phone, code: body.devCode, consent: true });
    expect(locked.status).toBe(429);
  });
});

describe('sessions', () => {
  it('requires a bearer token', async () => {
    expect((await request(app).get('/v1/me')).status).toBe(401);
    expect((await request(app).get('/v1/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });

  it('rotates refresh tokens and kills the family on reuse', async () => {
    const u = await login();
    const r1 = await request(app).post('/v1/auth/refresh').send({ refreshToken: u.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(u.refreshToken);

    // Replaying the old (rotated) token = theft signal → whole family revoked.
    const replay = await request(app).post('/v1/auth/refresh').send({ refreshToken: u.refreshToken });
    expect(replay.status).toBe(401);
    const afterReuse = await request(app).post('/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken });
    expect(afterReuse.status).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const u = await login();
    expect((await request(app).post('/v1/auth/logout').send({ refreshToken: u.refreshToken })).status).toBe(200);
    expect((await request(app).post('/v1/auth/refresh').send({ refreshToken: u.refreshToken })).status).toBe(401);
  });

  it('banned users are locked out immediately, even with a valid JWT', async () => {
    const u = await login();
    await prisma.user.update({ where: { id: u.id }, data: { isBanned: true } });
    expect((await u.get('/v1/me')).status).toBe(403);
  });

  it('profile update + account deletion anonymises the user', async () => {
    const u = await login();
    const p = await u.patch('/v1/me', { name: 'Asha Verma', feedRadiusM: 4000, language: 'hi' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ name: 'Asha Verma', feedRadiusM: 4000, language: 'hi' });
    expect((await u.patch('/v1/me', { feedRadiusM: 9000 })).status).toBe(400);

    expect((await u.del('/v1/me')).status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.phone).toBe(`deleted:${u.id}`);
    expect(row.deletedAt).not.toBeNull();
    expect((await u.get('/v1/me')).status).toBe(401);
    expect((await request(app).post('/v1/auth/refresh').send({ refreshToken: u.refreshToken })).status).toBe(401);
  });
});

describe('robustness', () => {
  it('returns JSON 400 for malformed bodies and 404 for unknown routes / non-UUID ids', async () => {
    const u = await login();
    const bad = await request(app).post('/v1/auth/otp/request').set('Content-Type', 'application/json').send('{"phone":');
    expect(bad.status).toBe(400);
    expect((await u.get('/v1/nope')).status).toBe(404);
    expect((await u.get('/v1/posts/1;DROP TABLE users')).status).toBe(404);
  });

  it('health check reports DB status', async () => {
    const r = await request(app).get('/health');
    expect(r.body).toMatchObject({ ok: true, db: 'up' });
  });
});
