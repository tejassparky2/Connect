/**
 * Daily-wage & informal service workers (maids, cooks, plumbers, drivers…).
 *
 * India reality: many workers have basic phones, so profiles are usually
 * created by a resident who employs them (with the worker's consent) and
 * trust accrues through vouches from ADDRESS-verified residents — the digital
 * version of "ask the society WhatsApp group for a good maid".
 */
import { Router } from 'express';
import { z } from 'zod';
import { Prisma, ServiceSkill } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { bucketDistance, createWithPoint, getUserHome, pointSql, queryNearbyProviderIds, setPoint, type DirectoryCursor } from '../lib/geo';
import { decodeCursor, distanceCursor, encodeCursor } from '../lib/pagination';
import { normalizeIndianPhone } from '../lib/phone';
import { publicUserSelect, toPublicUser } from '../lib/serializers';
import { me, requireAuth, requireLevel, uuidParams } from '../middleware/auth';
import { q, validate } from '../middleware/validate';
import { clean } from '../services/moderation';
import { refreshRating, reviewBody } from './businesses.routes';

export const providersRouter = Router();
uuidParams(providersRouter, 'id');
providersRouter.use(requireAuth);

function toProvider(p: Prisma.ServiceProviderGetPayload<object>, distance?: number, viewerId?: string) {
  return {
    id: p.id,
    name: p.name,
    phone: p.phone,
    skills: p.skills,
    languages: p.languages,
    about: p.about,
    experienceYrs: p.experienceYrs,
    rateNote: p.rateNote,
    serviceRadiusM: p.serviceRadiusM,
    idVerified: p.idVerified,
    vouchCount: p.vouchCount,
    ratingAvg: Math.round(p.ratingAvg * 10) / 10,
    ratingCount: p.ratingCount,
    canEdit: viewerId ? p.listedById === viewerId || p.userId === viewerId : false,
    distanceM: distance == null ? null : bucketDistance(distance),
    createdAt: p.createdAt,
  };
}

providersRouter.get(
  '/',
  validate(
    'query',
    z.object({
      skill: z.enum(ServiceSkill).optional(),
      q: z.string().trim().max(60).optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  ),
  async (req, res) => {
    const query = q<{ skill?: string; q?: string; cursor?: string; limit: number }>(req);
    const home = await getUserHome(me(req).id);
    if (!home) throw badRequest('Set your home address first');
    const rows = await queryNearbyProviderIds({
      center: home,
      skill: query.skill,
      q: query.q || undefined,
      limit: query.limit + 1,
      cursor: decodeCursor(query.cursor, distanceCursor),
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const list = await prisma.serviceProvider.findMany({ where: { id: { in: page.map((r) => r.id) } } });
    const byId = new Map(list.map((p) => [p.id, p]));
    const last = page[page.length - 1];
    res.json({
      items: page.flatMap((r) => (byId.get(r.id) ? [toProvider(byId.get(r.id)!, r.distance, me(req).id)] : [])),
      nextCursor: hasMore && last ? encodeCursor({ d: last.distance, id: last.id }) : null,
    });
  },
);

const providerBody = z.object({
  name: z.string().trim().min(2).max(60),
  phone: z.string(),
  skills: z.array(z.enum(ServiceSkill)).min(1).max(5),
  languages: z.array(z.string().trim().min(2).max(20)).max(6).default([]),
  about: z.string().trim().max(500).optional(),
  experienceYrs: z.number().int().min(0).max(60).optional(),
  rateNote: z.string().trim().max(60).optional(),
  serviceRadiusM: z.number().int().min(500).max(20000).default(5000),
  /** Lister confirms the worker agreed to be listed (DPDP consent). */
  consent: z.literal(true, { error: 'Worker consent is required' }),
});

providersRouter.post('/', requireLevel('LOCATION'), validate('body', providerBody), async (req, res) => {
  const user = me(req);
  const input = req.body as z.infer<typeof providerBody>;
  const phone = normalizeIndianPhone(input.phone);
  if (!phone) throw badRequest('Invalid phone number');
  const existing = await prisma.serviceProvider.findUnique({ where: { phone } });
  if (existing) throw conflict('This worker is already listed — search for them and add your vouch instead');
  const listed = await prisma.serviceProvider.count({ where: { listedById: user.id, createdAt: { gt: new Date(Date.now() - 7 * 86400_000) } } });
  if (listed >= 10) throw forbidden('Weekly listing limit reached');
  // Worker's area = lister's home (they work in the lister's locality).
  const home = await getUserHome(user.id);
  if (!home) throw badRequest('Set your home address first');
  const p = await createWithPoint(
    'service_providers',
    home,
    (tx) =>
      tx.serviceProvider.create({
        data: {
          listedById: user.id,
          name: clean(input.name),
          phone,
          skills: input.skills,
          languages: input.languages,
          about: input.about ? clean(input.about) : null,
          experienceYrs: input.experienceYrs,
          rateNote: input.rateNote,
          serviceRadiusM: input.serviceRadiusM,
          vouchCount: 1,
        },
      }),
    { fuzz: true, after: async (tx, row) => void (await tx.providerVouch.create({ data: { providerId: row.id, userId: user.id, note: 'Listed this worker' } })) },
  );
  res.status(201).json(toProvider(p, 0, user.id));
});

/**
 * A worker who installs the app claims their listing: their OTP-verified phone must match.
 * This also resolves "phone squatting" — the real owner of the number takes control.
 */
providersRouter.post('/claim', async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: me(req).id }, select: { phone: true } });
  const p = await prisma.serviceProvider.findUnique({ where: { phone: user.phone } });
  if (!p) throw notFound('Worker listing for your phone number');
  if (p.userId && p.userId !== me(req).id) throw conflict('Listing already claimed');
  const claimed = await prisma.serviceProvider.update({ where: { id: p.id }, data: { userId: me(req).id } });
  res.json(toProvider(claimed, undefined, me(req).id));
});

