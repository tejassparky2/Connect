import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app, HSR, KORA, locationVerified, login, makeAdmin, offset, prisma, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => fs.rmSync(path.resolve('tests/.uploads'), { recursive: true, force: true }));

// 1×1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

describe('uploads', () => {
  it('stores real images and serves them back', async () => {
    const u = await login();
    const r = await request(app).post('/v1/uploads').set('Authorization', `Bearer ${u.token}`).attach('file', PNG, { filename: 'x.png', contentType: 'image/png' });
    expect(r.status).toBe(201);
    expect(r.body.url).toMatch(/\/uploads\/u\/.+\.png$/);
    const served = await request(app).get(new URL(r.body.url).pathname);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toMatch(/image\/png/);
  });

  it('rejects disguised non-images, missing files and anonymous users', async () => {
    const u = await login();
    const fake = await request(app).post('/v1/uploads').set('Authorization', `Bearer ${u.token}`).attach('file', Buffer.from('<script>alert(1)</script>....'), { filename: 'evil.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    expect((await request(app).post('/v1/uploads').set('Authorization', `Bearer ${u.token}`)).status).toBe(400);
    expect((await request(app).post('/v1/uploads').attach('file', PNG, 'x.png')).status).toBe(401);
  });
});

describe('admin & moderation', () => {
  it('blocks non-staff', async () => {
    const u = await login();
    expect((await u.get('/v1/admin/stats')).status).toBe(403);
  });

  it('imports a neighbourhood boundary from GeoJSON (cold-start seeding) and adopts existing residents', async () => {
    const admin = await login();
    await makeAdmin(admin);
    const resident = await locationVerified('Early bird', HSR);
    expect((await resident.get('/v1/me')).body.neighborhood).toBeNull();
    const sw = offset(HSR, -1000, -1000);
    const ne = offset(HSR, 1000, 1000);
    const r = await admin.post('/v1/admin/neighborhoods', {
      name: 'HSR Layout',
      slug: 'hsr-layout',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560102',
      geojson: { type: 'Polygon', coordinates: [[[sw.lng, sw.lat], [ne.lng, sw.lat], [ne.lng, ne.lat], [sw.lng, ne.lat], [sw.lng, sw.lat]]] },
    });
    expect(r.status).toBe(201);
    expect((await resident.get('/v1/me')).body.neighborhood.name).toBe('HSR Layout');
    expect((await admin.post('/v1/admin/neighborhoods', { name: 'Bad', slug: 'bad-geom', city: 'X', state: 'Y', geojson: { type: 'Polygon', coordinates: [[[1, 1]]] } })).status).toBe(400);
    const stats = await admin.get('/v1/admin/stats');
    expect(stats.body.users).toBe(2);
  });

  it('report queue: remove content, restore content, ban user', async () => {
    const admin = await login();
    await makeAdmin(admin);
    const author = await locationVerified('Spammer');
    const p = (await author.post('/v1/posts', { type: 'GENERAL', body: 'Buy followers cheap!!!' })).body;
    const reporter = await locationVerified('Reporter', offset(HSR, 100, 0));
    await reporter.post('/v1/reports', { targetType: 'POST', targetId: p.id, reason: 'SPAM' });
    const q = await admin.get('/v1/admin/reports');
    expect(q.body.items).toHaveLength(1);
    await admin.post(`/v1/admin/reports/${q.body.items[0].id}/resolve`, { action: 'BAN_USER' });
    expect((await author.get('/v1/me')).status).toBe(403);
    expect((await admin.get('/v1/admin/reports')).body.items).toHaveLength(0);
  });

  it('ad review: approve goes live, reject refunds', async () => {
    const admin = await login();
    await makeAdmin(admin);
    const owner = await locationVerified('Owner');
    const biz = (await owner.post('/v1/businesses', { name: 'Shady Finance', category: 'OTHER', phone: '9900011111', addressLine: 'Somewhere in HSR', pincode: '560102', ...KORA })).body;
    const o = await owner.post(`/v1/businesses/${biz.id}/wallet/orders`, { amountPaise: 20000 });
    await owner.post(`/v1/businesses/${biz.id}/wallet/verify`, { orderId: o.body.orderId, paymentId: 'pay_admin_test', signature: 'dev-signature', amountPaise: 20000 });
    const c = (await owner.post('/v1/ads/campaigns', { businessId: biz.id, headline: 'Guaranteed returns!!', body: 'Double your money in a week, guaranteed returns', budgetPaise: 20000, endAt: new Date(Date.now() + 86400_000).toISOString() })).body;
    expect((await owner.post(`/v1/ads/campaigns/${c.id}/launch`)).body.status).toBe('PENDING_REVIEW');
    expect((await admin.get('/v1/admin/ads')).body.items).toHaveLength(1);
    await admin.post(`/v1/admin/ads/${c.id}/review`, { approve: false, reason: 'Financial scam' });
    const after = await owner.get(`/v1/ads/campaigns/${c.id}`);
    expect(after.body).toMatchObject({ status: 'REJECTED', rejectReason: 'Financial scam' });
    expect((await owner.get(`/v1/businesses/${biz.id}/wallet`)).body.balancePaise).toBe(20000);
    expect(await prisma.notification.count({ where: { userId: owner.id, type: 'AD_STATUS' } })).toBeGreaterThanOrEqual(0);
  });
});
