import { beforeEach, describe, expect, it } from 'vitest';
import { sweepExpiredCampaigns } from '../src/modules/ads.routes';
import { addressVerified, DELHI, drainJobs, HSR, KORA, locationVerified, login, offset, prisma, resetDb, setHome, type TestUser } from './helpers';

beforeEach(resetDb);

const bizBody = (over: object = {}) => ({
  name: 'Filter Kaapi House',
  category: 'CAFE',
  description: 'Filter coffee and tiffin',
  phone: '99000 00003',
  whatsapp: '9900000003',
  addressLine: '14th Main, HSR Sector 3',
  pincode: '560102',
  ...offset(HSR, 300, 300),
  hours: { mon: '07:00-22:00', sun: 'closed' },
  ...over,
});

async function bizOwner() {
  const owner = await locationVerified('Kavya');
  const b = await owner.post('/v1/businesses', bizBody());
  expect(b.status).toBe(201);
  return { owner, biz: b.body as { id: string } };
}

async function topUp(owner: TestUser, bizId: string, amountPaise: number) {
  const order = await owner.post(`/v1/businesses/${bizId}/wallet/orders`, { amountPaise });
  expect(order.body.mode).toBe('dev');
  return owner.post(`/v1/businesses/${bizId}/wallet/verify`, { orderId: order.body.orderId, paymentId: `pay_${Math.random().toString(36).slice(2)}`, signature: 'dev-signature', amountPaise });
}

describe('business directory', () => {
  it('creates a business with normalised phones and a "new" badge', async () => {
    const { biz, owner } = await bizOwner();
    const d = await owner.get(`/v1/businesses/${biz.id}`);
    expect(d.body).toMatchObject({ phone: '+919900000003', whatsapp: '+919900000003', isNew: true, isMine: true, walletPaise: 0, isVerified: false });
    expect((await owner.post('/v1/businesses', bizBody({ gstin: 'BADGST' }))).status).toBe(400);
    expect((await owner.post('/v1/businesses', bizBody({ hours: { mon: '9am-5pm' } }))).status).toBe(400);
    const phoneOnly = await login();
    await setHome(phoneOnly, HSR);
    expect((await phoneOnly.post('/v1/businesses', bizBody())).status).toBe(403);
  });

  it('lists nearest first, filters by category and search, respects radius', async () => {
    const owner = await locationVerified('Owner');
    await owner.post('/v1/businesses', bizBody({ name: 'Near Cafe', ...offset(HSR, 100, 0) }));
    await owner.post('/v1/businesses', bizBody({ name: 'Mid Salon', category: 'SALON', ...offset(HSR, 1500, 0) }));
    await owner.post('/v1/businesses', bizBody({ name: 'Kora Bakery', category: 'BAKERY', ...KORA }));
    await owner.post('/v1/businesses', bizBody({ name: 'Delhi Dhaba', category: 'RESTAURANT', ...DELHI }));
    const v = await locationVerified('Viewer');
    const all = await v.get('/v1/businesses');
    expect(all.body.items.map((b: { name: string }) => b.name)).toEqual(['Near Cafe', 'Mid Salon', 'Kora Bakery']);
    expect((await v.get('/v1/businesses?category=SALON')).body.items).toHaveLength(1);
    expect((await v.get('/v1/businesses?q=bakery')).body.items[0].name).toBe('Kora Bakery');
    expect((await v.get('/v1/businesses?radius=1000')).body.items).toHaveLength(1);
    const p1 = await v.get('/v1/businesses?limit=2');
    const p2 = await v.get(`/v1/businesses?limit=2&cursor=${p1.body.nextCursor}`);
    expect(p2.body.items.map((b: { name: string }) => b.name)).toEqual(['Kora Bakery']);
  });

  it('reviews: one per user (upsert), averages update, owners cannot self-review', async () => {
    const { owner, biz } = await bizOwner();
    expect((await owner.post(`/v1/businesses/${biz.id}/reviews`, { rating: 5 })).status).toBe(403);
    const a = await locationVerified('A');
    const b = await locationVerified('B');
    expect((await a.post(`/v1/businesses/${biz.id}/reviews`, { rating: 5, body: 'Amazing coffee' })).status).toBe(201);
    expect((await b.post(`/v1/businesses/${biz.id}/reviews`, { rating: 2 })).status).toBe(201);
    expect((await a.post(`/v1/businesses/${biz.id}/reviews`, { rating: 4 })).status).toBe(200);
    const d = await a.get(`/v1/businesses/${biz.id}`);
    expect(d.body).toMatchObject({ ratingAvg: 3, ratingCount: 2 });
    expect(d.body.myReview.rating).toBe(4);
    expect((await a.post(`/v1/businesses/${biz.id}/reviews`, { rating: 6 })).status).toBe(400);
    await drainJobs();
    expect(await prisma.notification.count({ where: { userId: owner.id, type: 'REVIEW_RECEIVED' } })).toBe(2);
  });

  it('announcements show up as nearby offers', async () => {
    const { owner, biz } = await bizOwner();
    const v = await locationVerified('Viewer');
    expect((await v.post(`/v1/businesses/${biz.id}/announcements`, { title: 'Hack', body: 'Not my business' })).status).toBe(403);
    await owner.post(`/v1/businesses/${biz.id}/announcements`, { title: 'Grand opening!', body: '20% off all week', validUntil: new Date(Date.now() + 86400_000).toISOString() });
    const offers = await v.get('/v1/businesses/offers/nearby');
    expect(offers.body.items[0]).toMatchObject({ title: 'Grand opening!', business: { name: 'Filter Kaapi House' } });
  });

  it('editing name or GSTIN drops the verified badge', async () => {
    const { owner, biz } = await bizOwner();
    await prisma.business.update({ where: { id: biz.id }, data: { isVerified: true } });
    const r = await owner.patch(`/v1/businesses/${biz.id}`, { name: 'Filter Kaapi House & Bakery' });
    expect(r.body.isVerified).toBe(false);
  });
});

