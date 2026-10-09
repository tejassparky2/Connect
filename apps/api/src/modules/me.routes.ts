import { Router } from 'express';
import { z } from 'zod';
import { mediaUrl } from '../lib/validators';
import { prisma } from '../lib/prisma';
import { badRequest, notFound, tooMany } from '../lib/errors';
import {
  clampRadius,
  bucketCount,
  countRecentPostsWithin,
  countUsersWithin,
  createWithPoint,
  findNearbyUsers,
  findNeighborhoodForPoint,
  getUserHome,
  isInIndia,
  setPoint,
  type NearbyUsersCursor,
} from '../lib/geo';
import { openCursor, sealCursor } from '../lib/pagination';
import { publicUserSelect, toPublicUser } from '../lib/serializers';
import { revokeAllSessions } from '../lib/tokens';
import { me, requireAuth, requireLevel, uuidParams } from '../middleware/auth';
import { q, validate } from '../middleware/validate';
import { env } from '../config/env';
import { getPrimaryAddress, gpsProgress, recomputeLevel, recordGpsCheck, vouchForNeighbor } from '../services/verification';
import { clean } from '../services/moderation';

export const meRouter = Router();
export const usersRouter = Router();
uuidParams(usersRouter, 'id');

/** Neighbourhood graduates from SEEDED → ACTIVE at this many members (cold-start milestone). */
const NEIGHBORHOOD_ACTIVE_AT = 25;
const MAX_ADDRESS_CHANGES_PER_30D = 3;
/** Stats are counted up to this cap (shown as "1,000+"). */
const STATS_CAP = 1000;

export async function recountNeighborhood(id: string | null | undefined) {
  if (!id) return;
  const n = await prisma.user.count({ where: { neighborhoodId: id, deletedAt: null } });
  await prisma.neighborhood.update({
    where: { id },
    data: { memberCount: n, ...(n >= NEIGHBORHOOD_ACTIVE_AT ? { status: 'ACTIVE' } : {}) },
  });
}

/** The caller's own profile — the only place a user's phone number is returned. */
export async function serializeMe(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      neighborhood: { select: { id: true, name: true, city: true, status: true, memberCount: true } },
      memberships: {
        where: { status: { in: ['APPROVED', 'PENDING'] } },
        select: { id: true, role: true, status: true, unit: true, tower: true, society: { select: { id: true, name: true, isVerified: true } } },
      },
      businesses: { select: { id: true, name: true, category: true, isVerified: true } },
    },
  });
  const address = await getPrimaryAddress(userId);
  return {
    id: u.id,
    phone: u.phone,
    name: u.name,
    bio: u.bio,
    avatarUrl: u.avatarUrl,
    language: u.language,
    platformRole: u.platformRole,
    verificationLevel: u.verificationLevel,
    feedRadiusM: u.feedRadiusM,
    hasHome: !!address,
    address: address
      ? { id: address.id, unit: address.unit, building: address.building, street: address.street, locality: address.locality, city: address.city, pincode: address.pincode, status: address.status, method: address.method }
      : null,
    neighborhood: u.neighborhood,
    societies: u.memberships.map((m) => ({ membershipId: m.id, role: m.role, status: m.status, unit: m.unit, tower: m.tower, ...m.society })),
    businesses: u.businesses,
    createdAt: u.createdAt,
  };
}

meRouter.use(requireAuth);

meRouter.get('/', async (req, res) => {
  res.json(await serializeMe(me(req).id));
});

meRouter.patch(
  '/',
  validate(
    'body',
    z.object({
      name: z.string().trim().min(2).max(60).optional(),
      bio: z.string().trim().max(280).optional(),
      avatarUrl: mediaUrl.nullable().optional(),
      language: z.enum(['en', 'hi', 'kn', 'ta', 'te', 'mr', 'bn', 'gu', 'ml', 'pa']).optional(),
      feedRadiusM: z.number().int().min(2000).max(5000).optional(),
    }),
  ),
  async (req, res) => {
    const data = { ...req.body };
    if (data.name) data.name = clean(data.name);
    if (data.bio) data.bio = clean(data.bio);
    await prisma.user.update({ where: { id: me(req).id }, data });
    res.json(await serializeMe(me(req).id));
  },
);

/**
 * DPDP Act 2023: right to erasure. Soft-delete + irreversible anonymisation;
 * content authored stays (attributed to "Former neighbour") unless reported.
 */
