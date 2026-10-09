import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { decodeCursor, encodeCursor, timeCursor } from '../lib/pagination';
import { me, requireAuth, uuidParams } from '../middleware/auth';
import { q, validate } from '../middleware/validate';

export const notificationsRouter = Router();
uuidParams(notificationsRouter, 'id');
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', validate('query', z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(30) })), async (req, res) => {
  const { cursor, limit } = q<{ cursor?: string; limit: number }>(req);
  const cur = decodeCursor(cursor, timeCursor);
  const items = await prisma.notification.findMany({
    where: {
      userId: me(req).id,
      ...(cur ? { OR: [{ createdAt: { lt: new Date(cur.t) } }, { createdAt: new Date(cur.t), id: { lt: cur.id } }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const page = items.slice(0, limit);
  const last = page[page.length - 1];
  res.json({ items: page, nextCursor: items.length > limit && last ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id }) : null });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: me(req).id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  await prisma.notification.updateMany({ where: { id: req.params.id, userId: me(req).id }, data: { readAt: new Date() } });
  res.json({ ok: true });
});
