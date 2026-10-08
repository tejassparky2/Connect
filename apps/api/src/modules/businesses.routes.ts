import { Router } from 'express';
import { z } from 'zod';
import { BusinessCategory, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { bucketDistance, clampRadius, createWithPoint, getUserHome, isInIndia, pointSql, queryNearbyBusinessIds, setPoint, type DirectoryCursor } from '../lib/geo';
import { decodeCursor, encodeCursor } from '../lib/pagination';
import { normalizeIndianPhone } from '../lib/phone';
import { publicUserSelect, toPublicUser } from '../lib/serializers';
import { me, requireAuth, requireLevel, uuidParams } from '../middleware/auth';
import { q, validate } from '../middleware/validate';
import { clean } from '../services/moderation';
import { notifyLater } from '../services/notify';
import { createRazorpayOrder, fetchRazorpayOrderAmount, paymentsMode, verifyRazorpaySignature } from '../services/payments';
import { env } from '../config/env';

export const businessesRouter = Router();
uuidParams(businessesRouter, 'id', 'aid');
businessesRouter.use(requireAuth);

const hoursSchema = z.partialRecord(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']), z.string().regex(/^(closed|\d{2}:\d{2}-\d{2}:\d{2})$/)).optional();

const businessBody = z.object({
  name: z.string().trim().min(2).max(80),
  category: z.enum(BusinessCategory),
  description: z.string().trim().max(1000).optional(),
  phone: z.string(),
  whatsapp: z.string().optional(),
  addressLine: z.string().trim().min(5).max(200),
  pincode: z.string().regex(/^[1-9]\d{5}$/),
  lat: z.number(),
  lng: z.number(),
  hours: hoursSchema,
  photos: z.array(z.string().url().max(500)).max(8).default([]),
  gstin: z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN').optional(),
  openedAt: z.coerce.date().optional(),
});

function phoneOrThrow(p: string, field = 'phone') {
  const n = normalizeIndianPhone(p);
  if (!n) throw badRequest(`Invalid ${field} number`);
  return n;
}

/** Shape returned to the app. "isNew" drives the "Newly opened" badge (opened in last 30 days). */
function toBusiness(b: Prisma.BusinessGetPayload<object>, distance?: number, viewerId?: string) {
  const opened = b.openedAt ?? b.createdAt;
  return {
    id: b.id,
    name: b.name,
    category: b.category,
    description: b.description,
    phone: b.phone,
    whatsapp: b.whatsapp,
    addressLine: b.addressLine,
    pincode: b.pincode,
    hours: b.hours,
    photos: b.photos,
    isVerified: b.isVerified,
    ratingAvg: Math.round(b.ratingAvg * 10) / 10,
    ratingCount: b.ratingCount,
    isNew: Date.now() - opened.getTime() < 30 * 86400_000,
    isMine: viewerId ? b.ownerId === viewerId : false,
    distanceM: distance == null ? null : bucketDistance(distance),
    createdAt: b.createdAt,
  };
}

// ─────────────── Directory ───────────────

businessesRouter.get(
  '/',
  validate(
    'query',
    z.object({
      category: z.enum(BusinessCategory).optional(),
      q: z.string().trim().max(60).optional(),
      radius: z.coerce.number().int().min(500).max(10000).optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  ),
  async (req, res) => {
    const query = q<{ category?: string; q?: string; radius?: number; cursor?: string; limit: number }>(req);
    const home = await getUserHome(me(req).id);
    if (!home) throw badRequest('Set your home address first');
    const radiusM = clampRadius(query.radius, 500, 10000, 5000);
    const rows = await queryNearbyBusinessIds({
      center: home,
      radiusM,
      category: query.category,
      q: query.q || undefined,
      limit: query.limit + 1,
      cursor: decodeCursor<DirectoryCursor & Record<string, unknown>>(query.cursor),
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const list = await prisma.business.findMany({ where: { id: { in: page.map((r) => r.id) } } });
    const byId = new Map(list.map((b) => [b.id, b]));
    const last = page[page.length - 1];
    res.json({
      items: page.flatMap((r) => (byId.get(r.id) ? [toBusiness(byId.get(r.id)!, Math.min(r.distance, radiusM), me(req).id)] : [])),
      nextCursor: hasMore && last ? encodeCursor({ d: last.distance, id: last.id }) : null,
    });
  },
);

/** Local deals: live announcements from businesses within 5 km. */
businessesRouter.get('/offers/nearby', async (req, res) => {
  const home = await getUserHome(me(req).id);
  if (!home) return res.json({ items: [] });
  const rows = await prisma.$queryRaw<{ id: string; distance: number }[]>`
    SELECT a.id, ST_Distance(b.location, ${pointSql(home)}) AS distance
    FROM business_announcements a JOIN businesses b ON b.id = a."businessId"
    WHERE b.status = 'ACTIVE' AND (a."validUntil" IS NULL OR a."validUntil" > now())
      AND ST_DWithin(b.location, ${pointSql(home)}, 5000)
    ORDER BY a."createdAt" DESC LIMIT 30`;
  const items = await prisma.businessAnnouncement.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    include: { business: { select: { id: true, name: true, category: true, isVerified: true, photos: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const dist = new Map(rows.map((r) => [r.id, r.distance]));
  res.json({ items: items.map((a) => ({ ...a, distanceM: bucketDistance(dist.get(a.id) ?? 0) })) });
});

businessesRouter.get('/mine', async (req, res) => {
  const list = await prisma.business.findMany({ where: { ownerId: me(req).id }, orderBy: { createdAt: 'desc' } });
  res.json({ items: list.map((b) => ({ ...toBusiness(b, undefined, me(req).id), walletPaise: b.walletPaise })) });
});

businessesRouter.post('/', requireLevel('LOCATION'), validate('body', businessBody), async (req, res) => {
  const user = me(req);
  const input = req.body as z.infer<typeof businessBody>;
  if (!isInIndia(input)) throw badRequest('Business must be located in India');
  const owned = await prisma.business.count({ where: { ownerId: user.id } });
  if (owned >= 5) throw forbidden('You can list at most 5 businesses');
  const b = await createWithPoint('businesses', { lat: input.lat, lng: input.lng }, (tx) =>
    tx.business.create({
      data: {
        ownerId: user.id,
        name: clean(input.name),
        category: input.category,
        description: input.description ? clean(input.description) : null,
        phone: phoneOrThrow(input.phone),
        whatsapp: input.whatsapp ? phoneOrThrow(input.whatsapp, 'WhatsApp') : null,
        addressLine: clean(input.addressLine),
        pincode: input.pincode,
        hours: input.hours as Prisma.InputJsonValue | undefined,
        photos: input.photos,
        gstin: input.gstin,
        openedAt: input.openedAt ?? new Date(),
      },
    }),
  );
  res.status(201).json(toBusiness(b, 0, user.id));
});

businessesRouter.get('/:id', async (req, res) => {
  const viewer = me(req).id;
  const b = await prisma.business.findUnique({
    where: { id: req.params.id },
    include: {
      announcements: { where: { OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] }, orderBy: { createdAt: 'desc' }, take: 10 },
      reviews: { orderBy: { createdAt: 'desc' }, take: 20, include: { author: { select: publicUserSelect } } },
    },
  });
  if (!b || (b.status !== 'ACTIVE' && b.ownerId !== viewer)) throw notFound('Business');
  const home = await getUserHome(viewer);
  let distance: number | undefined;
  if (home) {
    const r = await prisma.$queryRaw<{ d: number }[]>`SELECT ST_Distance(location, ${pointSql(home)}) AS d FROM businesses WHERE id = ${b.id}::uuid`;
    distance = r[0]?.d;
  }
  res.json({
    ...toBusiness(b, distance, viewer),
    ...(b.ownerId === viewer ? { walletPaise: b.walletPaise, gstin: b.gstin } : {}),
    announcements: b.announcements,
    reviews: b.reviews.map((r) => ({ id: r.id, rating: r.rating, body: r.body, createdAt: r.createdAt, isMine: r.authorId === viewer, author: toPublicUser(r.author) })),
    myReview: b.reviews.find((r) => r.authorId === viewer) ?? null,
  });
});

businessesRouter.patch('/:id', validate('body', businessBody.partial()), async (req, res) => {
  const viewer = me(req).id;
  const b = await prisma.business.findUnique({ where: { id: req.params.id } });
  if (!b) throw notFound('Business');
  if (b.ownerId !== viewer) throw forbidden();
  const { lat, lng, phone, whatsapp, hours, ...rest } = req.body as Partial<z.infer<typeof businessBody>>;
  const data: Prisma.BusinessUpdateInput = { ...rest };
  if (rest.name) data.name = clean(rest.name);
  if (rest.description) data.description = clean(rest.description);
  if (phone) data.phone = phoneOrThrow(phone);
  if (whatsapp) data.whatsapp = phoneOrThrow(whatsapp, 'WhatsApp');
  if (hours) data.hours = hours as Prisma.InputJsonValue;
  // Changing GSTIN or name invalidates the verified badge until re-reviewed.
  if ((rest.gstin && rest.gstin !== b.gstin) || (rest.name && rest.name !== b.name)) data.isVerified = false;
  await prisma.$transaction(async (tx) => {
    await tx.business.update({ where: { id: b.id }, data });
    if (lat != null && lng != null) {
      if (!isInIndia({ lat, lng })) throw badRequest('Business must be located in India');
      await setPoint('businesses', b.id, { lat, lng }, { tx });
    }
  });
  res.json(toBusiness(await prisma.business.findUniqueOrThrow({ where: { id: b.id } }), undefined, viewer));
});

// ─────────────── Announcements ("Now open!", offers) ───────────────

businessesRouter.post(
  '/:id/announcements',
  validate('body', z.object({ title: z.string().trim().min(3).max(80), body: z.string().trim().min(5).max(500), validUntil: z.coerce.date().optional() })),
  async (req, res) => {
    const b = await prisma.business.findUnique({ where: { id: req.params.id } });
    if (!b) throw notFound('Business');
    if (b.ownerId !== me(req).id) throw forbidden();
    const recent = await prisma.businessAnnouncement.count({ where: { businessId: b.id, createdAt: { gt: new Date(Date.now() - 86400_000) } } });
    if (recent >= 3) throw forbidden('At most 3 announcements per day');
    const a = await prisma.businessAnnouncement.create({
      data: { businessId: b.id, title: clean(req.body.title), body: clean(req.body.body), validUntil: req.body.validUntil },
    });
    res.status(201).json(a);
  },
);

businessesRouter.delete('/:id/announcements/:aid', async (req, res) => {
  const a = await prisma.businessAnnouncement.findUnique({ where: { id: req.params.aid }, include: { business: true } });
  if (!a || a.businessId !== req.params.id) throw notFound('Announcement');
  if (a.business.ownerId !== me(req).id) throw forbidden();
  await prisma.businessAnnouncement.delete({ where: { id: a.id } });
  res.json({ ok: true });
});

// ─────────────── Reviews ───────────────

export async function refreshRating(target: { businessId?: string; providerId?: string }) {
  const agg = await prisma.review.aggregate({ where: target, _avg: { rating: true }, _count: true });
  const data = { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count };
  if (target.businessId) await prisma.business.update({ where: { id: target.businessId }, data });
  if (target.providerId) await prisma.serviceProvider.update({ where: { id: target.providerId }, data });
}

export const reviewBody = z.object({ rating: z.number().int().min(1).max(5), body: z.string().trim().max(1000).optional() });

businessesRouter.post('/:id/reviews', requireLevel('LOCATION'), validate('body', reviewBody), async (req, res) => {
  const viewer = me(req);
  const b = await prisma.business.findUnique({ where: { id: req.params.id } });
  if (!b || b.status !== 'ACTIVE') throw notFound('Business');
  if (b.ownerId === viewer.id) throw forbidden("You can't review your own business");
  const body = req.body.body ? clean(req.body.body) : null;
  const existing = await prisma.review.findUnique({ where: { authorId_businessId: { authorId: viewer.id, businessId: b.id } } });
  const review = existing
    ? await prisma.review.update({ where: { id: existing.id }, data: { rating: req.body.rating, body } })
    : await prisma.review.create({ data: { authorId: viewer.id, businessId: b.id, rating: req.body.rating, body } });
  await refreshRating({ businessId: b.id });
  if (!existing) notifyLater([b.ownerId], { type: 'REVIEW_RECEIVED', title: `New ${req.body.rating}★ review`, body: `${viewer.name ?? 'A neighbour'} reviewed ${b.name}`, data: { businessId: b.id } });
  res.status(existing ? 200 : 201).json(review);
});

businessesRouter.delete('/:id/reviews/mine', async (req, res) => {
  await prisma.review.deleteMany({ where: { authorId: me(req).id, businessId: req.params.id } });
  await refreshRating({ businessId: req.params.id });
  res.json({ ok: true });
});

// ─────────────── Ad wallet ───────────────

async function ownedBusiness(id: string, userId: string) {
  const b = await prisma.business.findUnique({ where: { id } });
  if (!b) throw notFound('Business');
  if (b.ownerId !== userId) throw forbidden();
  return b;
}

businessesRouter.get('/:id/wallet', async (req, res) => {
  const b = await ownedBusiness(req.params.id, me(req).id);
  const txns = await prisma.walletTransaction.findMany({ where: { businessId: b.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({ balancePaise: b.walletPaise, paymentsMode: paymentsMode(), razorpayKeyId: env.RAZORPAY_KEY_ID || null, transactions: txns });
});

businessesRouter.post(
  '/:id/wallet/orders',
  validate('body', z.object({ amountPaise: z.number().int().min(100_00).max(5_00_000_00) })),
  async (req, res) => {
    const b = await ownedBusiness(req.params.id, me(req).id);
    const mode = paymentsMode();
    if (mode === 'disabled') throw badRequest('Payments are not configured');
    if (mode === 'dev') return res.json({ mode, orderId: `dev_order_${Date.now()}`, amountPaise: req.body.amountPaise, currency: 'INR' });
    const order = await createRazorpayOrder(req.body.amountPaise, `wallet_${b.id.slice(0, 8)}_${Date.now()}`);
    res.json({ mode, orderId: order.id, amountPaise: order.amount, currency: order.currency, keyId: env.RAZORPAY_KEY_ID });
  },
);

businessesRouter.post(
  '/:id/wallet/verify',
  validate(
    'body',
    z.object({
      orderId: z.string().min(5),
      paymentId: z.string().min(5),
      signature: z.string().min(5),
      amountPaise: z.number().int().positive().optional(),
    }),
  ),
  async (req, res) => {
    const b = await ownedBusiness(req.params.id, me(req).id);
    const mode = paymentsMode();
    let amount: number;
    if (mode === 'dev') {
      // Development-only simulated payment; env.ts makes this impossible in production.
      if (!req.body.orderId.startsWith('dev_order_') || !req.body.amountPaise) throw badRequest('Invalid dev payment');
      amount = req.body.amountPaise;
    } else if (mode === 'razorpay') {
      if (!verifyRazorpaySignature(req.body.orderId, req.body.paymentId, req.body.signature)) throw forbidden('Payment signature mismatch');
      amount = await fetchRazorpayOrderAmount(req.body.orderId); // trust the gateway, not the client, for the amount
    } else throw badRequest('Payments are not configured');

    if (await prisma.walletTransaction.findUnique({ where: { reference: `pay:${req.body.paymentId}` } })) throw conflict('Payment already credited');
    try {
      await prisma.$transaction([
        prisma.walletTransaction.create({ data: { businessId: b.id, type: 'TOPUP', amountPaise: amount, reference: `pay:${req.body.paymentId}`, note: 'Wallet top-up' } }),
        prisma.business.update({ where: { id: b.id }, data: { walletPaise: { increment: amount } } }),
      ]);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('Payment already credited');
      throw e;
    }
    const updated = await prisma.business.findUniqueOrThrow({ where: { id: b.id }, select: { walletPaise: true } });
    res.json({ ok: true, balancePaise: updated.walletPaise });
  },
);
