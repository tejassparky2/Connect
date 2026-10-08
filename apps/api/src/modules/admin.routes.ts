/**
 * Platform operations (MODERATOR / ADMIN). Deliberately small: the trust
 * system is designed so that humans only review societies, flagged content
 * and flagged ads — never individual resident verifications.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, notFound } from '../lib/errors';
import { me, requireAuth, requireRole, uuidParams } from '../middleware/auth';
import { q, validate } from '../middleware/validate';
import { revokeAllSessions } from '../lib/tokens';
import { notifyLater } from '../services/notify';
import { settleCampaign } from './ads.routes';
import { recomputeLevel, applySocietyApproval } from '../services/verification';

export const adminRouter = Router();
uuidParams(adminRouter, 'id');
adminRouter.use(requireAuth, requireRole('MODERATOR', 'ADMIN'));

adminRouter.get('/stats', async (_req, res) => {
  const [users, verified, neighborhoods, societies, posts24h, openReports, pendingAds, unverifiedSocieties] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null, verificationLevel: { not: 'PHONE' } } }),
    prisma.neighborhood.groupBy({ by: ['status'], _count: true }),
    prisma.society.count(),
    prisma.post.count({ where: { createdAt: { gt: new Date(Date.now() - 86400_000) } } }),
    prisma.report.count({ where: { status: 'OPEN' } }),
    prisma.adCampaign.count({ where: { status: 'PENDING_REVIEW' } }),
    prisma.society.count({ where: { isVerified: false } }),
  ]);
  res.json({ users, verified, neighborhoods, societies, posts24h, openReports, pendingAds, unverifiedSocieties });
});

/**
 * Cold-start seeding: import neighbourhood boundaries as GeoJSON
 * (OSM admin_level=10 wards, municipal ward maps, or hand-drawn polygons).
 * ST_MakeValid repairs self-intersections common in public datasets.
 */
