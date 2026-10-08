import { beforeEach, describe, expect, it } from 'vitest';
import { addressVerified, drainJobs, HSR, locationVerified, login, offset, prisma, resetDb, setHome } from './helpers';

beforeEach(resetDb);

describe('trust ladder: PHONE → LOCATION → ADDRESS', () => {
  it('new users are PHONE-level, can browse but not post', async () => {
    const u = await login();
    await setHome(u, HSR);
    expect((await u.get('/v1/feed')).status).toBe(200);
    const post = await u.post('/v1/posts', { type: 'GENERAL', body: 'Hello neighbours!' });
    expect(post.status).toBe(403);
    expect(post.body.error).toMatchObject({ code: 'VERIFICATION_REQUIRED', details: { requiredLevel: 'LOCATION' } });
  });

  it('GPS check fails when far from home, inaccurate, or mocked — with helpful reasons', async () => {
    const u = await login();
    await setHome(u, HSR);
    const far = await u.post('/v1/me/verification/gps', { ...offset(HSR, 1000, 0), accuracyM: 10 });
    expect(far.body.passed).toBe(false);
    expect(far.body.reasons.join(' ')).toMatch(/1000 m|99\d m|100\d m/);
    const fuzzy = await u.post('/v1/me/verification/gps', { ...HSR, accuracyM: 900 });
    expect(fuzzy.body.passed).toBe(false);
    const mocked = await u.post('/v1/me/verification/gps', { ...HSR, accuracyM: 5, isMocked: true });
    expect(mocked.body.passed).toBe(false);
    expect(mocked.body.level).toBe('PHONE');
  });

  it('two passing GPS checks → LOCATION', async () => {
    const u = await login();
    await setHome(u, HSR);
    const a = await u.post('/v1/me/verification/gps', { ...offset(HSR, 30, 20), accuracyM: 12 });
    expect(a.body).toMatchObject({ passed: true, level: 'PHONE', progress: { passed: 1, required: 2 } });
    const b = await u.post('/v1/me/verification/gps', { ...HSR, accuracyM: 12 });
    expect(b.body).toMatchObject({ passed: true, level: 'LOCATION', progress: { done: true } });
    const v = await u.get('/v1/me/verification');
    expect(v.body.level).toBe('LOCATION');
    await drainJobs();
    expect(await prisma.notification.count({ where: { userId: u.id, type: 'SYSTEM' } })).toBe(1);
  });

  it('GPS check requires an address first', async () => {
    const u = await login();
    expect((await u.post('/v1/me/verification/gps', { ...HSR, accuracyM: 10 })).status).toBe(400);
  });

  it('two ADDRESS-verified neighbours within 1 km vouch → ADDRESS', async () => {
    const v1 = await addressVerified('Voucher One', offset(HSR, 200, 0));
    const v2 = await addressVerified('Voucher Two', offset(HSR, 0, 300));
    const target = await locationVerified('Newbie', HSR);

    // LOCATION users cannot vouch.
    const lu = await locationVerified('Location only', HSR);
    expect((await lu.post(`/v1/users/${target.id}/vouch`)).status).toBe(403);

    const r1 = await v1.post(`/v1/users/${target.id}/vouch`);
    expect(r1.body).toMatchObject({ level: 'LOCATION', vouches: 1, required: 2 });
    expect((await v1.post(`/v1/users/${target.id}/vouch`)).status).toBe(409); // duplicate
    const r2 = await v2.post(`/v1/users/${target.id}/vouch`);
    expect(r2.body.level).toBe('ADDRESS');
    const addr = await prisma.address.findFirstOrThrow({ where: { userId: target.id, isPrimary: true } });
    expect(addr.method).toBe('NEIGHBOR_VOUCH');
  });

  it('vouching is geo-fenced to 1 km', async () => {
    const far = await addressVerified('Far voucher', offset(HSR, 3000, 0));
    const target = await locationVerified('Newbie', HSR);
    const r = await far.post(`/v1/users/${target.id}/vouch`);
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/1 km/);
  });

  it('moving home resets verification (evidence was for the old pin)', async () => {
    const u = await addressVerified('Mover', HSR);
    expect((await u.get('/v1/me')).body.verificationLevel).toBe('ADDRESS');
    const me = await setHome(u, offset(HSR, 2500, 2500));
    expect(me.verificationLevel).toBe('PHONE');
  });

  it('never exposes home coordinates or phone numbers of others', async () => {
    const a = await addressVerified('Alice', HSR);
    const b = await locationVerified('Bob', offset(HSR, 150, 150));
    const profile = await b.get(`/v1/users/${a.id}`);
    expect(profile.status).toBe(200);
    const json = JSON.stringify(profile.body);
    expect(json).not.toContain(a.phone);
    expect(json).not.toMatch(/lat|lng|homeLocation/);
    const neighbors = await b.get('/v1/me/neighbors');
    expect(JSON.stringify(neighbors.body)).not.toMatch(/lat|lng|phone/);
    expect(neighbors.body.items[0].distanceM % 100).toBe(0);
  });
});
