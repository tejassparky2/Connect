/**
 * Regression tests for the adversarial security audit. Each test reproduces the
 * original attack and asserts it no longer works.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app, addressVerified, DELHI, drainJobs, HSR, locationVerified, login, makeAdmin, nextPhone, offset, prisma, resetDb, setHome, type TestUser } from './helpers';

beforeEach(resetDb);

const GATE = offset(HSR, 100, 100);
const bizBody = (p = offset(HSR, 300, 300)) => ({ name: 'Probe Cafe', category: 'CAFE', phone: '9900011111', addressLine: '14th Main HSR', pincode: '560102', ...p });

async function topUp(owner: TestUser, bizId: string, amountPaise: number) {
  const o = await owner.post(`/v1/businesses/${bizId}/wallet/orders`, { amountPaise });
  return owner.post(`/v1/businesses/${bizId}/wallet/verify`, { orderId: o.body.orderId, paymentId: `pay_${Math.random().toString(36).slice(2)}`, signature: 'dev-signature', amountPaise });
}

describe('C1: no location oracle via counts', () => {
  it('ad reach estimate is owner-only and bucketed; shop pins lock after 24 h', async () => {
    const victim = await locationVerified('Victim', offset(HSR, 0, 0));
    const attacker = await locationVerified('Attacker');
    const biz = (await attacker.post('/v1/businesses', bizBody())).body;
    const stranger = await locationVerified('Stranger');
    expect((await stranger.get(`/v1/ads/estimate?businessId=${biz.id}&radiusM=500`)).status).toBe(403);

    const a = await attacker.get(`/v1/ads/estimate?businessId=${biz.id}&radiusM=10000`);
    expect(a.body.verifiedHouseholds).toBe(0); // 3 users → "<10", never an exact count
    expect(victim.id).toBeTruthy();

    await prisma.business.update({ where: { id: biz.id }, data: { createdAt: new Date(Date.now() - 2 * 86400_000) } });
    const move = await attacker.patch(`/v1/businesses/${biz.id}`, { lat: 12.95, lng: 77.6 });
    expect(move.status).toBe(403);
  });

  it('home address can change at most 3 times in 30 days', async () => {
    const u = await login();
    for (let i = 0; i < 3; i++) await setHome(u, offset(HSR, i * 500, 0));
    const r = await u.put('/v1/me/address', { unit: '1', locality: 'HSR', city: 'Bengaluru', pincode: '560102', ...offset(HSR, 2000, 0) });
    expect(r.status).toBe(429);
  });
});

describe('H1/M6: cursors are sealed and validated', () => {
  it('a forged plain-text feed cursor cannot lift the radius', async () => {
    const delhi = await locationVerified('Delhi', DELHI);
    await delhi.post('/v1/posts', { type: 'GENERAL', body: 'Far away post' });
    const u = await locationVerified('Viewer');
    const forged = Buffer.from(JSON.stringify({ t: '2100-01-01T00:00:00Z', id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', r: 5_000_000 })).toString('base64url');
    const r = await u.get(`/v1/feed?cursor=${forged}`);
    expect(r.status).toBe(400);
  });

  it('garbage cursors on every paginated endpoint return 400, never 500', async () => {
    const u = await locationVerified('U');
    const other = await locationVerified('O');
    const conv = (await u.post('/v1/conversations', { userId: other.id, body: 'hi' })).body;
    for (const path of ['/v1/feed', '/v1/businesses', '/v1/providers', '/v1/notifications', `/v1/conversations/${conv.id}/messages`, '/v1/me/neighbors']) {
      const r = await u.get(`${path}?cursor=eyJ0Ijoibm9wZSIsImlkIjoibm9wZSJ9`);
      expect(r.status, path).toBe(400);
    }
  });

  it('out-of-range dates are rejected with 400', async () => {
    const u = await locationVerified('U');
    expect((await u.post('/v1/posts', { type: 'EVENT', title: 'Far future', body: 'Year 275760 party', eventAt: '+275760-09-13T00:00:00Z' })).status).toBe(400);
    expect((await u.post('/v1/businesses', { ...bizBody(), openedAt: '275760-09-13' })).status).toBe(400);
  });
});

describe('H2/L9: society-based verification follows membership', () => {
  async function verifiedSociety() {
    const admin = await locationVerified('Admin', GATE);
    const s = (await admin.post('/v1/societies', { name: 'Probe Residency', addressLine: '27th Main HSR', city: 'Bengaluru', pincode: '560102', ...GATE, unit: '1' })).body;
    await prisma.society.update({ where: { id: s.id }, data: { isVerified: true } });
    return { admin, s };
  }

  it('removal or leaving downgrades ADDRESS back to LOCATION', async () => {
    const { admin, s } = await verifiedSociety();
    const r = await locationVerified('Resident', offset(GATE, 20, 0));
    await r.post('/v1/societies/join', { societyId: s.id, unit: '2' });
    const pending = (await admin.get(`/v1/societies/${s.id}/members?status=PENDING`)).body.items[0];
    await admin.post(`/v1/societies/${s.id}/members/${pending.membershipId}/approve`);
    expect((await r.get('/v1/me')).body.verificationLevel).toBe('ADDRESS');
    await admin.patch(`/v1/societies/${s.id}/members/${pending.membershipId}`, { remove: true });
    expect((await r.get('/v1/me')).body.verificationLevel).toBe('LOCATION');

    const r2 = await locationVerified('Leaver', offset(GATE, -20, 0));
    await r2.post('/v1/societies/join', { societyId: s.id, unit: '3' });
    const p2 = (await admin.get(`/v1/societies/${s.id}/members?status=PENDING`)).body.items[0];
    await admin.post(`/v1/societies/${s.id}/members/${p2.membershipId}/approve`);
    expect((await r2.get('/v1/me')).body.verificationLevel).toBe('ADDRESS');
    await r2.del(`/v1/societies/${s.id}/membership`);
    expect((await r2.get('/v1/me')).body.verificationLevel).toBe('LOCATION');
  });

  it('RWA approval without on-device GPS evidence does not grant ADDRESS', async () => {
    const { admin, s } = await verifiedSociety();
    const phoneOnly = await login();
    await setHome(phoneOnly, offset(GATE, 10, 10));
    await phoneOnly.post('/v1/societies/join', { societyId: s.id, unit: '9' });
    const p = (await admin.get(`/v1/societies/${s.id}/members?status=PENDING`)).body.items[0];
    await admin.post(`/v1/societies/${s.id}/members/${p.membershipId}/approve`);
    expect((await phoneOnly.get('/v1/me')).body.verificationLevel).toBe('PHONE');
  });

  it('M1: concurrent approve/reject — exactly one wins, one notification', async () => {
    const { admin, s } = await verifiedSociety();
    const r = await locationVerified('Racer', offset(GATE, 15, 0));
    await r.post('/v1/societies/join', { societyId: s.id, unit: '4' });
    const p = (await admin.get(`/v1/societies/${s.id}/members?status=PENDING`)).body.items[0];
    const results = await Promise.all([
      ...Array.from({ length: 10 }, () => admin.post(`/v1/societies/${s.id}/members/${p.membershipId}/approve`)),
      ...Array.from({ length: 10 }, () => admin.post(`/v1/societies/${s.id}/members/${p.membershipId}/reject`)),
    ]);
    expect(results.filter((x) => x.status === 200)).toHaveLength(1);
    await drainJobs();
    expect(await prisma.notification.count({ where: { userId: r.id, type: 'SOCIETY_MEMBERSHIP' } })).toBe(1);
    const m = await prisma.societyMembership.findUniqueOrThrow({ where: { id: p.membershipId } });
    const level = (await r.get('/v1/me')).body.verificationLevel;
    expect(m.status === 'APPROVED' ? level === 'ADDRESS' : level === 'LOCATION').toBe(true);
  });
});

describe('M2/M3: ad money can be neither created nor drained', () => {
  it('ending a campaign during an impression burst never creates money', async () => {
    const owner = await locationVerified('Owner');
    const biz = (await owner.post('/v1/businesses', bizBody())).body;
    await topUp(owner, biz.id, 20000);
    const c = (await owner.post('/v1/ads/campaigns', { businessId: biz.id, headline: 'Burst campaign', body: 'Testing a concurrent settle race', budgetPaise: 20000, endAt: new Date(Date.now() + 86400_000).toISOString() })).body;
    await prisma.adCampaign.update({ where: { id: c.id }, data: { cpmPaise: 100_000 } }); // 100 paise per impression
    await owner.post(`/v1/ads/campaigns/${c.id}/launch`);
    const viewers = await Promise.all(Array.from({ length: 25 }, (_, i) => locationVerified(`V${i}`, offset(HSR, i * 10, 0))));
    await Promise.all([...viewers.map((v) => v.post(`/v1/ads/${c.id}/impression`)), owner.post(`/v1/ads/campaigns/${c.id}/end`)]);
    const camp = await prisma.adCampaign.findUniqueOrThrow({ where: { id: c.id } });
    const wallet = (await prisma.business.findUniqueOrThrow({ where: { id: biz.id } })).walletPaise;
    // Conservation: what's left in the wallet + what was spent == what was deposited.
    expect(wallet + camp.spentPaise).toBe(20000);
  });

  it('impressions are only billable by eligible, location-verified viewers', async () => {
    const owner = await locationVerified('Owner');
    const biz = (await owner.post('/v1/businesses', bizBody())).body;
    await topUp(owner, biz.id, 10000);
    const c = (await owner.post('/v1/ads/campaigns', { businessId: biz.id, headline: 'Targeted ad here', body: 'Only for people within two km', radiusM: 2000, budgetPaise: 10000, endAt: new Date(Date.now() + 86400_000).toISOString() })).body;
    await owner.post(`/v1/ads/campaigns/${c.id}/launch`);
    const phoneOnly = await login();
    expect((await phoneOnly.post(`/v1/ads/${c.id}/impression`)).status).toBe(403);
    const far = await locationVerified('Far', offset(HSR, 6000, 0));
    expect((await far.post(`/v1/ads/${c.id}/impression`)).body.billed).toBe(false);
    const near = await locationVerified('Near', offset(HSR, 200, 0));
    expect((await near.post(`/v1/ads/${c.id}/impression`)).body.billed).toBe(true);
    expect((await prisma.adCampaign.findUniqueOrThrow({ where: { id: c.id } })).impressions).toBe(1);
  });

  it('L5 + cross-business: wallet cap, and a Razorpay order cannot credit another business', async () => {
    const owner = await locationVerified('Owner');
    const biz = (await owner.post('/v1/businesses', bizBody())).body;
    await prisma.business.update({ where: { id: biz.id }, data: { walletPaise: 10_00_000_00 } });
    expect((await owner.post(`/v1/businesses/${biz.id}/wallet/orders`, { amountPaise: 10000 })).status).toBe(400);
  });
});

describe('M4/M5: vouch abuse', () => {
  it('parallel vouches cannot exceed the monthly cap of 5', async () => {
    const voucher = await addressVerified('Voucher');
    const targets = await Promise.all(Array.from({ length: 8 }, (_, i) => locationVerified(`T${i}`, offset(HSR, i * 30, 0))));
    const res = await Promise.all(targets.map((t) => voucher.post(`/v1/users/${t.id}/vouch`)));
    expect(res.filter((r) => r.status === 200)).toHaveLength(5);
    expect(await prisma.vouch.count({ where: { voucherId: voucher.id } })).toBe(5);
  });

  it('vouch-verified accounts cannot immediately mint more ADDRESS accounts; no mutual vouching', async () => {
    const a = await addressVerified('A');
    const b = await addressVerified('B', offset(HSR, 50, 0));
    const puppet = await locationVerified('Puppet', offset(HSR, 80, 0));
    await a.post(`/v1/users/${puppet.id}/vouch`);
    await b.post(`/v1/users/${puppet.id}/vouch`);
    expect((await puppet.get('/v1/me')).body.verificationLevel).toBe('ADDRESS');
    const next = await locationVerified('Next', offset(HSR, 90, 0));
    const r = await puppet.post(`/v1/users/${next.id}/vouch`);
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/30 days/);
  });
});

describe('M7/M8/L1/L2/L4/L6/L7/L8 and moderation edges', () => {
  it('M7: concurrent comment reports never drive commentCount negative', async () => {
    const author = await locationVerified('Author');
    const p = (await author.post('/v1/posts', { type: 'GENERAL', body: 'A post with a comment' })).body;
    const c = (await author.post(`/v1/posts/${p.id}/comments`, { body: 'reported comment' })).body;
    const reporters = await Promise.all(Array.from({ length: 8 }, async (_, i) => {
      const r = await locationVerified(`R${i}`);
      await prisma.user.update({ where: { id: r.id }, data: { createdAt: new Date(Date.now() - 10 * 86400_000) } });
      return r;
    }));
    const res = await Promise.all(reporters.map((r) => r.post('/v1/reports', { targetType: 'COMMENT', targetId: c.id, reason: 'SPAM' })));
    expect(res.every((r) => r.status === 201)).toBe(true);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).commentCount).toBe(0);
  });

  it('M8: X-Forwarded-For is ignored unless TRUST_PROXY is configured', async () => {
    const r = await request(app).get('/health').set('X-Forwarded-For', '1.2.3.4');
    expect(r.status).toBe(200);
    expect(app.get('trust proxy')).toBe(false);
  });

  it('L1/L2: chats cannot attach invisible posts; PHONE users cannot reply', async () => {
    const far = await locationVerified('Far', DELHI);
    const farPost = (await far.post('/v1/posts', { type: 'CLASSIFIED', title: 'Delhi sofa', body: 'Sofa in Delhi', pricePaise: 100, condition: 'GOOD' })).body;
    const a = await locationVerified('A');
    const b = await locationVerified('B');
    expect((await a.post('/v1/conversations', { userId: b.id, postId: farPost.id, body: 'look' })).status).toBe(404);
    const conv = (await a.post('/v1/conversations', { userId: b.id, body: 'hello' })).body;
    await prisma.user.update({ where: { id: b.id }, data: { verificationLevel: 'PHONE' } });
    expect((await b.post(`/v1/conversations/${conv.id}/messages`, { body: 'reply' })).status).toBe(403);
  });

  it('L4: ?mine=false is false', async () => {
    const admin = await locationVerified('Admin', GATE);
    const s = (await admin.post('/v1/societies', { name: 'Ticket Towers', addressLine: '27th Main HSR', city: 'Bengaluru', pincode: '560102', ...GATE, unit: '1' })).body;
    await admin.patch(`/v1/societies/${s.id}`, { requireApproval: false });
    const code = (await admin.get(`/v1/societies/${s.id}`)).body.inviteCode;
    const member = await locationVerified('Member', offset(GATE, 10, 0));
    await member.post('/v1/societies/join', { inviteCode: code, unit: '5' });
    await admin.post(`/v1/societies/${s.id}/tickets`, { title: 'Admin ticket one', description: 'Raised by the admin user' });
    await member.post(`/v1/societies/${s.id}/tickets`, { title: 'Member ticket one', description: 'Raised by a regular member' });
    expect((await admin.get(`/v1/societies/${s.id}/tickets?mine=false`)).body.items).toHaveLength(2);
    expect((await admin.get(`/v1/societies/${s.id}/tickets?mine=true`)).body.items).toHaveLength(1);
  });

  it('L6: parallel wrong OTP guesses are capped at 5 evaluations', async () => {
    const phone = nextPhone();
    const { body } = await request(app).post('/v1/auth/otp/request').send({ phone });
    const wrong = body.devCode === '000000' ? '111111' : '000000';
    await Promise.all(Array.from({ length: 40 }, () => request(app).post('/v1/auth/otp/verify').send({ phone, code: wrong, consent: true })));
    const ch = await prisma.otpChallenge.findFirstOrThrow({ where: { phone } });
    expect(ch.attempts).toBe(5);
    expect((await request(app).post('/v1/auth/otp/verify').send({ phone, code: body.devCode, consent: true })).status).toBe(429);
  });

  it('L7: javascript:/http image URLs are rejected', async () => {
    const u = await locationVerified('U');
    expect((await u.patch('/v1/me', { avatarUrl: 'javascript:alert(1)' })).status).toBe(400);
    expect((await u.post('/v1/posts', { type: 'GENERAL', body: 'tracking pixel', images: ['http://evil.example/p.gif'] })).status).toBe(400);
    expect((await u.post('/v1/posts', { type: 'GENERAL', body: 'fine image', images: ['https://images.example/p.jpg'] })).status).toBe(201);
  });

  it('L8: search text with % and _ matches literally', async () => {
    const o = await locationVerified('Owner');
    await o.post('/v1/businesses', bizBody());
    expect((await o.get('/v1/businesses?q=%25')).body.items).toHaveLength(0);
    expect((await o.get('/v1/businesses?q=Probe')).body.items).toHaveLength(1);
  });

  it('admin restore never resurrects an author-deleted post', async () => {
    const admin = await login();
    await makeAdmin(admin);
    const author = await locationVerified('Author');
    const p = (await author.post('/v1/posts', { type: 'GENERAL', body: 'Will be deleted' })).body;
    const rep = await locationVerified('Rep');
    await rep.post('/v1/reports', { targetType: 'POST', targetId: p.id, reason: 'SPAM' });
    await author.del(`/v1/posts/${p.id}`);
    const report = (await admin.get('/v1/admin/reports')).body.items[0];
    await admin.post(`/v1/admin/reports/${report.id}/resolve`, { action: 'RESTORE_CONTENT' });
    expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('REMOVED');
  });

  it('a worker can claim their own listing with their verified phone', async () => {
    const lister = await locationVerified('Lister');
    const workerPhone = nextPhone();
    const w = (await lister.post('/v1/providers', { name: 'Ramesh', phone: workerPhone, skills: ['PLUMBER'], consent: true })).body;
    const worker = await login(workerPhone);
    const r = await worker.post('/v1/providers/claim');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: w.id, canEdit: true });
  });
});

describe('payments (Razorpay mode, gateway HTTP mocked)', () => {
  it('a valid payment for business A cannot be claimed by business B; uncaptured → 202 pending', async () => {
    const { env } = await import('../src/config/env');
    const crypto = await import('node:crypto');
    const prev = { id: env.RAZORPAY_KEY_ID, secret: env.RAZORPAY_KEY_SECRET };
    Object.assign(env, { RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'rzp_secret_x' });
    const ownerA = await locationVerified('A');
    const bizA = (await ownerA.post('/v1/businesses', bizBody())).body;
    const ownerB = await locationVerified('B');
    const bizB = (await ownerB.post('/v1/businesses', { ...bizBody(offset(HSR, 900, 0)), name: 'Other Cafe' })).body;
    const orders: Record<string, object> = {
      order_A: { id: 'order_A', amount: 50000, amount_paid: 50000, status: 'paid', notes: { businessId: bizA.id } },
      order_P: { id: 'order_P', amount: 50000, amount_paid: 0, status: 'attempted', notes: { businessId: bizB.id } },
    };
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const m = String(input).match(/^https:\/\/api\.razorpay\.com\/v1\/orders\/(\w+)$/);
      if (m) return new Response(JSON.stringify(orders[m[1]]), { status: orders[m[1]] ? 200 : 404 });
      return realFetch(input, init);
    });
    const sig = (o: string, p: string) => crypto.createHmac('sha256', 'rzp_secret_x').update(`${o}|${p}`).digest('hex');
    try {
      const steal = await ownerB.post(`/v1/businesses/${bizB.id}/wallet/verify`, { orderId: 'order_A', paymentId: 'pay_A1', signature: sig('order_A', 'pay_A1') });
      expect(steal.status).toBe(403);
      const forged = await ownerA.post(`/v1/businesses/${bizA.id}/wallet/verify`, { orderId: 'order_A', paymentId: 'pay_A1', signature: 'deadbeef' });
      expect(forged.status).toBe(403);
      const ok = await ownerA.post(`/v1/businesses/${bizA.id}/wallet/verify`, { orderId: 'order_A', paymentId: 'pay_A1', signature: sig('order_A', 'pay_A1') });
      expect(ok.body).toMatchObject({ ok: true, balancePaise: 50000 });
      const pending = await ownerB.post(`/v1/businesses/${bizB.id}/wallet/verify`, { orderId: 'order_P', paymentId: 'pay_P1', signature: sig('order_P', 'pay_P1') });
      expect(pending.status).toBe(202);
      expect((await prisma.business.findUniqueOrThrow({ where: { id: bizB.id } })).walletPaise).toBe(0);
    } finally {
      spy.mockRestore();
      Object.assign(env, { RAZORPAY_KEY_ID: prev.id, RAZORPAY_KEY_SECRET: prev.secret });
    }
  });
});
