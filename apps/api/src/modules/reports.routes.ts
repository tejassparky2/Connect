import { Router } from 'express';
import { z } from 'zod';
import { Prisma, ReportTarget } from '@prisma/client';
import { getUserHome, pointSql } from '../lib/geo';
import { prisma } from '../lib/prisma';
import { conflict, notFound } from '../lib/errors';
import { me, requireAuth, requireLevel } from '../middleware/auth';
import { validate } from '../middleware/validate';

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireLevel('LOCATION'));

/** Distinct reports from this many neighbours auto-hide a post/comment pending moderator review. */
export const AUTO_HIDE_THRESHOLD = 3;
const TRUSTED_REPORTER_MIN_AGE_DAYS = 3;

/** You can only report content you could actually see (same 10 km visibility as the feed). */
async function assertCanSee(viewerId: string, type: 'POST' | 'COMMENT', id: string) {
  const postId = type === 'POST' ? id : (await prisma.comment.findUnique({ where: { id }, select: { postId: true } }))?.postId;
  if (!postId) throw notFound(type === 'POST' ? 'Post' : 'Comment');
  const home = await getUserHome(viewerId);
  if (!home) throw notFound('Post');
  const rows = await prisma.$queryRaw<{ ok: boolean }[]>`
    SELECT true AS ok FROM posts WHERE id = ${postId}::uuid AND ST_DWithin(location, ${pointSql(home)}, 10000)`;
  if (!rows.length) throw notFound('Post');
}

reportsRouter.post(
  '/',
  validate(
    'body',
    z.object({
      targetType: z.enum(ReportTarget),
      targetId: z.uuid(),
      reason: z.enum(['SPAM', 'SCAM', 'HATE', 'HARASSMENT', 'MISINFORMATION', 'INAPPROPRIATE', 'FAKE_PROFILE', 'OTHER']),
      details: z.string().trim().max(500).optional(),
    }),
  ),
  async (req, res) => {
    const reporterId = me(req).id;
    const { targetType, targetId } = req.body as { targetType: ReportTarget; targetId: string };
    if (targetType === 'POST' || targetType === 'COMMENT') await assertCanSee(reporterId, targetType, targetId);
    const key = { reporterId_targetType_targetId: { reporterId, targetType, targetId } };
    if (await prisma.report.findUnique({ where: key })) throw conflict('You have already reported this');
    await prisma.report.create({ data: { ...req.body, reporterId } });

    // Auto-hide only counts reports from established accounts (≥3 days old or address-verified),
    // so a handful of fresh sock-puppets can't silence a neighbour. Everything still reaches moderators.
    const trusted = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM reports r JOIN users u ON u.id = r."reporterId"
      WHERE r."targetType" = ${targetType}::"ReportTarget" AND r."targetId" = ${targetId}::uuid AND r.status = 'OPEN'
        AND (u."createdAt" < now() - interval '${Prisma.raw(String(TRUSTED_REPORTER_MIN_AGE_DAYS))} days' OR u."verificationLevel" = 'ADDRESS')`;
    const trustedCount = Number(trusted[0].n);

    if (targetType === 'POST') {
      await prisma.post.updateMany({ where: { id: targetId }, data: { reportCount: { increment: 1 } } });
      if (trustedCount >= AUTO_HIDE_THRESHOLD) await prisma.post.updateMany({ where: { id: targetId, status: 'ACTIVE' }, data: { status: 'HIDDEN' } });
    }
    if (targetType === 'COMMENT' && trustedCount >= AUTO_HIDE_THRESHOLD) {
      await prisma.$transaction(async (tx) => {
        const c = await tx.comment.findUnique({ where: { id: targetId }, select: { postId: true } });
        if (!c) return;
        // Conditional transition: only the request that actually hides it decrements the counter.
        const hidden = await tx.comment.updateMany({ where: { id: targetId, status: 'ACTIVE' }, data: { status: 'HIDDEN' } });
        if (hidden.count === 1) await tx.post.update({ where: { id: c.postId }, data: { commentCount: { decrement: 1 } } });
      });
    }
    res.status(201).json({ ok: true, message: 'Thanks — our moderators will review this within 24 hours.' });
  },
);