describe('ad wallet & self-serve campaigns', () => {
  it('wallet top-up is credited once per payment id', async () => {
    const { owner, biz } = await bizOwner();
    const order = await owner.post(`/v1/businesses/${biz.id}/wallet/orders`, { amountPaise: 50000 });
    const pay = { orderId: order.body.orderId, paymentId: 'pay_dup_1', signature: 'dev-signature', amountPaise: 50000 };
    expect((await owner.post(`/v1/businesses/${biz.id}/wallet/verify`, pay)).body.balancePaise).toBe(50000);
    expect((await owner.post(`/v1/businesses/${biz.id}/wallet/verify`, pay)).status).toBe(409);
    const w = await owner.get(`/v1/businesses/${biz.id}/wallet`);
    expect(w.body).toMatchObject({ balancePaise: 50000, paymentsMode: 'dev' });
    expect(w.body.transactions).toHaveLength(1);
    const stranger = await locationVerified('Stranger');
    expect((await stranger.get(`/v1/businesses/${biz.id}/wallet`)).status).toBe(403);
  });

  it('full lifecycle: draft → launch (reserve) → serve in radius → billed impressions → end (refund)', async () => {
    const { owner, biz } = await bizOwner();
    const est = await owner.get(`/v1/ads/estimate?businessId=${biz.id}&radiusM=3000`);
    expect(est.body.verifiedHouseholds).toBeGreaterThanOrEqual(1);

    const c = await owner.post('/v1/ads/campaigns', { businessId: biz.id, headline: 'New café in HSR!', body: 'Filter coffee 2 minutes from you. 20% off this week.', cta: 'WHATSAPP', radiusM: 2000, budgetPaise: 10000, cpmPaise: 5000, endAt: new Date(Date.now() + 7 * 86400_000).toISOString() });
    expect(c.status).toBe(201);
    expect(c.body.status).toBe('DRAFT');

    const broke = await owner.post(`/v1/ads/campaigns/${c.body.id}/launch`);
    expect(broke.status).toBe(400);
    expect(broke.body.error.message).toMatch(/Insufficient/);

    await topUp(owner, biz.id, 15000);
    const live = await owner.post(`/v1/ads/campaigns/${c.body.id}/launch`);
    expect(live.body).toMatchObject({ status: 'ACTIVE', remainingPaise: 10000 });
    expect((await owner.get(`/v1/businesses/${biz.id}/wallet`)).body.balancePaise).toBe(5000);

    const inside = await locationVerified('Inside', offset(HSR, 500, 0));
    const outside = await locationVerified('Outside', offset(HSR, 4000, 0));
    const feed = await inside.get('/v1/feed');
    expect(feed.body.sponsored[0]).toMatchObject({ headline: 'New café in HSR!', sponsored: true, business: { name: 'Filter Kaapi House' } });
    expect((await outside.get('/v1/ads/serve')).body.items).toHaveLength(0);

    // Impression billing: CPM ₹50 → 5 paise each; deduped per user per day.
    await inside.post(`/v1/ads/${c.body.id}/impression`);
    await inside.post(`/v1/ads/${c.body.id}/impression`);
    await inside.post(`/v1/ads/${c.body.id}/click`);
    const stats = await owner.get(`/v1/ads/campaigns/${c.body.id}`);
    expect(stats.body).toMatchObject({ impressions: 1, clicks: 1, spentPaise: 5, ctr: 100 });

    const ended = await owner.post(`/v1/ads/campaigns/${c.body.id}/end`);
    expect(ended.body.status).toBe('ENDED');
    expect((await owner.get(`/v1/businesses/${biz.id}/wallet`)).body.balancePaise).toBe(5000 + 9995);
    expect((await owner.post(`/v1/ads/campaigns/${c.body.id}/end`)).status).toBe(409);
    expect((await inside.get('/v1/ads/serve')).body.items).toHaveLength(0);
  });

  it('budget exhaustion flips status atomically and stops serving', async () => {
    const { owner, biz } = await bizOwner();
    await topUp(owner, biz.id, 10000);
    const c = await owner.post('/v1/ads/campaigns', { businessId: biz.id, headline: 'Tiny budget ad', body: 'This will run out very quickly', budgetPaise: 10000, cpmPaise: 100000, endAt: new Date(Date.now() + 86400_000).toISOString() });
    // ₹100 budget at ₹10/impression (CPM ₹10,000, set directly to keep the test small) → exactly 10 billable impressions.
    await prisma.adCampaign.update({ where: { id: c.body.id }, data: { cpmPaise: 1_000_000 } });
    await owner.post(`/v1/ads/campaigns/${c.body.id}/launch`);
    const viewers = await Promise.all(Array.from({ length: 12 }, (_, i) => locationVerified(`V${i}`, offset(HSR, i * 20, 0))));
    await Promise.all(viewers.map((v) => v.post(`/v1/ads/${c.body.id}/impression`)));
    const s = await owner.get(`/v1/ads/campaigns/${c.body.id}`);
    expect(s.body).toMatchObject({ status: 'EXHAUSTED', spentPaise: 10000, impressions: 10 });
    await drainJobs();
    expect(await prisma.notification.count({ where: { userId: owner.id, type: 'AD_STATUS' } })).toBe(1);
  });

  it('pause/resume, ownership checks, flagged copy goes to review, expired campaigns are swept with refund', async () => {
    const { owner, biz } = await bizOwner();
    await topUp(owner, biz.id, 30000);
    const mk = (over: object = {}) => owner.post('/v1/ads/campaigns', { businessId: biz.id, headline: 'Weekend special offer', body: 'Masala dosa + coffee combo for ₹99', budgetPaise: 10000, endAt: new Date(Date.now() + 86400_000).toISOString(), ...over });
    const c = (await mk()).body;
    const stranger = await locationVerified('Stranger');
    expect((await stranger.post(`/v1/ads/campaigns/${c.id}/launch`)).status).toBe(403);
    expect((await stranger.post('/v1/ads/campaigns', { businessId: biz.id, headline: 'Not mine at all', body: 'Trying to advertise for someone else', budgetPaise: 10000, endAt: new Date(Date.now() + 86400_000).toISOString() })).status).toBe(403);
    await owner.post(`/v1/ads/campaigns/${c.id}/launch`);
    expect((await owner.post(`/v1/ads/campaigns/${c.id}/pause`)).body.status).toBe('PAUSED');
    expect((await owner.post(`/v1/ads/campaigns/${c.id}/resume`)).body.status).toBe('ACTIVE');

    const scam = (await mk({ headline: 'Double your money fast', body: 'Guaranteed returns in 7 days, invest now' })).body;
    expect((await owner.post(`/v1/ads/campaigns/${scam.id}/launch`)).body.status).toBe('PENDING_REVIEW');

    await prisma.adCampaign.update({ where: { id: c.id }, data: { endAt: new Date(Date.now() - 1000), startAt: new Date(Date.now() - 86400_000) } });
    expect(await sweepExpiredCampaigns()).toBe(1);
    expect((await owner.get(`/v1/ads/campaigns/${c.id}`)).body.status).toBe('ENDED');
    expect((await owner.get(`/v1/businesses/${biz.id}/wallet`)).body.balancePaise).toBe(30000 - 10000 - 10000 + 10000);
    expect((await owner.get(`/v1/ads/campaigns?businessId=${biz.id}`)).body.items).toHaveLength(2);
    expect((await owner.post('/v1/ads/campaigns', { businessId: biz.id, headline: 'Too small budget', body: 'Under the minimum', budgetPaise: 500, endAt: new Date(Date.now() + 86400_000).toISOString() })).status).toBe(400);
  });
});

