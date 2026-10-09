import crypto from 'node:crypto';
import { z, type ZodType } from 'zod';
import { env } from '../config/env';
import { badRequest } from './errors';

/**
 * Keyset pagination cursors (keyset, not OFFSET, keeps deep pages O(log n)).
 *
 * Every cursor is SEALED (AES-256-GCM, server key) — clients can't read or forge
 * them. That matters for security, not just tidiness: the feed cursor carries the
 * search radius, and directory cursors carry exact distances. A forged plain-text
 * cursor could otherwise lift the geofence or inject malformed values into SQL casts.
 */
const cursorKey = crypto.createHash('sha256').update(`cursor:${env.JWT_ACCESS_SECRET}`).digest();

export function sealCursor(obj: Record<string, unknown>): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cursorKey, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}

export function openCursor<T extends Record<string, unknown>>(cursor: string | undefined | null, schema?: ZodType<T>): T | null {
  if (!cursor) return null;
  let parsed: unknown;
  try {
    const buf = Buffer.from(cursor, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', cursorKey, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    parsed = JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
  } catch {
    throw badRequest('Invalid cursor');
  }
  if (!schema) return parsed as T;
  const r = schema.safeParse(parsed);
  if (!r.success) throw badRequest('Invalid cursor');
  return r.data;
}

// Backwards-compatible names used across routes.
export const encodeCursor = sealCursor;
export const decodeCursor = openCursor;

export const timeCursor = z.object({ t: z.iso.datetime(), id: z.uuid() });
export const distanceCursor = z.object({ d: z.number().finite().min(0), id: z.uuid() });
export const feedCursor = timeCursor.extend({ r: z.number().int().min(500).max(5000) });
