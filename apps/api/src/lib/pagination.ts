import crypto from 'node:crypto';
import { env } from '../config/env';
import { badRequest } from './errors';

/** Opaque keyset cursor: base64url(JSON). Keyset (not OFFSET) keeps deep pages O(log n). */
export function encodeCursor(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

export function decodeCursor<T extends Record<string, unknown>>(cursor: string | undefined | null): T | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    throw badRequest('Invalid cursor');
  }
}


const cursorKey = crypto.createHash('sha256').update(`cursor:${env.JWT_ACCESS_SECRET}`).digest();

/**
 * Encrypted cursor (AES-256-GCM) for cursors that carry sensitive values —
 * e.g. the exact distance to a neighbour's home, which must not leak to clients.
 */
export function sealCursor(obj: Record<string, unknown>): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cursorKey, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}

export function openCursor<T extends Record<string, unknown>>(cursor: string | undefined | null): T | null {
  if (!cursor) return null;
  try {
    const buf = Buffer.from(cursor, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', cursorKey, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')) as T;
  } catch {
    throw badRequest('Invalid cursor');
  }
}
