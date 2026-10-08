import { beforeEach, describe, expect, it } from 'vitest';
import { drainJobs, HSR, locationVerified, login, offset, prisma, resetDb, setHome } from './helpers';

beforeEach(resetDb);

describe('1:1 messaging (e.g. classifieds)', () => {
  it('buyer messages seller about a listing; unread badges, read receipts and polling work', async () => {
    const seller = await locationVerified('Seller');
    const buyer = await locationVerified('Buyer', offset(HSR, 200, 0));
    const post = (await seller.post('/v1/posts', { type: 'CLASSIFIED', title: 'Study table', body: 'IKEA, like new', pricePaise: 450000, condition: 'LIKE_NEW' })).body;

    const start = await buyer.post('/v1/conversations', { userId: seller.id, postId: post.id, body: 'Is this still available?' });
    expect(start.status).toBe(201);
    // Starting again reuses the same conversation (ordered pair).
    const again = await seller.post('/v1/conversations', { userId: buyer.id, body: 'Yes it is!' });
    expect(again.body.id).toBe(start.body.id);

    expect((await seller.get('/v1/me/badges')).body.messages).toBe(0); // seller just replied
    expect((await buyer.get('/v1/me/badges')).body.messages).toBe(1);
    const inbox = await seller.get('/v1/conversations');
    expect(inbox.body.items[0]).toMatchObject({ lastMessage: 'Yes it is!', other: { name: 'Buyer' } });
    const conv = await buyer.get(`/v1/conversations/${start.body.id}`);
    expect(conv.body.post).toMatchObject({ title: 'Study table', pricePaise: 450000 });

    const msgs = await buyer.get(`/v1/conversations/${start.body.id}/messages`);
    expect(msgs.body.items.map((m: { body: string }) => m.body)).toEqual(['Yes it is!', 'Is this still available?']);
    const since = msgs.body.items[0].createdAt;
    await seller.post(`/v1/conversations/${start.body.id}/messages`, { body: 'Can you pick it up today?' });
    const poll = await buyer.get(`/v1/conversations/${start.body.id}/messages?after=${encodeURIComponent(since)}`);
    expect(poll.body.items.map((m: { body: string }) => m.body)).toEqual(['Can you pick it up today?']);

    expect((await buyer.get('/v1/me/badges')).body.messages).toBe(1);
    await buyer.post(`/v1/conversations/${start.body.id}/read`);
    expect((await buyer.get('/v1/me/badges')).body.messages).toBe(0);
    await drainJobs();
    expect(await prisma.notification.count({ where: { userId: buyer.id, type: 'MESSAGE' } })).toBe(2);
  });

  it('third parties cannot read; blocked users cannot message; PHONE-level users cannot start chats', async () => {
    const a = await locationVerified('A');
    const b = await locationVerified('B');
    const c = await locationVerified('C');
    const conv = (await a.post('/v1/conversations', { userId: b.id, body: 'Hi B' })).body;
    expect((await c.get(`/v1/conversations/${conv.id}/messages`)).status).toBe(404);
    expect((await c.post(`/v1/conversations/${conv.id}/messages`, { body: 'sneaky' })).status).toBe(404);
    await b.post(`/v1/users/${a.id}/block`);
    expect((await a.post(`/v1/conversations/${conv.id}/messages`, { body: 'hello?' })).status).toBe(403);
    expect((await a.post('/v1/conversations', { userId: b.id, body: 'new chat' })).status).toBe(403);
    expect((await a.post('/v1/conversations', { userId: a.id, body: 'me' })).status).toBe(400);
    const p = await login();
    await setHome(p, HSR);
    expect((await p.post('/v1/conversations', { userId: a.id, body: 'hi' })).status).toBe(403);
  });
});

describe('notifications', () => {
  it('lists, paginates, marks read', async () => {
    const u = await login();
    await prisma.notification.createMany({ data: Array.from({ length: 5 }, (_, i) => ({ userId: u.id, type: 'SYSTEM' as const, title: `N${i}`, body: 'x', createdAt: new Date(Date.now() - i * 1000) })) });
    const p1 = await u.get('/v1/notifications?limit=3');
    expect(p1.body.items.map((n: { title: string }) => n.title)).toEqual(['N0', 'N1', 'N2']);
    const p2 = await u.get(`/v1/notifications?limit=3&cursor=${p1.body.nextCursor}`);
    expect(p2.body.items.map((n: { title: string }) => n.title)).toEqual(['N3', 'N4']);
    expect((await u.get('/v1/me/badges')).body.notifications).toBe(5);
    await u.post(`/v1/notifications/${p1.body.items[0].id}/read`);
    expect((await u.get('/v1/me/badges')).body.notifications).toBe(4);
    await u.post('/v1/notifications/read-all');
    expect((await u.get('/v1/me/badges')).body.notifications).toBe(0);
  });

  it('registers and removes push tokens', async () => {
    const u = await login();
    expect((await u.post('/v1/me/push-tokens', { token: 'ExponentPushToken[abc123xyz]', platform: 'android' })).status).toBe(200);
    expect(await prisma.pushToken.count({ where: { userId: u.id } })).toBe(1);
    expect((await u.del('/v1/me/push-tokens', { token: 'ExponentPushToken[abc123xyz]' })).status).toBe(200);
    expect(await prisma.pushToken.count({ where: { userId: u.id } })).toBe(0);
  });
});
