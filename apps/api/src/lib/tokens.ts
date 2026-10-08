import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from './prisma';
import { unauthorized } from './errors';

export interface AccessClaims {
  sub: string;
  role: string;
}

export function signAccessToken(userId: string, role: string): string {
  return jwt.sign({ role } satisfies Omit<AccessClaims, 'sub'>, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
    issuer: 'mohalla-connect',
    audience: 'mohalla-app',
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    const p = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'mohalla-connect',
      audience: 'mohalla-app',
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
    return { sub: String(p.sub), role: String(p.role) };
  } catch {
    throw unauthorized('Invalid or expired access token');
  }
}

const hashToken = (t: string) => crypto.createHmac('sha256', env.JWT_REFRESH_SECRET).update(t).digest('hex');

/** Opaque 256-bit refresh token; only its HMAC is stored. */
export async function issueRefreshToken(userId: string, meta: { familyId?: string; userAgent?: string; ip?: string } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400_000);
  await prisma.session.create({
    data: {
      userId,
      familyId: meta.familyId ?? crypto.randomUUID(),
      tokenHash: hashToken(token),
      userAgent: meta.userAgent?.slice(0, 255),
      ip: meta.ip,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

/**
 * Rotate a refresh token. If a token that was already rotated is presented
 * again (stolen + replayed), the whole session family is revoked.
 */
export async function rotateRefreshToken(token: string, meta: { userAgent?: string; ip?: string }) {
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session) throw unauthorized('Invalid refresh token');
  if (session.revokedAt) {
    await prisma.session.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw unauthorized('Refresh token reuse detected; please log in again');
  }
  if (session.expiresAt < new Date()) throw unauthorized('Session expired');
  if (session.user.isBanned || session.user.deletedAt) throw unauthorized('Account unavailable');

  // Atomic claim: only one concurrent rotation can win.
  const claimed = await prisma.session.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (claimed.count !== 1) throw unauthorized('Refresh token already used');

  const next = await issueRefreshToken(session.userId, { familyId: session.familyId, ...meta });
  return { user: session.user, refresh: next, access: signAccessToken(session.userId, session.user.platformRole) };
}

export async function revokeRefreshToken(token: string) {
  await prisma.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: string) {
  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
