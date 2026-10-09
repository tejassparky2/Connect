import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { normalizeIndianPhone } from '../lib/phone';
import { AppError, badRequest } from '../lib/errors';

/** Bump when the privacy notice changes materially (users re-consent). */
export const PRIVACY_NOTICE_VERSION = '2026-10';
import { issueRefreshToken, revokeRefreshToken, rotateRefreshToken, signAccessToken } from '../lib/tokens';
import { otpProvider } from '../services/otp';
import { validate } from '../middleware/validate';
import { env, isTest } from '../config/env';
import { serializeMe } from './me.routes';

export const authRouter = Router();

// Per-IP limits stop SMS-pumping from a single source; per-phone limits live in the OTP service.
const otpLimiter = rateLimit({ windowMs: 15 * 60_000, limit: isTest ? 1000 : env.OTP_IP_LIMIT_PER_15MIN, standardHeaders: 'draft-7', legacyHeaders: false });
const verifyLimiter = rateLimit({ windowMs: 15 * 60_000, limit: isTest ? 1000 : 30, standardHeaders: 'draft-7', legacyHeaders: false });

const phoneSchema = z.object({ phone: z.string().min(10).max(20) });

function parsePhone(raw: string): string {
  const phone = normalizeIndianPhone(raw);
  if (!phone) throw badRequest('Enter a valid 10-digit Indian mobile number');
  return phone;
}

authRouter.post('/otp/request', otpLimiter, validate('body', phoneSchema), async (req, res) => {
  const phone = parsePhone(req.body.phone);
  const result = await otpProvider.send(phone, req.ip);
  res.json({ ok: true, phone, expiresInSec: 300, ...(result.devCode ? { devCode: result.devCode } : {}) });
});

authRouter.post(
  '/otp/verify',
  verifyLimiter,
  validate(
    'body',
    z.object({
      phone: z.string().min(10).max(20),
      code: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
      /** Required for NEW accounts: affirmative acceptance of the privacy notice (DPDP Act 2023). */
      consent: z.boolean().optional(),
    }),
  ),
  async (req, res) => {
    const phone = parsePhone(req.body.phone);
    // Check consent BEFORE consuming the OTP, so a missing tick doesn't burn the user's code.
    let user = await prisma.user.findUnique({ where: { phone } });
    if (!user && req.body.consent !== true) throw new AppError(400, 'CONSENT_REQUIRED', 'Please accept the privacy notice to create your account');
    const { providerUserId } = await otpProvider.verify(phone, req.body.code, req.ip);

    user ??= await prisma.user.findUnique({ where: { phone } });
    const isNewUser = !user;
    if (!user) {
      user = await prisma.user.create({ data: { phone, authProviderId: providerUserId, consentAt: new Date(), consentVersion: PRIVACY_NOTICE_VERSION } });
    } else if (providerUserId && !user.authProviderId) {
      user = await prisma.user.update({ where: { id: user.id }, data: { authProviderId: providerUserId } });
    }
    if (user.isBanned) throw badRequest('This account has been suspended');

    const refresh = await issueRefreshToken(user.id, { userAgent: req.get('user-agent'), ip: req.ip });
    res.json({
      accessToken: signAccessToken(user.id, user.platformRole),
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
      isNewUser: isNewUser || !user.name,
      user: await serializeMe(user.id),
    });
  },
);

authRouter.post('/refresh', validate('body', z.object({ refreshToken: z.string().min(20) })), async (req, res) => {
  const { access, refresh } = await rotateRefreshToken(req.body.refreshToken, { userAgent: req.get('user-agent'), ip: req.ip });
  res.json({ accessToken: access, refreshToken: refresh.token, refreshExpiresAt: refresh.expiresAt });
});

authRouter.post('/logout', validate('body', z.object({ refreshToken: z.string().min(20) })), async (req, res) => {
  await revokeRefreshToken(req.body.refreshToken);
  res.json({ ok: true });
});