meRouter.delete('/', async (req, res) => {
  const id = me(req).id;
  const user = await prisma.user.findUniqueOrThrow({ where: { id }, select: { neighborhoodId: true } });
  await prisma.$transaction([
    prisma.$executeRaw`UPDATE users SET "homeLocation" = NULL WHERE id = ${id}::uuid`,
    prisma.user.update({
      where: { id },
      data: { phone: `deleted:${id}`, name: 'Former neighbour', bio: null, avatarUrl: null, deletedAt: new Date(), neighborhoodId: null, authProviderId: null },
    }),
    prisma.pushToken.deleteMany({ where: { userId: id } }),
    prisma.address.deleteMany({ where: { userId: id } }),
    prisma.societyMembership.updateMany({ where: { userId: id }, data: { status: 'REMOVED' } }),
  ]);
  await revokeAllSessions(id);
  await recountNeighborhood(user.neighborhoodId);
  res.json({ ok: true });
});

// ─────────────── Home address (sets the geo-fence centre) ───────────────

const addressSchema = z.object({
  unit: z.string().trim().min(1).max(40),
  building: z.string().trim().max(120).optional(),
  street: z.string().trim().max(160).optional(),
  locality: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(80),
  pincode: z.string().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code'),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

meRouter.put('/address', validate('body', addressSchema), async (req, res) => {
  const userId = me(req).id;
  const { lat, lng, ...fields } = req.body as z.infer<typeof addressSchema>;
  const point = { lat, lng };
  if (!isInIndia(point)) throw badRequest('Mohalla Connect is currently available only in India');

  // Moving home is rare in real life; frequent moves are how location oracles and spoofing work.
  const recentMoves = await prisma.address.count({ where: { userId, createdAt: { gt: new Date(Date.now() - 30 * 86400_000) } } });
  if (recentMoves >= MAX_ADDRESS_CHANGES_PER_30D) throw tooMany('You can change your home address at most 3 times a month. Contact support if you need help.');

  const prev = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { neighborhoodId: true } });
  const hood = await findNeighborhoodForPoint(point);

  await createWithPoint('addresses', point, async (tx) => {
    await tx.address.updateMany({ where: { userId, isPrimary: true }, data: { isPrimary: false } });
    return tx.address.create({ data: { userId, ...fields, neighborhoodId: hood?.id, isPrimary: true } });
  }, {
    after: async (tx) => {
      await setPoint('users', userId, point, { tx });
      await tx.user.update({ where: { id: userId }, data: { neighborhoodId: hood?.id ?? null } });
    },
  });

  // Moving home resets location/address verification — evidence was for the old pin.
  await recomputeLevel(userId);
  await recountNeighborhood(hood?.id);
  if (prev.neighborhoodId && prev.neighborhoodId !== hood?.id) await recountNeighborhood(prev.neighborhoodId);
  res.json(await serializeMe(userId));
});

// ─────────────── Verification ───────────────

meRouter.get('/verification', async (req, res) => {
  const userId = me(req).id;
  const address = await getPrimaryAddress(userId);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { verificationLevel: true } });
  if (!address) return res.json({ level: user.verificationLevel, address: null, gps: null, vouches: null });
  const [gps, vouches] = await Promise.all([gpsProgress(address.id), prisma.vouch.count({ where: { addressId: address.id } })]);
  res.json({
    level: user.verificationLevel,
    address: { status: address.status, method: address.method },
    gps,
    vouches: { count: vouches, required: env.VOUCHES_REQUIRED },
  });
});

meRouter.post(
  '/verification/gps',
  validate(
    'body',
    z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracyM: z.number().min(0).max(10000),
      isMocked: z.boolean().optional(),
    }),
  ),
  async (req, res) => {
    res.json(await recordGpsCheck(me(req).id, req.body));
  },
);

// ─────────────── Push tokens ───────────────

meRouter.post(
  '/push-tokens',
  validate('body', z.object({ token: z.string().min(10).max(255), platform: z.enum(['ios', 'android', 'web']) })),
  async (req, res) => {
    await prisma.pushToken.upsert({
      where: { token: req.body.token },
      create: { token: req.body.token, platform: req.body.platform, userId: me(req).id },
      update: { userId: me(req).id, platform: req.body.platform },
    });
    res.json({ ok: true });
  },
);

meRouter.delete('/push-tokens', validate('body', z.object({ token: z.string() })), async (req, res) => {
  await prisma.pushToken.deleteMany({ where: { token: req.body.token, userId: me(req).id } });
  res.json({ ok: true });
});

// ─────────────── Badges (unread counts for tab icons) ───────────────

