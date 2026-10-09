import { z } from 'zod';
import { env } from '../config/env';

/**
 * Image/media URLs supplied by clients. Only https (plus this API's own upload
 * origin, which is http in local dev). Blocks javascript:/data: URLs and
 * plain-http tracking pixels that would leak viewers' IPs.
 */
export const mediaUrl = z
  .string()
  .max(500)
  .url()
  .refine((u) => u.startsWith('https://') || u.startsWith(`${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/uploads/`), {
    message: 'Image URL must be https (upload images via /v1/uploads)',
  });

/** Dates bounded to a sane window (out-of-range values used to crash Postgres casts with a 500). */
export const boundedDate = z.coerce
  .date()
  .refine((d) => d.getTime() > Date.UTC(2000, 0, 1) && d.getTime() < Date.UTC(2100, 0, 1), { message: 'Date out of range' });

/** Escape LIKE/ILIKE metacharacters so user search text matches literally. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