adminRouter.post(
  '/neighborhoods',
  requireRole('ADMIN'),
  validate(
    'body',
    z.object({
      name: z.string().trim().min(2).max(100),
      slug: z.string().regex(/^[a-z0-9-]{3,80}$/),
      city: z.string().trim().min(2),
      state: z.string().trim().min(2),
      pincode: z.string().regex(/^[1-9]\d{5}$/).optional(),
      geojson: z.object({ type: z.enum(['Polygon', 'MultiPolygon']), coordinates: z.array(z.any()).min(1) }),
    }),
  ),
  async (req, res) => {
    const { name, slug, city, state, pincode, geojson } = req.body;
    if (await prisma.neighborhood.findUnique({ where: { slug } })) throw conflict('Slug already exists');
    try {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        WITH g AS (SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geojson)}), 4326)), 3)) AS geom)
        INSERT INTO neighborhoods (id, name, slug, city, state, pincode, boundary, center)
        SELECT gen_random_uuid(), ${name}, ${slug}, ${city}, ${state}, ${pincode ?? null}, geom::geography, ST_PointOnSurface(geom)::geography FROM g
        RETURNING id`;
      // Adopt existing residents whose home falls inside the new boundary.
      await prisma.$executeRaw`
        UPDATE users u SET "neighborhoodId" = ${rows[0].id}::uuid
        FROM neighborhoods n WHERE n.id = ${rows[0].id}::uuid AND u."neighborhoodId" IS NULL
          AND u."homeLocation" IS NOT NULL AND ST_Covers(n.boundary, u."homeLocation")`;
      res.status(201).json({ id: rows[0].id });
    } catch (e) {
      throw badRequest('Invalid GeoJSON geometry', String((e as Error).message).slice(0, 200));
    }
  },
);

adminRouter.get('/reports', async (_req, res) => {
  const reports = await prisma.report.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' }, take: 100 });
  res.json({ items: reports });
});

adminRouter.post(
  '/reports/:id/resolve',
  validate('body', z.object({ action: z.enum(['REMOVE_CONTENT', 'RESTORE_CONTENT', 'BAN_USER', 'DISMISS']) })),
  async (req, res) => {
    const r = await prisma.report.findUnique({ where: { id: req.params.id } });
    if (!r) throw notFound('Report');
    const action = req.body.action as string;
    if (r.targetType === 'POST' && (action === 'REMOVE_CONTENT' || action === 'RESTORE_CONTENT'))
      await prisma.post.update({ where: { id: r.targetId }, data: { status: action === 'REMOVE_CONTENT' ? 'REMOVED' : 'ACTIVE', ...(action === 'RESTORE_CONTENT' ? { reportCount: 0 } : {}) } });
    if (r.targetType === 'COMMENT' && action === 'REMOVE_CONTENT') await prisma.comment.update({ where: { id: r.targetId }, data: { status: 'REMOVED' } });
    if (action === 'BAN_USER') {
      const userId =
        r.targetType === 'USER' ? r.targetId
        : r.targetType === 'POST' ? (await prisma.post.findUnique({ where: { id: r.targetId } }))?.authorId
        : r.targetType === 'COMMENT' ? (await prisma.comment.findUnique({ where: { id: r.targetId } }))?.authorId
        : undefined;
      if (userId) {
        await prisma.user.update({ where: { id: userId }, data: { isBanned: true } });
        await revokeAllSessions(userId);
      }
    }
    await prisma.report.updateMany({
      where: { targetType: r.targetType, targetId: r.targetId, status: 'OPEN' },
      data: { status: action === 'DISMISS' || action === 'RESTORE_CONTENT' ? 'DISMISSED' : 'ACTIONED' },
    });
    res.json({ ok: true });
  },
);

/** Verify a society after checking its RWA registration certificate. Retro-verifies approved members' addresses. */
adminRouter.post('/societies/:id/verify', async (req, res) => {
  const s = await prisma.society.update({ where: { id: req.params.id }, data: { isVerified: true } }).catch(() => null);
  if (!s) throw notFound('Society');
  const members = await prisma.societyMembership.findMany({ where: { societyId: s.id, status: 'APPROVED' }, select: { userId: true } });
  for (const m of members) await applySocietyApproval(m.userId, s.id, 'SOCIETY_ADMIN');
  notifyLater(members.map((m) => m.userId), { type: 'SYSTEM', title: `${s.name} is now verified ✅`, body: 'Your society has a verified badge on Mohalla Connect.' });
  res.json({ ok: true, membersReverified: members.length });
});

adminRouter.post('/businesses/:id/verify', async (req, res) => {
  const b = await prisma.business.update({ where: { id: req.params.id }, data: { isVerified: true } }).catch(() => null);
  if (!b) throw notFound('Business');
  notifyLater([b.ownerId], { type: 'SYSTEM', title: 'Business verified ✅', body: `${b.name} now shows a verified badge.` });
  res.json({ ok: true });
});

adminRouter.post('/providers/:id/id-verify', async (req, res) => {
  const p = await prisma.serviceProvider.update({ where: { id: req.params.id }, data: { idVerified: true } }).catch(() => null);
  if (!p) throw notFound('Worker');
  res.json({ ok: true });
});

adminRouter.get('/ads', validate('query', z.object({ status: z.enum(['PENDING_REVIEW', 'ACTIVE']).default('PENDING_REVIEW') })), async (req, res) => {
  res.json({ items: await prisma.adCampaign.findMany({ where: { status: q<{ status: 'PENDING_REVIEW' }>(req).status }, include: { business: { select: { name: true } } } }) });
});

adminRouter.post('/ads/:id/review', validate('body', z.object({ approve: z.boolean(), reason: z.string().max(200).optional() })), async (req, res) => {
  const c = await prisma.adCampaign.findUnique({ where: { id: req.params.id }, include: { business: true } });
  if (!c || c.status !== 'PENDING_REVIEW') throw notFound('Campaign pending review');
  if (req.body.approve) await prisma.adCampaign.update({ where: { id: c.id }, data: { status: 'ACTIVE' } });
  else {
    await prisma.adCampaign.update({ where: { id: c.id }, data: { rejectReason: req.body.reason ?? 'Violates ad policy' } });
    await settleCampaign(c.id, 'ENDED');
    await prisma.adCampaign.update({ where: { id: c.id }, data: { status: 'REJECTED' } });
  }
  notifyLater([c.business.ownerId], { type: 'AD_STATUS', title: req.body.approve ? 'Ad approved — now live 🎉' : 'Ad not approved', body: req.body.approve ? c.headline : `${c.headline}: ${req.body.reason ?? 'Violates ad policy'}. Budget refunded.`, data: { campaignId: c.id } });
  res.json({ ok: true });
});

adminRouter.post('/users/:id/ban', requireRole('ADMIN'), async (req, res) => {
  if (req.params.id === me(req).id) throw badRequest("Can't ban yourself");
  await prisma.user.update({ where: { id: req.params.id }, data: { isBanned: true } });
  await revokeAllSessions(req.params.id);
  res.json({ ok: true });
});

adminRouter.post('/users/:id/recompute-level', async (req, res) => {
  res.json({ level: await recomputeLevel(req.params.id) });
});
