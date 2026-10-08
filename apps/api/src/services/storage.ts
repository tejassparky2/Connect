import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env';
import { badRequest } from '../lib/errors';

const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Sniff magic bytes — never trust the client-declared Content-Type. */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

let s3: S3Client | null = null;
const getS3 = () =>
  (s3 ??= new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: !!env.S3_ENDPOINT,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  }));

/** Store an image and return its public URL. Works with AWS S3, Cloudflare R2, Supabase Storage (S3 API). */
export async function storeImage(buf: Buffer, userId: string): Promise<string> {
  const mime = sniffImageMime(buf);
  if (!mime) throw badRequest('Only JPEG, PNG or WebP images are allowed');
  const key = `u/${userId.slice(0, 8)}/${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.${MIME_EXT[mime]}`;

  if (env.UPLOAD_DRIVER === 's3') {
    await getS3().send(
      new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: buf, ContentType: mime, CacheControl: 'public, max-age=31536000, immutable' }),
    );
    return `${env.S3_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
  }

  const full = path.resolve(env.UPLOAD_DIR, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf);
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/uploads/${key}`;
}
