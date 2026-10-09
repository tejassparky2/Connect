/**
 * Self-serve hyper-local ads.
 *
 * Money model (all integers in paise, no floats):
 *   • Business tops up a wallet (Razorpay).
 *   • Launching a campaign RESERVES the full budget from the wallet.
 *   • Each de-duplicated impression (1 per user per campaign per day) bills
 *     cpm/1000; spend is recomputed as floor(impressions × cpm / 1000) in one
 *     atomic UPDATE, so concurrent impressions can never overspend.
 *   • Ending/expiring a campaign refunds (budget − spent) to the wallet.
 */
import { Router } from 'express';
import { z } from 'zod';
import { mediaUrl, boundedDate } from '../lib/validators';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { bucketCount, countUsersWithin, createWithPoint, getPoint, pointSql, queryEligibleAdIds, type LatLng } from '../lib/geo';
import rateLimit from 'express-rate-limit';
import { isTest } from '../config/env';
import { me, requireAuth, requireLevel, uuidParams } from '../middleware/auth';
import { q, validate } from '../middleware/validate';
import { clean, needsReview } from '../services/moderation';
import { notifyLater } from '../services/notify';

export const adsRouter = Router();
uuidParams(adsRouter, 'id');
adsRouter.use(requireAuth);

const MIN_BUDGET_PAISE = 100_00; // ₹100
const MIN_CPM_PAISE = 20_00; // ₹20 per 1000 impressions

const adPublicSelect = {
  id: true,
  headline: true,
  body: true,
  imageUrl: true,
  cta: true,
  business: { select: { id: true, name: true, category: true, phone: true, whatsapp: true, isVerified: true, photos: true } },
} as const;

/** Pick eligible ads for a viewer's home. Used by the feed and /ads/serve. */
export async function serveAdsFor(home: LatLng, limit: number) {
  const ids = await queryEligibleAdIds(home, limit);
  if (!ids.length) return [];
  const ads = await prisma.adCampaign.findMany({ where: { id: { in: ids } }, select: adPublicSelect });
  return ads.map((a) => ({ ...a, sponsored: true as const }));
}

/**
 * Close a campaign and refund (budget − spent) exactly once.
 * The row is locked FOR UPDATE first, so concurrent impression UPDATEs either finish
 * before we read spentPaise or re-check `status = 'ACTIVE'` after we commit and bill nothing.
 */
export async function settleCampaign(campaignId: string, finalStatus: 'ENDED' | 'EXHAUSTED') {
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string; businessId: string; budgetPaise: number; spentPaise: number; status: string; headline: string }[]>`
      SELECT id, "businessId", "budgetPaise", "spentPaise", status::text AS status, headline
      FROM ad_campaigns WHERE id = ${campaignId}::uuid FOR UPDATE`;
    const c = locked[0];
    if (!c) return;
    const wasFunded = !['DRAFT', 'REJECTED'].includes(c.status);
    await tx.adCampaign.update({ where: { id: c.id }, data: { status: finalStatus } });
    const refund = c.budgetPaise - c.spentPaise;
    const ref = `refund:${c.id}`;
    if (refund > 0 && wasFunded && !(await tx.walletTransaction.findUnique({ where: { reference: ref } }))) {
      await tx.walletTransaction.create({ data: { businessId: c.businessId, type: 'REFUND', amountPaise: refund, reference: ref, note: `Unspent budget: ${c.headline}` } });
      await tx.business.update({ where: { id: c.businessId }, data: { walletPaise: { increment: refund } } });
    }
  });
}

/** Close out campaigns whose end date passed. Called opportunistically + by the scheduler in server.ts. */
export async function sweepExpiredCampaigns() {
  const expired = await prisma.adCampaign.findMany({ where: { status: { in: ['ACTIVE', 'PAUSED'] }, endAt: { lt: new Date() } }, select: { id: true } });
  for (const c of expired) await settleCampaign(c.id, 'ENDED');
  return expired.length;
}

async function ownedCampaign(campaignId: string, userId: string) {
  const c = await prisma.adCampaign.findUnique({ where: { id: campaignId }, include: { business: { select: { ownerId: true, name: true } } } });
  if (!c) throw notFound('Campaign');
  if (c.business.ownerId !== userId) throw forbidden('Not your campaign');
  return c;
}

const campaignOut = (c: { id: string; headline: string; body: string; imageUrl: string | null; cta: string; radiusM: number; budgetPaise: number; spentPaise: number; cpmPaise: number; impressions: number; clicks: number; status: string; rejectReason: string | null; startAt: Date; endAt: Date; businessId: string; createdAt: Date }) => ({
  ...c,
  ctr: c.impressions ? Math.round((c.clicks / c.impressions) * 10000) / 100 : 0,
  remainingPaise: c.budgetPaise - c.spentPaise,
});

// ─────────────── Advertiser endpoints ───────────────

adsRouter.get('/campaigns', validate('query', z.object({ businessId: z.uuid() })), async (req, res) => {
  const { businessId } = q<{ businessId: string }>(req);
  const biz = await prisma.business.findUnique({ where: { id: businessId } });
  if (!biz || biz.ownerId !== me(req).id) throw forbidden();
  const items = await prisma.adCampaign.findMany({ where: { businessId }, orderBy: { createdAt: 'desc' } });
  res.json({ items: items.map(campaignOut) });
});