describe('verified workers (informal services)', () => {
  const worker = (over: object = {}) => ({ name: 'Ramesh Kumar', phone: '98450 11111', skills: ['PLUMBER'], languages: ['Kannada', 'Hindi'], about: 'Leakage, fittings, motor repair', rateNote: '₹300/visit', consent: true, ...over });

  it('requires consent, dedupes by phone, auto-vouches by the lister', async () => {
    const lister = await locationVerified('Priya');
    expect((await lister.post('/v1/providers', worker({ consent: false }))).status).toBe(400);
    const w = await lister.post('/v1/providers', worker());
    expect(w.status).toBe(201);
    expect(w.body).toMatchObject({ phone: '+919845011111', vouchCount: 1, canEdit: true });
    const other = await locationVerified('Arjun');
    expect((await other.post('/v1/providers', worker())).status).toBe(409);
  });

  it('search by skill, only within the worker’s service radius', async () => {
    const lister = await locationVerified('Priya');
    await lister.post('/v1/providers', worker({ serviceRadiusM: 2000 }));
    await lister.post('/v1/providers', worker({ name: 'Lakshmamma', phone: '9845022222', skills: ['MAID', 'COOK'], serviceRadiusM: 8000 }));
    const near = await locationVerified('Near', offset(HSR, 500, 0));
    const far = await locationVerified('Far', offset(HSR, 5000, 0));
    expect((await near.get('/v1/providers')).body.items).toHaveLength(2);
    expect((await near.get('/v1/providers?skill=COOK')).body.items.map((p: { name: string }) => p.name)).toEqual(['Lakshmamma']);
    expect((await far.get('/v1/providers')).body.items.map((p: { name: string }) => p.name)).toEqual(['Lakshmamma']);
  });

  it('vouching needs ADDRESS level and is one-per-user; reviews aggregate', async () => {
    const lister = await locationVerified('Priya');
    const w = (await lister.post('/v1/providers', worker())).body;
    const loc = await locationVerified('Loc');
    expect((await loc.post(`/v1/providers/${w.id}/vouch`, { note: 'Great' })).status).toBe(403);
    const addr = await addressVerified('Addr');
    expect((await addr.post(`/v1/providers/${w.id}/vouch`, { note: 'Fixed our motor in 1 hour' })).body.vouchCount).toBe(2);
    expect((await addr.post(`/v1/providers/${w.id}/vouch`)).status).toBe(409);
    await loc.post(`/v1/providers/${w.id}/reviews`, { rating: 5, body: 'Punctual' });
    await addr.post(`/v1/providers/${w.id}/reviews`, { rating: 4 });
    const d = await addr.get(`/v1/providers/${w.id}`);
    expect(d.body).toMatchObject({ ratingAvg: 4.5, ratingCount: 2, vouchedByMe: true, vouchCount: 2 });
    expect(d.body.vouches).toHaveLength(2);
    expect((await addr.del(`/v1/providers/${w.id}/vouch`)).status).toBe(200);
    expect((await addr.get(`/v1/providers/${w.id}`)).body.vouchCount).toBe(1);
    expect((await loc.patch(`/v1/providers/${w.id}`, { rateNote: 'free' })).status).toBe(403);
    expect((await lister.patch(`/v1/providers/${w.id}`, { rateNote: '₹350/visit' })).body.rateNote).toBe('₹350/visit');
  });
});
