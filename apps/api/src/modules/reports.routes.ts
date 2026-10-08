import { Router } from 'express';
import { z } from 'zod';
import { ReportTarget } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { conflict } from '../lib/errors';
import { me, requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

/** Distinct reports from this many neighbours auto-hide a post/comment pending moderator review. */
export const AUTO_HIDE_THRESHOLD = 3;

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
    const key = { reporterId_targetType_targetId: { reporterId, targetType: req.body.targetType, targetId: req.body.targetId } };
    if (await prisma.report.findUnique({ where: key })) throw conflict('You have already reported this');
    await prisma.report.create({ data: { ...req.body, reporterId } });
    if (req.body.targetType === 'POST') {
      const p = await prisma.post.update({ where: { id: req.body.targetId }, data: { reportCount: { increment: 1 } } }).catch(() => null);
      if (p && p.reportCount >= AUTO_HIDE_THRESHOLD && p.status === 'ACTIVE') await prisma.post.update({ where: { id: p.id }, data: { status: 'HIDDEN' } });
    }
    if (req.body.targetType === 'COMMENT') {
      const n = await prisma.report.count({ where: { targetType: 'COMMENT', targetId: req.body.targetId, status: 'OPEN' } });
      if (n >= AUTO_HIDE_THRESHOLD) {
        const c = await prisma.comment.findUnique({ where: { id: req.body.targetId } });
        if (c?.status === 'ACTIVE') {
          await prisma.$transaction([
            prisma.comment.update({ where: { id: c.id }, data: { status: 'HIDDEN' } }),
            prisma.post.update({ where: { id: c.postId }, data: { commentCount: { decrement: 1 } } }),
          ]);
        }
      }
    }
    res.status(201).json({ ok: true, message: 'Thanks — our moderators will review this within 24 hours.' });
  },
);
