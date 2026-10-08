import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { PlatformRole, VerificationLevel } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../lib/tokens';
import { AppError, forbidden, needsVerification, unauthorized } from '../lib/errors';

export interface AuthUser {
  id: string;
  platformRole: PlatformRole;
  verificationLevel: VerificationLevel;
  neighborhoodId: string | null;
  feedRadiusM: number;
  name: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

const LEVEL_RANK: Record<VerificationLevel, number> = { PHONE: 0, LOCATION: 1, ADDRESS: 2 };

export const levelAtLeast = (have: VerificationLevel, need: VerificationLevel) => LEVEL_RANK[have] >= LEVEL_RANK[need];

/** Validates the bearer JWT and loads the live user row (so bans / level changes apply immediately). */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  const claims = verifyAccessToken(header.slice(7));
  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, platformRole: true, verificationLevel: true, neighborhoodId: true, feedRadiusM: true, name: true, isBanned: true, deletedAt: true, lastActiveAt: true },
  });
  if (!user || user.deletedAt) return next(unauthorized('Account not found'));
  if (user.isBanned) return next(forbidden('This account has been suspended'));
  req.user = user;
  // Cheap activity tracking, at most once every 5 minutes.
  if (Date.now() - user.lastActiveAt.getTime() > 5 * 60_000) {
    prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } }).catch(() => undefined);
  }
  next();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function requireLevel(level: VerificationLevel): RequestHandler<any> {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!levelAtLeast(req.user.verificationLevel, level)) return next(needsVerification(level));
    next();
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function requireRole(...roles: PlatformRole[]): RequestHandler<any> {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.platformRole)) return next(forbidden());
    next();
  };
}

export function me(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reject non-UUID path params with a 404 before they reach `::uuid` casts in SQL. */
export function uuidParams(router: import('express').Router, ...names: string[]) {
  for (const name of names) {
    router.param(name, (_req, _res, next, value) => {
      if (typeof value !== 'string' || !UUID_RE.test(value)) return next(new AppError(404, 'NOT_FOUND', 'Resource not found'));
      next();
    });
  }
}
