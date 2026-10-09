/**
 * Expo push delivery (https://docs.expo.dev/push-notifications/sending-notifications/).
 *
 *  • Send in chunks of ≤100 messages to /push/send.
 *  • Retry 429 / 5xx with exponential backoff; log top-level `errors` (e.g. TOO_MANY_REQUESTS).
 *  • Tickets with `DeviceNotRegistered` → delete the token immediately.
 *  • OK tickets carry an id; FCM/APNs failures only show up later in RECEIPTS, so ticket ids
 *    are queued and checked ~15 minutes later via /push/getReceipts (≤1000 ids per call;
 *    receipts expire after 24 h). DeviceNotRegistered receipts also prune tokens.
 */
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const RECEIPT_DELAY_MS = 15 * 60_000;

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  priority?: 'default' | 'high';
  channelId?: string;
}

interface Ticket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** ticket id → token, awaiting a receipt check. */
const pendingReceipts = new Map<string, { token: string; at: number }>();

const headers = () => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST with retry on 429/5xx/network errors (3 attempts, 1s → 2s → 4s). */
async function postWithRetry(url: string, payload: unknown, attempts = 3): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(payload) });
      if (res.status === 429 || res.status >= 500) throw new Error(`Expo push HTTP ${res.status}`);
      const json = (await res.json()) as Record<string, unknown>;
      if (Array.isArray(json.errors) && json.errors.length) logger.warn({ errors: json.errors }, 'Expo push request errors');
      return json;
    } catch (err) {
      if (i === attempts - 1) {
        logger.warn({ err }, 'Expo push request failed after retries');
        return null;
      }
      await sleep(1000 * 2 ** i * (process.env.NODE_ENV === 'test' ? 0.01 : 1));
    }
  }
  return null;
}

async function pruneTokens(tokens: string[]) {
  if (tokens.length) await prisma.pushToken.deleteMany({ where: { token: { in: tokens } } });
}

export async function sendPush(userIds: string[], msg: Omit<PushMessage, 'to'>): Promise<void> {
  if (!env.PUSH_ENABLED || userIds.length === 0) return;
  const tokens = await prisma.pushToken.findMany({ where: { userId: { in: userIds } }, select: { token: true } });
  const messages: PushMessage[] = tokens.map((t) => ({ to: t.token, sound: 'default', ...msg }));
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const json = await postWithRetry(SEND_URL, chunk);
    const tickets = (json?.data ?? []) as Ticket[];
    const dead: string[] = [];
    tickets.forEach((t, idx) => {
      const token = chunk[idx]?.to;
      if (!token) return;
      if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') dead.push(token);
      else if (t.status === 'ok' && t.id) pendingReceipts.set(t.id, { token, at: Date.now() });
    });
    await pruneTokens(dead);
  }
}

/** Check receipts for tickets older than RECEIPT_DELAY_MS. Called by the scheduler in server.ts. */
export async function checkPushReceipts(now = Date.now()): Promise<{ checked: number; pruned: number }> {
  const due = [...pendingReceipts.entries()].filter(([, v]) => now - v.at >= RECEIPT_DELAY_MS || now - v.at > 23 * 3600_000);
  let pruned = 0;
  for (let i = 0; i < due.length; i += 1000) {
    const batch = due.slice(i, i + 1000);
    const json = await postWithRetry(RECEIPTS_URL, { ids: batch.map(([id]) => id) });
    if (!json) continue; // retry on the next sweep
    const receipts = (json.data ?? {}) as Record<string, Ticket>;
    const dead: string[] = [];
    for (const [id, { token }] of batch) {
      const r = receipts[id];
      if (r?.status === 'error') {
        if (r.details?.error === 'DeviceNotRegistered') dead.push(token);
        else logger.warn({ error: r.details?.error, message: r.message }, 'Push receipt error');
      }
      pendingReceipts.delete(id);
    }
    pruned += dead.length;
    await pruneTokens(dead);
  }
  return { checked: due.length, pruned };
}

export const __pushTestHooks = { pendingReceipts, RECEIPT_DELAY_MS };
