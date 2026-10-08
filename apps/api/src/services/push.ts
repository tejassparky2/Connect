import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  priority?: 'default' | 'high';
  channelId?: string;
}

/** Deliver via the Expo push service in chunks of 100 (Expo's limit). Prunes dead tokens. */
export async function sendPush(userIds: string[], msg: Omit<PushMessage, 'to'>): Promise<void> {
  if (!env.PUSH_ENABLED || userIds.length === 0) return;
  const tokens = await prisma.pushToken.findMany({ where: { userId: { in: userIds } }, select: { token: true } });
  const messages: PushMessage[] = tokens.map((t) => ({ to: t.token, sound: 'default', ...msg }));
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(chunk),
      });
      const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
      const dead = (json.data ?? [])
        .map((r, idx) => (r.status === 'error' && r.details?.error === 'DeviceNotRegistered' ? chunk[idx].to : null))
        .filter((t): t is string => !!t);
      if (dead.length) await prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
    } catch (err) {
      logger.warn({ err }, 'Expo push chunk failed');
    }
  }
}
