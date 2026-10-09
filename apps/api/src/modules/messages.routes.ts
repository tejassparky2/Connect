import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { decodeCursor, encodeCursor, timeCursor } from '../lib/pagination';
import { publicUserSelect, toPublicUser } from '../lib/serializers';
import { me, requireAuth, requireLevel, uuidParams } from '../middleware/auth';
import { q, validate } from '../middleware/validate';
import { perUser } from '../middleware/limits';
import { getUserHome, pointSql } from '../lib/geo';
import { clean } from '../services/moderation';
import { notifyLater } from '../services/notify';

export const messagesRouter = Router();
const messageLimiter = perUser(10 * 60_000, 60, 'You are sending messages too fast. Please slow down.');
uuidParams(messagesRouter, 'id');
messagesRouter.use(requireAuth);

/** Pairs are stored ordered so (A,B) and (B,A) map to the same row (DB CHECK enforces it). */
const orderPair = (a: string, b: string) => (a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a });

async function assertNotBlocked(a: string, b: string) {
  const block = await prisma.block.findFirst({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } });
  if (block) throw forbidden('You cannot message this user');
}

async function loadConversation(id: string, userId: string) {
  const c = await prisma.conversation.findUnique({ where: { id } });
  if (!c || (c.userAId !== userId && c.userBId !== userId)) throw notFound('Conversation');
  return c;
}

messagesRouter.get('/', async (req, res) => {
  const userId = me(req).id;
  const convs = await prisma.conversation.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }], lastMessage: { not: null } },
    include: { userA: { select: publicUserSelect }, userB: { select: publicUserSelect } },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
  });
  res.json({
    items: convs.map((c) => {
      const mine = c.userAId === userId;
      const lastRead = mine ? c.aLastReadAt : c.bLastReadAt;
      return {
        id: c.id,
        postId: c.postId,
        lastMessage: c.lastMessage,
        lastMessageAt: c.lastMessageAt,
        unread: !lastRead || lastRead < c.lastMessageAt,
        other: toPublicUser(mine ? c.userB : c.userA),
      };
    }),
  });
});

/** Start (or continue) a 1:1 chat — e.g. "Is this still available?" on a classified. */
messagesRouter.post(
  '/',
  requireLevel('LOCATION'),
  messageLimiter,
  validate('body', z.object({ userId: z.uuid(), postId: z.uuid().optional(), body: z.string().trim().min(1).max(2000) })),
  async (req, res) => {
    const sender = me(req);
    if (req.body.userId === sender.id) throw badRequest("You can't message yourself");
    const other = await prisma.user.findFirst({ where: { id: req.body.userId, deletedAt: null, isBanned: false }, select: { id: true } });
    if (!other) throw notFound('User');
    await assertNotBlocked(sender.id, other.id);
    // A chat may only reference a listing the sender can actually see (active, within 10 km).
    if (req.body.postId) {
      const home = await getUserHome(sender.id);
      const ok = home && (await prisma.$queryRaw<{ ok: boolean }[]>`
        SELECT true AS ok FROM posts WHERE id = ${req.body.postId}::uuid AND status = 'ACTIVE' AND ST_DWithin(location, ${pointSql(home)}, 10000)`).length;
      if (!ok) throw notFound('Post');
    }
    const pair = orderPair(sender.id, other.id);
    const body = clean(req.body.body);
    const conv = await prisma.$transaction(async (tx) => {
      const c = await tx.conversation.upsert({
        where: { userAId_userBId: pair },
        create: { ...pair, postId: req.body.postId },
        update: req.body.postId ? { postId: req.body.postId } : {},
      });
      await tx.message.create({ data: { conversationId: c.id, senderId: sender.id, body } });
      const now = new Date();
      return tx.conversation.update({
        where: { id: c.id },
        data: { lastMessage: body.slice(0, 200), lastMessageAt: now, ...(c.userAId === sender.id ? { aLastReadAt: now } : { bLastReadAt: now }) },
      });
    });
    notifyLater([other.id], { type: 'MESSAGE', title: sender.name ?? 'New message', body: body.slice(0, 120), data: { conversationId: conv.id } });
    res.status(201).json({ id: conv.id });
  },
);

messagesRouter.get('/:id', async (req, res) => {
  const userId = me(req).id;
  const c = await loadConversation(req.params.id, userId);
  const otherId = c.userAId === userId ? c.userBId : c.userAId;
  const other = await prisma.user.findUniqueOrThrow({ where: { id: otherId }, select: publicUserSelect });
  const post = c.postId ? await prisma.post.findUnique({ where: { id: c.postId }, select: { id: true, title: true, pricePaise: true, images: true, isSold: true } }) : null;
  res.json({ id: c.id, other: toPublicUser(other), post });
});

messagesRouter.get(
  '/:id/messages',
  validate('query', z.object({ cursor: z.string().optional(), after: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })),
  async (req, res) => {
    const userId = me(req).id;
    const c = await loadConversation(req.params.id, userId);
    const query = q<{ cursor?: string; after?: string; limit: number }>(req);
    const cur = decodeCursor(query.cursor, timeCursor);
    // `after` = polling for new messages; `cursor` = loading older history.
    const msgs = await prisma.message.findMany({
      where: {
        conversationId: c.id,
        ...(query.after ? { createdAt: { gt: new Date(query.after) } } : {}),
        ...(cur ? { OR: [{ createdAt: { lt: new Date(cur.t) } }, { createdAt: new Date(cur.t), id: { lt: cur.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = msgs.length > query.limit;
    const page = msgs.slice(0, query.limit);
    const last = page[page.length - 1];
    res.json({
      items: page.map((m) => ({ id: m.id, body: m.body, createdAt: m.createdAt, isMine: m.senderId === userId })),
      nextCursor: hasMore && last && !query.after ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id }) : null,
    });
  },
);

messagesRouter.post('/:id/messages', requireLevel('LOCATION'), messageLimiter, validate('body', z.object({ body: z.string().trim().min(1).max(2000) })), async (req, res) => {
  const sender = me(req);
  const c = await loadConversation(req.params.id, sender.id);
  const otherId = c.userAId === sender.id ? c.userBId : c.userAId;
  await assertNotBlocked(sender.id, otherId);
  const body = clean(req.body.body);
  const now = new Date();
  const [m] = await prisma.$transaction([
    prisma.message.create({ data: { conversationId: c.id, senderId: sender.id, body, createdAt: now } }),
    prisma.conversation.update({
      where: { id: c.id },
      data: { lastMessage: body.slice(0, 200), lastMessageAt: now, ...(c.userAId === sender.id ? { aLastReadAt: now } : { bLastReadAt: now }) },
    }),
  ]);
  notifyLater([otherId], { type: 'MESSAGE', title: sender.name ?? 'New message', body: body.slice(0, 120), data: { conversationId: c.id } });
  res.status(201).json({ id: m.id, body: m.body, createdAt: m.createdAt, isMine: true });
});

messagesRouter.post('/:id/read', async (req, res) => {
  const userId = me(req).id;
  const c = await loadConversation(req.params.id, userId);
  await prisma.conversation.update({ where: { id: c.id }, data: c.userAId === userId ? { aLastReadAt: new Date() } : { bLastReadAt: new Date() } });
  res.json({ ok: true });
});