meRouter.get('/badges', async (req, res) => {
  const userId = me(req).id;
  const [notifications, unreadConvs] = await Promise.all([
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM conversations c
      WHERE (c."userAId" = ${userId}::uuid AND (c."aLastReadAt" IS NULL OR c."aLastReadAt" < c."lastMessageAt")
             AND EXISTS (SELECT 1 FROM messages m WHERE m."conversationId" = c.id AND m."senderId" <> ${userId}::uuid))
         OR (c."userBId" = ${userId}::uuid AND (c."bLastReadAt" IS NULL OR c."bLastReadAt" < c."lastMessageAt")
             AND EXISTS (SELECT 1 FROM messages m WHERE m."conversationId" = c.id AND m."senderId" <> ${userId}::uuid))`,
  ]);
  res.json({ notifications, messages: Number(unreadConvs[0].n) });
});

// ─────────────── Neighbourhood ───────────────

meRouter.get('/neighborhood', async (req, res) => {
  const user = me(req);
  const home = await getUserHome(user.id);
  if (!home) throw badRequest('Set your home address first');
  const hood = user.neighborhoodId
    ? await prisma.neighborhood.findUnique({ where: { id: user.neighborhoodId }, select: { id: true, name: true, city: true, status: true, memberCount: true } })
    : null;
  const [neighborsInRadius, postsThisWeek] = await Promise.all([
    countUsersWithin(home, user.feedRadiusM, { verifiedOnly: true, cap: STATS_CAP + 1 }),
    countRecentPostsWithin(home, user.feedRadiusM, 7, STATS_CAP + 1),
  ]);
  res.json({
    neighborhood: hood,
    radiusM: user.feedRadiusM,
    // Bucketed: an exact count + movable centre would be a location oracle.
    neighborsInRadius: bucketCount(Math.min(STATS_CAP, Math.max(0, neighborsInRadius - 1))),
    neighborsCapped: neighborsInRadius > STATS_CAP,
    approximate: true,
    postsThisWeek: Math.min(STATS_CAP, postsThisWeek),
  });
});

/** Neighbour directory, nearest first (LOCATION+ only, so lurkers can't enumerate residents). */
meRouter.get(
  '/neighbors',
  requireLevel('LOCATION'),
  validate('query', z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(30) })),
  async (req, res) => {
    const user = me(req);
    const { cursor, limit } = q<{ cursor?: string; limit: number }>(req);
    const home = await getUserHome(user.id);
    if (!home) throw badRequest('Set your home address first');
    const result = await findNearbyUsers({
      center: home,
      radiusM: clampRadius(user.feedRadiusM, 2000, 5000, 3000),
      viewerId: user.id,
      limit,
      cursor: openCursor<NearbyUsersCursor & Record<string, unknown>>(cursor),
    });
    res.json({ items: result.rows, nextCursor: result.nextCursor ? sealCursor({ ...result.nextCursor }) : null });
  },
);

// ─────────────── Other users ───────────────

usersRouter.use(requireAuth);

usersRouter.get('/:id', async (req, res) => {
  const u = await prisma.user.findFirst({
    where: { id: req.params.id, deletedAt: null },
    select: { ...publicUserSelect, bio: true, createdAt: true, _count: { select: { posts: { where: { status: 'ACTIVE' } } } } },
  });
  if (!u) throw notFound('User');
  const viewer = me(req).id;
  const [blocked, vouched] = await Promise.all([
    prisma.block.findUnique({ where: { blockerId_blockedId: { blockerId: viewer, blockedId: u.id } } }),
    prisma.vouch.findUnique({ where: { voucherId_voucheeId: { voucherId: viewer, voucheeId: u.id } } }),
  ]);
  res.json({ ...toPublicUser(u), bio: u.bio, memberSince: u.createdAt, postCount: u._count.posts, isBlocked: !!blocked, vouchedByMe: !!vouched });
});

usersRouter.post('/:id/block', async (req, res) => {
  const viewer = me(req).id;
  if (viewer === req.params.id) throw badRequest("You can't block yourself");
  const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!target) throw notFound('User');
  await prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId: viewer, blockedId: target.id } },
    create: { blockerId: viewer, blockedId: target.id },
    update: {},
  });
  res.json({ ok: true });
});

usersRouter.delete('/:id/block', async (req, res) => {
  await prisma.block.deleteMany({ where: { blockerId: me(req).id, blockedId: req.params.id } });
  res.json({ ok: true });
});

usersRouter.post('/:id/vouch', requireLevel('ADDRESS'), async (req, res) => {
  res.json(await vouchForNeighbor(me(req).id, req.params.id));
});
