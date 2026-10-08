import { Router } from 'express';
import { z } from 'zod';
import { Prisma, PostType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, forbidden, notFound, tooMany } from '../lib/errors';
import {
  clampRadius,
  countPostsWithin,
  createWithPoint,
  getUserHome,
  pointSql,
  queryActiveAlertIds,
  queryFeedIds,
  type FeedCursor,
} from '../lib/geo';
import { decodeCursor, encodeCursor } from '../lib/pagination';
import { postInclude, publicUserSelect, toPost, toPublicUser } from '../lib/serializers';
import { me, requireAuth, requireLevel, uuidParams } from '../middleware/auth';
import { q, validate } from '../middleware/validate';
import { clean, needsReview } from '../services/moderation';
import { notifyLater, notifyRadiusLater } from '../services/notify';
import { serveAdsFor } from './ads.routes';

export const postsRouter = Router();
uuidParams(postsRouter, 'id');
postsRouter.use(requireAuth);

/** Below this many posts in the user's radius, the first feed page auto-widens to 5 km (cold start). */
const COLD_START_MIN_POSTS = 8;
const MAX_RADIUS_M = 5000;
const ALERT_FANOUT_RADIUS_M = 2000;
const MAX_POSTS_PER_DAY = 20;
const MAX_ALERTS_PER_DAY = 3;

async function requireHome(userId: string) {
  const home = await getUserHome(userId);
  if (!home) throw badRequest('Set your home address to see your neighbourhood');
  return home;
}

async function hydrate(ids: { id: string; distanceM: number }[], viewerId: string) {
  if (!ids.length) return [];
  const posts = await prisma.post.findMany({ where: { id: { in: ids.map((i) => i.id) } }, include: postInclude(viewerId) });
  const byId = new Map(posts.map((p) => [p.id, p]));
  return ids.flatMap(({ id, distanceM }) => {
    const p = byId.get(id);
    return p ? [toPost(p, viewerId, distanceM)] : [];
  });
}

// ─────────────── Feed ───────────────

const feedQuery = z.object({
  type: z.enum(PostType).optional(),
  radius: z.coerce.number().int().min(500).max(MAX_RADIUS_M).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(5).max(50).default(20),
});

postsRouter.get('/feed', validate('query', feedQuery), async (req, res) => {
  const user = me(req);
  const query = q<z.infer<typeof feedQuery>>(req);
  const home = await requireHome(user.id);
  const cursor = decodeCursor<FeedCursor & Record<string, unknown>>(query.cursor);

  // Radius is locked into the cursor so a scroll session never mixes radii.
  let radiusM = cursor?.r ?? clampRadius(query.radius, 500, MAX_RADIUS_M, user.feedRadiusM);
  let expanded = false;
  if (!cursor && !query.radius && radiusM < MAX_RADIUS_M) {
    const n = await countPostsWithin(home, radiusM);
    if (n < COLD_START_MIN_POSTS) {
      radiusM = MAX_RADIUS_M;
      expanded = true;
    }
  }

  const types = query.type ? [query.type] : undefined;
  const rows = await queryFeedIds({ center: home, radiusM, viewerId: user.id, types, cursor, limit: query.limit + 1 });
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];

  const [items, alerts, sponsored] = await Promise.all([
    hydrate(page, user.id),
    !cursor && !query.type ? queryActiveAlertIds(home, radiusM, user.id).then((a) => hydrate(a, user.id)) : Promise.resolve([]),
    serveAdsFor(home, 1),
  ]);

  res.json({
    items,
    pinnedAlerts: alerts,
    sponsored,
    radiusM,
    expanded,
    nextCursor: hasMore && last ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id, r: radiusM }) : null,
  });
});

// ─────────────── Create ───────────────

const base = {
  body: z.string().trim().min(3).max(3000),
  title: z.string().trim().min(3).max(120).optional(),
  images: z.array(z.string().url().max(500)).max(6).default([]),
};

const createSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('GENERAL'), ...base }),
  z.object({ type: z.literal('RECOMMENDATION'), ...base }),
  z.object({ type: z.literal('HOBBY'), ...base, hobbyTag: z.string().trim().min(2).max(40) }),
  z.object({
    type: z.literal('CLASSIFIED'),
    ...base,
    title: z.string().trim().min(3).max(120),
    pricePaise: z.number().int().min(0).max(100_000_000),
    condition: z.enum(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR']),
  }),
  z.object({
    type: z.literal('ALERT'),
    ...base,
    severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
    expiresInHours: z.number().int().min(1).max(72).default(24),
  }),
  z.object({ type: z.literal('LOST_FOUND'), ...base, title: z.string().trim().min(3).max(120) }),
  z.object({ type: z.literal('EVENT'), ...base, title: z.string().trim().min(3).max(120), eventAt: z.coerce.date() }),
]);

postsRouter.post('/posts', requireLevel('LOCATION'), validate('body', createSchema), async (req, res) => {
  const user = me(req);
  const input = req.body as z.infer<typeof createSchema>;
  const home = await requireHome(user.id);

  const since = new Date(Date.now() - 86400_000);
  const [today, alertsToday] = await Promise.all([
    prisma.post.count({ where: { authorId: user.id, createdAt: { gt: since } } }),
    input.type === 'ALERT' ? prisma.post.count({ where: { authorId: user.id, type: 'ALERT', createdAt: { gt: since } } }) : 0,
  ]);
  if (today >= MAX_POSTS_PER_DAY) throw tooMany('Daily post limit reached. Try again tomorrow.');
  if (alertsToday >= MAX_ALERTS_PER_DAY) throw tooMany('You can raise at most 3 alerts a day. For emergencies call 112.');

  let expiresAt: Date | undefined;
  if (input.type === 'ALERT') expiresAt = new Date(Date.now() + input.expiresInHours * 3600_000);
  if (input.type === 'LOST_FOUND') expiresAt = new Date(Date.now() + 14 * 86400_000);
  if (input.type === 'EVENT') {
    if (input.eventAt.getTime() < Date.now() - 3600_000) throw badRequest('Event date must be in the future');
    expiresAt = new Date(input.eventAt.getTime() + 6 * 3600_000);
  }

  const flagged = needsReview(input.title, input.body);
  const data: Prisma.PostUncheckedCreateInput = {
    authorId: user.id,
    neighborhoodId: user.neighborhoodId,
    type: input.type,
    title: input.title ? clean(input.title) : null,
    body: clean(input.body),
    images: input.images,
    status: flagged ? 'HIDDEN' : 'ACTIVE',
    expiresAt,
    pricePaise: input.type === 'CLASSIFIED' ? input.pricePaise : null,
    condition: input.type === 'CLASSIFIED' ? input.condition : null,
    severity: input.type === 'ALERT' ? input.severity : null,
    hobbyTag: input.type === 'HOBBY' ? clean(input.hobbyTag) : null,
    eventAt: input.type === 'EVENT' ? input.eventAt : null,
  };

  // Post location = author's home snapped to a ~150 m grid (never the exact flat).
  const post = await createWithPoint('posts', home, (tx) => tx.post.create({ data }), { fuzz: true });

  if (!flagged && input.type === 'ALERT' && input.severity !== 'INFO') {
    notifyRadiusLater(home, ALERT_FANOUT_RADIUS_M, user.id, {
      type: 'ALERT_NEARBY',
      title: `${input.severity === 'CRITICAL' ? '🚨' : '⚠️'} ${data.title ?? 'Neighbourhood alert'}`,
      body: data.body.slice(0, 140),
      data: { postId: post.id },
      highPriority: input.severity === 'CRITICAL',
    });
  }

  const full = await prisma.post.findUniqueOrThrow({ where: { id: post.id }, include: postInclude(user.id) });
  res.status(201).json({ ...toPost(full, user.id, 0), underReview: flagged });
});

// ─────────────── Single post ───────────────