providersRouter.get('/:id', async (req, res) => {
  const viewer = me(req).id;
  const p = await prisma.serviceProvider.findUnique({
    where: { id: req.params.id },
    include: {
      reviews: { orderBy: { createdAt: 'desc' }, take: 20, include: { author: { select: publicUserSelect } } },
      vouches: { orderBy: { createdAt: 'desc' }, take: 20, include: { user: { select: publicUserSelect } } },
    },
  });
  if (!p || p.status !== 'ACTIVE') throw notFound('Worker');
  const home = await getUserHome(viewer);
  let distance: number | undefined;
  if (home) {
    const r = await prisma.$queryRaw<{ d: number }[]>`SELECT ST_Distance(location, ${pointSql(home)}) AS d FROM service_providers WHERE id = ${p.id}::uuid`;
    distance = r[0]?.d;
  }
  res.json({
    ...toProvider(p, distance, viewer),
    vouchedByMe: p.vouches.some((v) => v.userId === viewer),
    vouches: p.vouches.map((v) => ({ note: v.note, createdAt: v.createdAt, user: toPublicUser(v.user) })),
    reviews: p.reviews.map((r) => ({ id: r.id, rating: r.rating, body: r.body, createdAt: r.createdAt, isMine: r.authorId === viewer, author: toPublicUser(r.author) })),
    myReview: p.reviews.find((r) => r.authorId === viewer) ?? null,
  });
});

providersRouter.patch('/:id', validate('body', providerBody.omit({ consent: true, phone: true }).partial()), async (req, res) => {
  const viewer = me(req).id;
  const p = await prisma.serviceProvider.findUnique({ where: { id: req.params.id } });
  if (!p) throw notFound('Worker');
  if (p.listedById !== viewer && p.userId !== viewer) throw forbidden();
  const data: Prisma.ServiceProviderUpdateInput = { ...req.body };
  if (req.body.name) data.name = clean(req.body.name);
  if (req.body.about) data.about = clean(req.body.about);
  const updated = await prisma.serviceProvider.update({ where: { id: p.id }, data });
  res.json(toProvider(updated, undefined, viewer));
});

/** Move a worker's service area to the editor's home (e.g. they now work in a new locality). */
providersRouter.post('/:id/relocate', async (req, res) => {
  const viewer = me(req).id;
  const p = await prisma.serviceProvider.findUnique({ where: { id: req.params.id } });
  if (!p) throw notFound('Worker');
  if (p.listedById !== viewer && p.userId !== viewer) throw forbidden();
  const home = await getUserHome(viewer);
  if (!home) throw badRequest('Set your home address first');
  await setPoint('service_providers', p.id, home, { fuzz: true });
  res.json({ ok: true });
});

providersRouter.post(
  '/:id/vouch',
  requireLevel('ADDRESS'),
  validate('body', z.object({ note: z.string().trim().max(200).optional() })),
  async (req, res) => {
    const viewer = me(req).id;
    const p = await prisma.serviceProvider.findUnique({ where: { id: req.params.id } });
    if (!p || p.status !== 'ACTIVE') throw notFound('Worker');
    const created = await prisma.$transaction(async (tx) => {
      const r = await tx.providerVouch.createMany({ data: [{ providerId: p.id, userId: viewer, note: req.body.note ? clean(req.body.note) : null }], skipDuplicates: true });
      if (r.count) await tx.serviceProvider.update({ where: { id: p.id }, data: { vouchCount: { increment: 1 } } });
      return r.count > 0;
    });
    if (!created) throw conflict('You have already vouched for this worker');
    const updated = await prisma.serviceProvider.findUniqueOrThrow({ where: { id: p.id }, select: { vouchCount: true } });
    res.json({ ok: true, vouchCount: updated.vouchCount });
  },
);

providersRouter.delete('/:id/vouch', async (req, res) => {
  const viewer = me(req).id;
  await prisma.$transaction(async (tx) => {
    const r = await tx.providerVouch.deleteMany({ where: { providerId: req.params.id, userId: viewer } });
    if (r.count) await tx.serviceProvider.update({ where: { id: req.params.id }, data: { vouchCount: { decrement: 1 } } });
  });
  res.json({ ok: true });
});

providersRouter.post('/:id/reviews', requireLevel('LOCATION'), validate('body', reviewBody), async (req, res) => {
  const viewer = me(req).id;
  const p = await prisma.serviceProvider.findUnique({ where: { id: req.params.id } });
  if (!p || p.status !== 'ACTIVE') throw notFound('Worker');
  if (p.userId === viewer) throw forbidden("You can't review yourself");
  const body = req.body.body ? clean(req.body.body) : null;
  const existing = await prisma.review.findUnique({ where: { authorId_providerId: { authorId: viewer, providerId: p.id } } });
  const review = existing
    ? await prisma.review.update({ where: { id: existing.id }, data: { rating: req.body.rating, body } })
    : await prisma.review.create({ data: { authorId: viewer, providerId: p.id, rating: req.body.rating, body } });
  await refreshRating({ providerId: p.id });
  res.status(existing ? 200 : 201).json(review);
});