/** Estimated reach for the targeting slider in the ad builder. */
const estimateLimiter = rateLimit({ windowMs: 60 * 60_000, limit: isTest ? 1000 : 30, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => req.user?.id ?? 'anon' });

/** Estimated reach for the ad builder. Owner-only, rate-limited and bucketed (see bucketCount). */
adsRouter.get(
  '/estimate',
  estimateLimiter,
  validate('query', z.object({ businessId: z.uuid(), radiusM: z.coerce.number().int().min(500).max(10000) })),
  async (req, res) => {
    const { businessId, radiusM } = q<{ businessId: string; radiusM: number }>(req);
    const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { ownerId: true } });
    if (!biz || biz.ownerId !== me(req).id) throw forbidden('Not your business');
    const loc = await getPoint('businesses', businessId);
    if (!loc) throw notFound('Business');
    const households = bucketCount(await countUsersWithin(loc, radiusM, { verifiedOnly: true }));
    res.json({ radiusM, verifiedHouseholds: households, approximate: true, suggestedDailyBudgetPaise: Math.max(MIN_BUDGET_PAISE, Math.ceil((households * 2 * MIN_CPM_PAISE) / 1000 / 100) * 100) });
  },
);

const createCampaign = z
  .object({
    businessId: z.uuid(),
    headline: z.string().trim().min(5).max(80),
    body: z.string().trim().min(10).max(280),
    imageUrl: mediaUrl.optional(),
    cta: z.enum(['CALL', 'WHATSAPP', 'VIEW_BUSINESS']).default('VIEW_BUSINESS'),
    radiusM: z.number().int().min(500).max(10000).default(3000),
    budgetPaise: z.number().int().min(MIN_BUDGET_PAISE).max(10_000_000_00),
    cpmPaise: z.number().int().min(MIN_CPM_PAISE).max(1000_00).default(50_00),
    startAt: boundedDate.optional(),
    endAt: boundedDate,
  })
  .refine((v) => v.endAt.getTime() > (v.startAt?.getTime() ?? Date.now()), { message: 'End date must be after start', path: ['endAt'] });

adsRouter.post('/campaigns', requireLevel('LOCATION'), validate('body', createCampaign), async (req, res) => {
  const input = req.body as z.infer<typeof createCampaign>;
  const biz = await prisma.business.findUnique({ where: { id: input.businessId } });
  if (!biz || biz.ownerId !== me(req).id) throw forbidden('You can only advertise your own business');
  if (biz.status !== 'ACTIVE') throw forbidden('Business is suspended');
  const loc = await getPoint('businesses', biz.id);
  if (!loc) throw badRequest('Business location missing');
  const c = await createWithPoint('ad_campaigns', loc, (tx) =>
    tx.adCampaign.create({
      data: {
        businessId: biz.id,
        headline: clean(input.headline),
        body: clean(input.body),
        imageUrl: input.imageUrl,
        cta: input.cta,
        radiusM: input.radiusM,
        budgetPaise: input.budgetPaise,
        cpmPaise: input.cpmPaise,
        startAt: input.startAt ?? new Date(),
        endAt: input.endAt,
      },
    }),
  );
  res.status(201).json(campaignOut(c));
});

adsRouter.get('/campaigns/:id', async (req, res) => {
  res.json(campaignOut(await ownedCampaign(req.params.id, me(req).id)));
});

/** Reserve budget from wallet and go live (or to review if auto-moderation flags it). */
adsRouter.post('/campaigns/:id/launch', async (req, res) => {
  const c = await ownedCampaign(req.params.id, me(req).id);
  if (c.status !== 'DRAFT') throw conflict(`Campaign is already ${c.status.toLowerCase()}`);
  if (c.endAt < new Date()) throw badRequest('Campaign end date has passed');
  const flagged = needsReview(c.headline, c.body);
  await prisma.$transaction(async (tx) => {
    // Conditional decrement: fails atomically if the balance is insufficient.
    const debited = await tx.business.updateMany({ where: { id: c.businessId, walletPaise: { gte: c.budgetPaise } }, data: { walletPaise: { decrement: c.budgetPaise } } });
    if (debited.count !== 1) throw badRequest('Insufficient wallet balance. Please top up first.');
    await tx.walletTransaction.create({ data: { businessId: c.businessId, type: 'AD_SPEND', amountPaise: -c.budgetPaise, reference: `reserve:${c.id}`, note: `Budget reserved: ${c.headline}` } });
    // Conditional transition: a concurrent /end on the DRAFT must not be overwritten.
    const moved = await tx.adCampaign.updateMany({ where: { id: c.id, status: 'DRAFT' }, data: { status: flagged ? 'PENDING_REVIEW' : 'ACTIVE' } });
    if (moved.count !== 1) throw conflict('Campaign changed state, please refresh');
  });
  res.json(campaignOut(await ownedCampaign(c.id, me(req).id)));
});