/** Posts are only readable by neighbours within 10 km (or the author), to stop city-wide scraping. */
async function loadVisiblePost(postId: string, viewerId: string) {
  const home = await getUserHome(viewerId);
  const rows = await prisma.$queryRaw<{ id: string; authorId: string; status: string; distance: number | null }[]>`
    SELECT id, "authorId", status::text AS status,
           ${home ? Prisma.sql`ST_Distance(location, ${pointSql(home)})` : Prisma.sql`NULL::float8`} AS distance
    FROM posts WHERE id = ${postId}::uuid`;
  const row = rows[0];
  if (!row) throw notFound('Post');
  const isAuthor = row.authorId === viewerId;
  if (!isAuthor && (row.status !== 'ACTIVE' || row.distance == null || row.distance > 10_000)) throw notFound('Post');
  const blocked = await prisma.block.findFirst({
    where: { OR: [{ blockerId: viewerId, blockedId: row.authorId }, { blockerId: row.authorId, blockedId: viewerId }] },
  });
  if (blocked && !isAuthor) throw notFound('Post');
  return { ...row, isAuthor };
}

postsRouter.get('/posts/:id', async (req, res) => {
  const viewer = me(req).id;
  const v = await loadVisiblePost(req.params.id, viewer);
  const post = await prisma.post.findUniqueOrThrow({ where: { id: v.id }, include: postInclude(viewer) });
  res.json(toPost(post, viewer, v.distance == null ? undefined : Math.max(100, Math.ceil(v.distance / 100) * 100)));
});

postsRouter.patch(
  '/posts/:id',
  validate(
    'body',
    z.object({
      title: z.string().trim().min(3).max(120).optional(),
      body: z.string().trim().min(3).max(3000).optional(),
      pricePaise: z.number().int().min(0).max(100_000_000).optional(),
      isSold: z.boolean().optional(),
    }),
  ),
  async (req, res) => {
    const viewer = me(req).id;
    const post = await prisma.post.findUnique({ where: { id: req.params.id } });
    if (!post || post.status === 'REMOVED') throw notFound('Post');
    if (post.authorId !== viewer) throw forbidden('Only the author can edit this post');
    if ((req.body.isSold !== undefined || req.body.pricePaise !== undefined) && post.type !== 'CLASSIFIED')
      throw badRequest('Only marketplace listings have a price');
    const data: Prisma.PostUpdateInput = {};
    if (req.body.title) data.title = clean(req.body.title);
    if (req.body.body) data.body = clean(req.body.body);
    if (req.body.pricePaise !== undefined) data.pricePaise = req.body.pricePaise;
    if (req.body.isSold !== undefined) data.isSold = req.body.isSold;
    if (needsReview(req.body.title, req.body.body)) data.status = 'HIDDEN';
    const updated = await prisma.post.update({ where: { id: post.id }, data, include: postInclude(viewer) });
    res.json(toPost(updated, viewer));
  },
);

postsRouter.delete('/posts/:id', async (req, res) => {
  const user = me(req);
  const post = await prisma.post.findUnique({ where: { id: req.params.id } });
  if (!post || post.status === 'REMOVED') throw notFound('Post');
  if (post.authorId !== user.id && user.platformRole === 'USER') throw forbidden();
  await prisma.post.update({ where: { id: post.id }, data: { status: 'REMOVED' } });
  res.json({ ok: true });
});

postsRouter.get('/me/posts', async (req, res) => {
  const viewer = me(req).id;
  const posts = await prisma.post.findMany({
    where: { authorId: viewer, status: { not: 'REMOVED' } },
    include: postInclude(viewer),
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ items: posts.map((p) => toPost(p, viewer)) });
});

// ─────────────── Reactions ───────────────

