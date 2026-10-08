import { beforeEach, describe, expect, it } from 'vitest';
import { addressVerified, DELHI, drainJobs, HSR, KORA, locationVerified, login, offset, prisma, resetDb, setHome } from './helpers';

beforeEach(resetDb);

describe('posts: creation rules per type', () => {
  it('validates type-specific fields', async () => {
    const u = await locationVerified('Seller');
    expect((await u.post('/v1/posts', { type: 'CLASSIFIED', body: 'Selling a sofa' })).status).toBe(400); // no title/price
    const ok = await u.post('/v1/posts', { type: 'CLASSIFIED', title: '3-seater sofa', body: 'Good condition, pickup only', pricePaise: 1200000, condition: 'GOOD' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ type: 'CLASSIFIED', pricePaise: 1200000, isMine: true, isSold: false });
    expect((await u.post('/v1/posts', { type: 'HOBBY', body: 'Anyone for chess?' })).status).toBe(400); // needs hobbyTag
    expect((await u.post('/v1/posts', { type: 'HOBBY', body: 'Anyone for chess?', hobbyTag: 'chess' })).status).toBe(201);
    expect((await u.post('/v1/posts', { type: 'EVENT', title: 'Past party', body: 'This already happened', eventAt: '2020-01-01' })).status).toBe(400);
    const alert = await u.post('/v1/posts', { type: 'ALERT', title: 'Water logging', body: 'Knee-deep water near 5th cross', severity: 'WARNING' });
    expect(alert.status).toBe(201);
    expect(new Date(alert.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect((await u.post('/v1/posts', { type: 'NOPE', body: 'x' })).status).toBe(400);
  });

  it('post location is snapped to a ~150 m grid, never the exact home', async () => {
    const home = { lat: 12.911634, lng: 77.647421 };
    const u = await locationVerified('Privacy', home);
    const p = await u.post('/v1/posts', { type: 'GENERAL', body: 'Hello from my flat' });
    const rows = await prisma.$queryRaw<{ lat: number; lng: number }[]>`SELECT ST_Y(location::geometry) lat, ST_X(location::geometry) lng FROM posts WHERE id = ${p.body.id}::uuid`;
    expect(rows[0].lat).not.toBeCloseTo(home.lat, 5);
    expect(Math.abs(rows[0].lat - home.lat)).toBeLessThan(0.0015);
    expect(Number((rows[0].lat / 0.0015).toFixed(6)) % 1).toBe(0);
  });

  it('rate-limits alerts to 3 a day', async () => {
    const u = await locationVerified('Alerter');
    for (let i = 0; i < 3; i++) expect((await u.post('/v1/posts', { type: 'ALERT', title: `Alert ${i}`, body: 'Something happened here', severity: 'INFO' })).status).toBe(201);
    const r = await u.post('/v1/posts', { type: 'ALERT', title: 'Fourth', body: 'Something else happened', severity: 'INFO' });
    expect(r.status).toBe(429);
    expect(r.body.error.message).toMatch(/112/);
  });

  it('auto-moderation routes scammy content to review', async () => {
    const u = await locationVerified('Scammer');
    const r = await u.post('/v1/posts', { type: 'GENERAL', body: 'Your electricity will be cut, KYC update needed, share OTP now' });
    expect(r.status).toBe(201);
    expect(r.body.underReview).toBe(true);
    const v = await locationVerified('Viewer');
    expect((await v.get('/v1/feed')).body.items).toHaveLength(0);
  });
});

describe('geo-fenced feed', () => {
  it('shows posts within the radius only, nearest-relevant first by recency', async () => {
    const near = await locationVerified('Near', offset(HSR, 500, 0));
    const mid = await locationVerified('Mid', offset(HSR, 2500, 0));
    const far = await locationVerified('Far', KORA); // ~3.3 km
    const delhi = await locationVerified('Delhi', DELHI);
    for (const [u, t] of [[near, 'near'], [mid, 'mid'], [far, 'far'], [delhi, 'delhi']] as const) {
      await u.post('/v1/posts', { type: 'GENERAL', body: `post from ${t} neighbour` });
    }
    const viewer = await locationVerified('Viewer', HSR);
    const two = await viewer.get('/v1/feed?radius=2000');
    expect(two.body.items.map((p: { body: string }) => p.body)).toEqual(['post from near neighbour']);
    const five = await viewer.get('/v1/feed?radius=5000');
    expect(five.body.items.map((p: { body: string }) => p.body).sort()).toEqual(['post from far neighbour', 'post from mid neighbour', 'post from near neighbour']);
    expect(five.body.items.every((p: { distanceM: number }) => p.distanceM % 100 === 0)).toBe(true);
  });

  it('cold start: a sparse area auto-expands to 5 km and says so', async () => {
    const poster = await locationVerified('Poster', offset(HSR, 4000, 0));
    await poster.post('/v1/posts', { type: 'GENERAL', body: 'Only post for miles' });
    const viewer = await locationVerified('Viewer', HSR);
    const r = await viewer.get('/v1/feed');
    expect(r.body).toMatchObject({ radiusM: 5000, expanded: true });
    expect(r.body.items).toHaveLength(1);
    // Explicit radius disables auto-expand.
    const explicit = await viewer.get('/v1/feed?radius=3000');
    expect(explicit.body).toMatchObject({ radiusM: 3000, expanded: false });
    expect(explicit.body.items).toHaveLength(0);
  });

  it('filters by type and paginates with a stable keyset cursor', async () => {
    const u = await locationVerified('Prolific');
    await prisma.$executeRaw`UPDATE users SET "verificationLevel" = 'ADDRESS' WHERE id = ${u.id}::uuid`;
    for (let i = 0; i < 12; i++) {
      await u.post('/v1/posts', i % 3 === 0
        ? { type: 'CLASSIFIED', title: `Item ${i}`, body: 'For sale nearby', pricePaise: 1000 * i, condition: 'GOOD' }
        : { type: 'GENERAL', body: `General post number ${i}` });
    }
    const v = await locationVerified('Reader');
    const classifieds = await v.get('/v1/feed?type=CLASSIFIED');
    expect(classifieds.body.items).toHaveLength(4);
    expect(classifieds.body.items.every((p: { type: string }) => p.type === 'CLASSIFIED')).toBe(true);

    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const r = await v.get(`/v1/feed?limit=5${cursor ? `&cursor=${cursor}` : ''}`);
      ids.push(...r.body.items.map((p: { id: string }) => p.id));
      cursor = r.body.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
    expect((await v.get('/v1/feed?cursor=not-a-cursor')).status).toBe(400);
  });

  it('pins active WARNING/CRITICAL alerts and fans out notifications to neighbours within 2 km', async () => {
    const reporter = await locationVerified('Reporter', HSR);
    const close = await locationVerified('Close', offset(HSR, 800, 0));
    const away = await locationVerified('Away', offset(HSR, 3500, 0));
    const r = await reporter.post('/v1/posts', { type: 'ALERT', title: 'Leopard sighted', body: 'Near the lake park — keep pets inside', severity: 'CRITICAL' });
    expect(r.status).toBe(201);
    await drainJobs();
    expect(await prisma.notification.count({ where: { userId: close.id, type: 'ALERT_NEARBY' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: away.id, type: 'ALERT_NEARBY' } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: reporter.id, type: 'ALERT_NEARBY' } })).toBe(0);
    const feed = await close.get('/v1/feed');
    expect(feed.body.pinnedAlerts[0]).toMatchObject({ title: 'Leopard sighted', severity: 'CRITICAL' });
  });

  it('users without a home get a clear error', async () => {
    const u = await login();
    const r = await u.get('/v1/feed');
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/home address/);
  });
});

