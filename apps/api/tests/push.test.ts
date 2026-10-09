/** Expo push contract tests — exp.host is mocked at the fetch boundary. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import { __pushTestHooks, checkPushReceipts, sendPush } from '../src/services/push';
import { login, prisma, resetDb } from './helpers';

const realFetch = globalThis.fetch;
let calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];

function mockExpo(handler: (url: string, body: unknown, n: number) => Response) {
  let n = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.startsWith('https://exp.host/')) return realFetch(input, init);
    const body = JSON.parse(String(init?.body));
    calls.push({ url, body, headers: init?.headers as Record<string, string> });
    return handler(url, body, n++);
  });
}

beforeEach(async () => {
  await resetDb();
  calls = [];
  __pushTestHooks.pendingReceipts.clear();
  Object.assign(env, { PUSH_ENABLED: true, EXPO_ACCESS_TOKEN: 'expo-token-123' });
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(env, { PUSH_ENABLED: false, EXPO_ACCESS_TOKEN: '' });
});

async function usersWithTokens(n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const u = await prisma.user.create({ data: { phone: `+9171${String(i).padStart(8, '0')}` } });
    await prisma.pushToken.create({ data: { userId: u.id, token: `ExponentPushToken[t${i}]`, platform: 'android' } });
    ids.push(u.id);
  }
  return ids;
}

describe('Expo push', () => {
  it('chunks at 100, sends auth header, prunes DeviceNotRegistered tickets, queues ok tickets for receipts', async () => {
    const ids = await usersWithTokens(230);
    mockExpo((_u, body) => {
      const msgs = body as { to: string }[];
      return Response.json({ data: msgs.map((m) => (m.to === 'ExponentPushToken[t5]' ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: `ticket-${m.to}` })) });
    });
    await sendPush(ids, { title: 'Alert', body: 'Hello', priority: 'high', channelId: 'alerts' });
    expect(calls.map((c) => (c.body as unknown[]).length)).toEqual([100, 100, 30]);
    expect(calls[0].headers.Authorization).toBe('Bearer expo-token-123');
    expect((calls[0].body as Record<string, unknown>[])[0]).toMatchObject({ title: 'Alert', priority: 'high', channelId: 'alerts', sound: 'default' });
    expect(await prisma.pushToken.count()).toBe(229);
    expect(__pushTestHooks.pendingReceipts.size).toBe(229);
  });

  it('retries 429/5xx with backoff and gives up gracefully', async () => {
    const ids = await usersWithTokens(1);
    mockExpo((_u, body, n) => (n < 2 ? new Response('busy', { status: n === 0 ? 429 : 503 }) : Response.json({ data: (body as unknown[]).map(() => ({ status: 'ok', id: 'x' })) })));
    await sendPush(ids, { title: 't', body: 'b' });
    expect(calls).toHaveLength(3);
  });

  it('receipts: DeviceNotRegistered prunes the token; only due tickets are checked', async () => {
    const ids = await usersWithTokens(3);
    mockExpo((url, body) => {
      if (url.endsWith('/push/send')) return Response.json({ data: (body as { to: string }[]).map((m, i) => ({ status: 'ok', id: `r${i}` })) });
      const reqIds = (body as { ids: string[] }).ids;
      return Response.json({ data: Object.fromEntries(reqIds.map((id) => [id, id === 'r1' ? { status: 'error', message: 'unreg', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }])) });
    });
    await sendPush(ids, { title: 't', body: 'b' });
    expect((await checkPushReceipts(Date.now())).checked).toBe(0); // not due yet
    const r = await checkPushReceipts(Date.now() + __pushTestHooks.RECEIPT_DELAY_MS + 1000);
    expect(r).toEqual({ checked: 3, pruned: 1 });
    expect(calls.find((c) => c.url.endsWith('/getReceipts'))?.body).toEqual({ ids: ['r0', 'r1', 'r2'] });
    expect(await prisma.pushToken.count()).toBe(2);
    expect(__pushTestHooks.pendingReceipts.size).toBe(0);
  });

  it('end-to-end: a CRITICAL alert pushes to neighbours’ devices', async () => {
    const { locationVerified, offset, HSR, drainJobs } = await import('./helpers');
    const reporter = await locationVerified('Reporter');
    const near = await locationVerified('Near', offset(HSR, 300, 0));
    await drainJobs(); // flush the async "Location verified" notification before the device registers
    await prisma.pushToken.create({ data: { userId: near.id, token: 'ExponentPushToken[near]', platform: 'ios' } });
    mockExpo((_u, body) => Response.json({ data: (body as unknown[]).map(() => ({ status: 'ok', id: 'a' })) }));
    await reporter.post('/v1/posts', { type: 'ALERT', title: 'Fire in Tower B', body: 'Smoke on 7th floor, evacuate', severity: 'CRITICAL' });
    await drainJobs();
    const sent = calls.flatMap((c) => c.body as { to: string; priority: string; channelId: string }[]);
    expect(sent).toEqual([expect.objectContaining({ to: 'ExponentPushToken[near]', priority: 'high', channelId: 'alerts' })]);
    await login(); // keep helpers import used
  });
});