postsRouter.post('/posts/:id/like', async (req, res) => {
  const viewer = me(req).id;
  const v = await loadVisiblePost(req.params.id, viewer);
  const created = await prisma.$transaction(async (tx) => {
    const r = await tx.postReaction.createMany({ data: [{ postId: v.id, userId: viewer }], skipDuplicates: true });
    if (r.count) await tx.post.update({ where: { id: v.id }, data: { likeCount: { increment: 1 } } });
    return r.count > 0;
  });
  const post = await prisma.post.findUniqueOrThrow({ where: { id: v.id }, select: { likeCount: true, authorId: true, title: true } });
  if (created && post.authorId !== viewer && [1, 5, 10, 25, 50, 100].includes(post.likeCount)) {
    notifyLater([post.authorId], { type: 'POST_LIKE', title: 'Your post is getting love ❤️', body: `${post.likeCount} neighbour${post.likeCount > 1 ? 's' : ''} liked "${(post.title ?? 'your post').slice(0, 40)}"`, data: { postId: v.id } });
  }
  res.json({ liked: true, likeCount: post.likeCount });
});

postsRouter.delete('/posts/:id/like', async (req, res) => {
  const viewer = me(req).id;
  const postId = req.params.id;
  await prisma.$transaction(async (tx) => {
    const r = await tx.postReaction.deleteMany({ where: { postId, userId: viewer } });
    if (r.count) await tx.post.update({ where: { id: postId }, data: { likeCount: { decrement: 1 } } });
  });
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { likeCount: true } });
  if (!post) throw notFound('Post');
  res.json({ liked: false, likeCount: post.likeCount });
});

// ─────────────── Comments ───────────────

postsRouter.get('/posts/:id/comments', async (req, res) => {
  const viewer = me(req).id;
  const v = await loadVisiblePost(req.params.id, viewer);
  const blocked = await prisma.block.findMany({ where: { blockerId: viewer }, select: { blockedId: true } });
  const comments = await prisma.comment.findMany({
    where: { postId: v.id, status: 'ACTIVE', authorId: { notIn: blocked.map((b) => b.blockedId) } },
    include: { author: { select: publicUserSelect } },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  res.json({
    items: comments.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, isMine: c.authorId === viewer, author: toPublicUser(c.author) })),
  });
});

postsRouter.post(
  '/posts/:id/comments',
  requireLevel('LOCATION'),
  validate('body', z.object({ body: z.string().trim().min(1).max(1000) })),
  async (req, res) => {
    const user = me(req);
    const v = await loadVisiblePost(req.params.id, user.id);
    const body = clean(req.body.body);
    const comment = await prisma.$transaction(async (tx) => {
      const c = await tx.comment.create({
        data: { postId: v.id, authorId: user.id, body, status: needsReview(body) ? 'HIDDEN' : 'ACTIVE' },
        include: { author: { select: publicUserSelect } },
      });
      if (c.status === 'ACTIVE') await tx.post.update({ where: { id: v.id }, data: { commentCount: { increment: 1 } } });
      return c;
    });
    if (v.authorId !== user.id && comment.status === 'ACTIVE') {
      notifyLater([v.authorId], {
        type: 'POST_COMMENT',
        title: `${user.name ?? 'A neighbour'} commented`,
        body: body.slice(0, 120),
        data: { postId: v.id },
      });
    }
    res.status(201).json({ id: comment.id, body: comment.body, createdAt: comment.createdAt, isMine: true, author: toPublicUser(comment.author) });
  },
);

postsRouter.delete('/comments/:id', async (req, res) => {
  const user = me(req);
  const c = await prisma.comment.findUnique({ where: { id: req.params.id }, include: { post: { select: { authorId: true } } } });
  if (!c || c.status === 'REMOVED') throw notFound('Comment');
  if (c.authorId !== user.id && c.post.authorId !== user.id && user.platformRole === 'USER') throw forbidden();
  await prisma.$transaction(async (tx) => {
    await tx.comment.update({ where: { id: c.id }, data: { status: 'REMOVED' } });
    if (c.status === 'ACTIVE') await tx.post.update({ where: { id: c.postId }, data: { commentCount: { decrement: 1 } } });
  });
  res.json({ ok: true });
});
