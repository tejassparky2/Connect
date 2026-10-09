import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { isTest } from '../config/env';

/**
 * Per-USER limits (keyed by the authenticated user id, not IP) — IPs are shared on
 * Indian mobile carriers (CGNAT) and spoofable behind misconfigured proxies.
 * Must be mounted after requireAuth.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function perUser(windowMs: number, limit: number, message: string): RequestHandler<any> {
  return rateLimit({
    windowMs,
    limit: isTest ? Math.max(limit, 10_000) : limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `u:${req.user?.id ?? 'anon'}`,
    message: { error: { code: 'RATE_LIMITED', message } },
  });
}