adsRouter.post('/campaigns/:id/pause', async (req, res) => {
  const c = await ownedCampaign(req.params.id, me(req).id);
  if (c.status !== 'ACTIVE') throw conflict('Only active campaigns can be paused');
  await prisma.adCampaign.update({ where: { id: c.id }, data: { status: 'PAUSED' } });
  res.json(campaignOut(await ownedCampaign(c.id, me(req).id)));
});

adsRouter.post('/campaigns/:id/resume', async (req, res) => {
  const c = await ownedCampaign(req.params.id, me(req).id);
  if (c.status !== 'PAUSED') throw conflict('Only paused campaigns can be resumed');
  if (c.endAt < new Date()) throw badRequest('Campaign has ended');
  await prisma.adCampaign.update({ where: { id: c.id }, data: { status: 'ACTIVE' } });
  res.json(campaignOut(await ownedCampaign(c.id, me(req).id)));
});

adsRouter.post('/campaigns/:id/end', async (req, res) => {
  const c = await ownedCampaign(req.params.id, me(req).id);
  if (['ENDED', 'EXHAUSTED', 'REJECTED'].includes(c.status)) throw conflict('Campaign already closed');
  if (c.status === 'DRAFT') await prisma.adCampaign.update({ where: { id: c.id }, data: { status: 'ENDED' } });
  else await settleCampaign(c.id, 'ENDED');
  res.json(campaignOut(await ownedCampaign(c.id, me(req).id)));
});

// ─────────────── Delivery & tracking ───────────────

adsRouter.get('/serve', validate('query', z.object({ limit: z.coerce.number().int().min(1).max(3).default(1) })), async (req, res) => {
  const home = await getPoint('users', me(req).id);
  if (!home) return res.json({ items: [] });
  res.json({ items: await serveAdsFor(home, q<{ limit: number }>(req).limit) });
});

const today = () => new Date(new Date().toISOString().slice(0, 10));

/**
 * Impressions are billed only if the ad is genuinely eligible for THIS viewer right now:
 * LOCATION-verified viewer, campaign ACTIVE and in its date window, and the viewer's
 * home inside the campaign's targeting radius. All checks live in the same UPDATE as
 * the billing, so they're atomic with it. One billable impression per user per day.
 */
adsRouter.post('/:id/impression', requireLevel('LOCATION'), async (req, res) => {
  const userId = me(req).id;
  const home = await getPoint('users', userId);
  if (!home) return res.json({ ok: true });
  const eligible = await prisma.$queryRaw<{ ok: boolean }[]>`
    SELECT true AS ok FROM ad_campaigns c
    WHERE c.id = ${req.params.id}::uuid AND c.status = 'ACTIVE' AND now() BETWEEN c."startAt" AND c."endAt"
      AND ST_DWithin(c.location, ${pointSql(home)}, c."radiusM")`;
  if (!eligible.length) return res.json({ ok: true, billed: false });
  const ins = await prisma.adEvent.createMany({ data: [{ campaignId: req.params.id, userId, type: 'IMPRESSION', day: today() }], skipDuplicates: true });
  let billed = false;
  if (ins.count === 1) {
    const rows = await prisma.$queryRaw<{ status: string; ownerId: string; headline: string }[]>`
      UPDATE ad_campaigns c SET
        impressions = c.impressions + 1,
        "spentPaise" = LEAST(c."budgetPaise", ((c.impressions + 1)::bigint * c."cpmPaise" / 1000)::int),
        status = CASE WHEN ((c.impressions + 1)::bigint * c."cpmPaise" / 1000) >= c."budgetPaise" THEN 'EXHAUSTED'::"AdStatus" ELSE c.status END,
        "updatedAt" = now()
      FROM businesses b
      WHERE c.id = ${req.params.id}::uuid AND c.status = 'ACTIVE' AND now() BETWEEN c."startAt" AND c."endAt"
        AND b.id = c."businessId"
      RETURNING c.status::text AS status, b."ownerId" AS "ownerId", c.headline`;
    billed = rows.length === 1;
    if (rows[0]?.status === 'EXHAUSTED') {
      notifyLater([rows[0].ownerId], { type: 'AD_STATUS', title: 'Campaign budget used up', body: `"${rows[0].headline}" has reached its budget.`, data: { campaignId: req.params.id } });
    }
  }
  res.json({ ok: true, billed });
});

adsRouter.post('/:id/click', requireLevel('LOCATION'), async (req, res) => {
  const userId = me(req).id;
  // A click only counts after a recorded impression for this viewer today.
  const seen = await prisma.adEvent.findUnique({ where: { campaignId_userId_type_day: { campaignId: req.params.id, userId, type: 'IMPRESSION', day: today() } } });
  if (!seen) return res.json({ ok: true });
  const ins = await prisma.adEvent.createMany({ data: [{ campaignId: req.params.id, userId, type: 'CLICK', day: today() }], skipDuplicates: true });
  if (ins.count === 1) await prisma.adCampaign.updateMany({ where: { id: req.params.id }, data: { clicks: { increment: 1 } } });
  res.json({ ok: true });
});
