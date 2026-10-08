import { NotificationType, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { streamUserIdsWithin, type LatLng } from '../lib/geo';
import { enqueue } from './jobs';
import { sendPush } from './push';

interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  highPriority?: boolean;
}

/** Persist in-app notifications for a set of users and push them (chunked). */
export async function notifyUsers(userIds: string[], n: NotifyInput): Promise<void> {
  const ids = [...new Set(userIds)];
  for (let i = 0; i < ids.length; i += 1000) {
    const slice = ids.slice(i, i + 1000);
    await prisma.notification.createMany({
      data: slice.map((userId) => ({ userId, type: n.type, title: n.title, body: n.body, data: (n.data ?? undefined) as Prisma.InputJsonValue | undefined })),
    });
    await sendPush(slice, {
      title: n.title,
      body: n.body,
      data: { type: n.type, ...n.data },
      priority: n.highPriority ? 'high' : 'default',
      channelId: n.highPriority ? 'alerts' : 'default',
    });
  }
}

export function notifyLater(userIds: string[], n: NotifyInput): void {
  if (!userIds.length) return;
  enqueue(`notify:${n.type}`, () => notifyUsers(userIds, n));
}

/** Fan-out to everyone living within a radius — streamed in batches so memory stays flat. */
export function notifyRadiusLater(center: LatLng, radiusM: number, excludeUserId: string, n: NotifyInput): void {
  enqueue(`notify-radius:${n.type}`, async () => {
    for await (const batch of streamUserIdsWithin({ center, radiusM, excludeUserId, batchSize: 1000 })) {
      await notifyUsers(batch, n);
    }
  });
}