describe('engagement', () => {
  it('likes are idempotent and counted; comments notify the author', async () => {
    const author = await locationVerified('Author');
    const fan = await locationVerified('Fan', offset(HSR, 100, 100));
    const p = (await author.post('/v1/posts', { type: 'GENERAL', body: 'Lovely sunset today' })).body;
    expect((await fan.post(`/v1/posts/${p.id}/like`)).body).toEqual({ liked: true, likeCount: 1 });
    expect((await fan.post(`/v1/posts/${p.id}/like`)).body).toEqual({ liked: true, likeCount: 1 });
    expect((await fan.get(`/v1/posts/${p.id}`)).body.likedByMe).toBe(true);
    expect((await fan.del(`/v1/posts/${p.id}/like`)).body).toEqual({ liked: false, likeCount: 0 });
    expect((await fan.del(`/v1/posts/${p.id}/like`)).body).toEqual({ liked: false, likeCount: 0 });

    const c = await fan.post(`/v1/posts/${p.id}/comments`, { body: 'Gorgeous!' });
    expect(c.status).toBe(201);
    const list = await author.get(`/v1/posts/${p.id}/comments`);
    expect(list.body.items).toHaveLength(1);
    expect((await author.get(`/v1/posts/${p.id}`)).body.commentCount).toBe(1);
    await drainJobs();
    expect(await prisma.notification.count({ where: { userId: author.id, type: 'POST_COMMENT' } })).toBe(1);

    // Post author can moderate comments on their thread.
    expect((await author.del(`/v1/comments/${c.body.id}`)).status).toBe(200);
    expect((await author.get(`/v1/posts/${p.id}`)).body.commentCount).toBe(0);
  });

  it('only the author can edit; mark-as-sold only for classifieds; delete hides the post', async () => {
    const seller = await locationVerified('Seller');
    const other = await locationVerified('Other');
    const p = (await seller.post('/v1/posts', { type: 'CLASSIFIED', title: 'Old fridge', body: 'Works fine, 190L', pricePaise: 500000, condition: 'FAIR' })).body;
    expect((await other.patch(`/v1/posts/${p.id}`, { isSold: true })).status).toBe(403);
    expect((await seller.patch(`/v1/posts/${p.id}`, { isSold: true, pricePaise: 450000 })).body).toMatchObject({ isSold: true, pricePaise: 450000 });
    const g = (await seller.post('/v1/posts', { type: 'GENERAL', body: 'Just a post' })).body;
    expect((await seller.patch(`/v1/posts/${g.id}`, { isSold: true })).status).toBe(400);
    expect((await seller.del(`/v1/posts/${p.id}`)).status).toBe(200);
    expect((await other.get(`/v1/posts/${p.id}`)).status).toBe(404);
    expect((await seller.get('/v1/me/posts')).body.items.map((x: { id: string }) => x.id)).not.toContain(p.id);
  });

  it('far-away users cannot open a post by id (anti-scraping), blocked users vanish', async () => {
    const author = await locationVerified('Author');
    const p = (await author.post('/v1/posts', { type: 'GENERAL', body: 'Local only' })).body;
    const delhi = await locationVerified('Delhi', DELHI);
    expect((await delhi.get(`/v1/posts/${p.id}`)).status).toBe(404);

    const blocker = await locationVerified('Blocker', offset(HSR, 50, 50));
    expect((await blocker.get('/v1/feed')).body.items).toHaveLength(1);
    expect((await blocker.post(`/v1/users/${author.id}/block`)).status).toBe(200);
    expect((await blocker.get('/v1/feed')).body.items).toHaveLength(0);
    expect((await blocker.get(`/v1/posts/${p.id}`)).status).toBe(404);
    // Block is bidirectional for visibility.
    const authorFeed = await author.get('/v1/feed');
    expect(authorFeed.status).toBe(200);
    expect((await blocker.del(`/v1/users/${author.id}/block`)).status).toBe(200);
    expect((await blocker.get('/v1/feed')).body.items).toHaveLength(1);
  });

  it('3 distinct reports auto-hide a post', async () => {
    const author = await locationVerified('Author');
    const p = (await author.post('/v1/posts', { type: 'GENERAL', body: 'Questionable content' })).body;
    for (let i = 0; i < 3; i++) {
      const r = await (await login()).post('/v1/reports', { targetType: 'POST', targetId: p.id, reason: 'SPAM' });
      expect(r.status).toBe(201);
    }
    const viewer = await addressVerified('Viewer');
    expect((await viewer.get('/v1/feed')).body.items).toHaveLength(0);
    const dup = await login();
    await dup.post('/v1/reports', { targetType: 'POST', targetId: p.id, reason: 'SPAM' });
    expect((await dup.post('/v1/reports', { targetType: 'POST', targetId: p.id, reason: 'SPAM' })).status).toBe(409);
  });

  it('neighbourhood stats count neighbours and recent posts in radius', async () => {
    const a = await locationVerified('A');
    await locationVerified('B', offset(HSR, 300, 0));
    await locationVerified('C', offset(HSR, 9000, 0));
    await a.post('/v1/posts', { type: 'GENERAL', body: 'Stats test post' });
    const s = await a.get('/v1/me/neighborhood');
    expect(s.body).toMatchObject({ neighborsInRadius: 1, postsThisWeek: 1, radiusM: 3000 });
    const u = await login();
    await setHome(u, HSR);
    expect((await u.get('/v1/me/neighbors')).status).toBe(403);
  });
});
