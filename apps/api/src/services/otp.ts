/**
 * OTP providers. The mobile app always talks to OUR API (/auth/otp/*), and the
 * API delegates to a provider. This keeps the client provider-agnostic and lets
 * us enforce our own rate limits / abuse rules regardless of vendor.
 *
 *   dev      – code generated here, HMAC-hashed in otp_challenges, logged and
 *              echoed back to the client. Hard-disabled in production (env.ts).
 *   supabase – Supabase Auth phone OTP (Twilio / MessageBird / Textlocal, or a
 *              "Send SMS" hook to MSG91 for DLT-compliant Indian delivery).
 */
import crypto from 'node:crypto';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { badRequest, tooMany, unauthorized } from '../lib/errors';
import { logger } from '../lib/logger';

export interface OtpSendResult {
  /** Only populated by the dev provider. */
  devCode?: string;
}

export interface OtpVerifyResult {
  providerUserId?: string;
}

interface OtpProvider {
  send(phone: string, ip?: string): Promise<OtpSendResult>;
  verify(phone: string, code: string, ip?: string): Promise<OtpVerifyResult>;
}

const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000; // matches Supabase Auth's default SMS max frequency
const MAX_SENDS_PER_WINDOW = 5;
const WINDOW_MS = 60 * 60_000;

const hmac = (phone: string, code: string) => crypto.createHmac('sha256', env.OTP_SECRET).update(`${phone}:${code}`).digest('hex');

/** Per-phone throttling shared by all providers (vendors' limits are not enough to stop SMS-pumping fraud). */
async function assertCanSend(phone: string) {
  const since = new Date(Date.now() - WINDOW_MS);
  const recent = await prisma.otpChallenge.findMany({ where: { phone, createdAt: { gt: since } }, orderBy: { createdAt: 'desc' }, take: MAX_SENDS_PER_WINDOW });
  if (recent[0] && Date.now() - recent[0].createdAt.getTime() < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - recent[0].createdAt.getTime())) / 1000);
    throw tooMany(`Please wait ${wait}s before requesting another OTP`);
  }
  if (recent.length >= MAX_SENDS_PER_WINDOW) throw tooMany('Too many OTP requests. Try again in an hour.');
}

const devProvider: OtpProvider = {
  async send(phone, ip) {
    await assertCanSend(phone);
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await prisma.otpChallenge.create({
      data: { phone, codeHash: hmac(phone, code), expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000), ip },
    });
    logger.info({ code }, `[dev-otp] OTP for ${phone.slice(0, 5)}…`);
    return { devCode: code };
  },
  async verify(phone, code) {
    const challenge = await prisma.otpChallenge.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw unauthorized('OTP expired. Please request a new one.');
    // Claim an attempt atomically BEFORE comparing, so parallel guesses can't exceed the cap.
    const claimed = await prisma.otpChallenge.updateMany({ where: { id: challenge.id, attempts: { lt: MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
    if (claimed.count !== 1) throw tooMany('Too many wrong attempts. Request a new OTP.');
    const ok = crypto.timingSafeEqual(Buffer.from(challenge.codeHash), Buffer.from(hmac(phone, code)));
    if (!ok) {
      const left = Math.max(0, MAX_ATTEMPTS - challenge.attempts - 1);
      throw unauthorized(left ? `Incorrect OTP. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect OTP. Request a new one.');
    }
    // Atomic consume: a code can be used exactly once even under concurrent requests.
    const consumed = await prisma.otpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw unauthorized('OTP already used');
    return {};
  },
};

/**
 * Headers for server-to-Supabase calls. Supabase applies per-IP limits; since every call
 * comes from this server, forward the END-USER IP (Sb-Forwarded-For) — this requires a
 * secret API key and "IP address forwarding" enabled in the project. Without it, the
 * per-IP limits (30 req / 5 min) become an app-wide cap.
 */
function supabaseHeaders(ip?: string): Record<string, string> {
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_ANON_KEY;
  return { apikey: key, 'Content-Type': 'application/json', ...(ip && env.SUPABASE_SECRET_KEY ? { 'Sb-Forwarded-For': ip } : {}) };
}

const supabaseProvider: OtpProvider = {
  async send(phone, ip) {
    await assertCanSend(phone);
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/otp`, {
      method: 'POST',
      headers: supabaseHeaders(ip),
      body: JSON.stringify({ phone, create_user: true, channel: 'sms' }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, body: await res.text().catch(() => '') }, 'Supabase OTP send failed');
      if (res.status === 429) throw tooMany('Too many OTP requests. Please wait and retry.');
      throw badRequest('Could not send OTP. Please try again.');
    }
    // Record the send for our own throttling; code is held by Supabase.
    await prisma.otpChallenge.create({ data: { phone, codeHash: 'supabase', expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000), ip } });
    return {};
  },
  async verify(phone, code, ip) {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/verify`, {
      method: 'POST',
      headers: supabaseHeaders(ip),
      body: JSON.stringify({ type: 'sms', phone, token: code }),
    });
    // GoTrue: 403 otp_expired for wrong/expired codes; 429 over_request_rate_limit.
    if (res.status === 429) throw tooMany('Too many attempts. Please wait a few minutes and try again.');
    if (!res.ok) throw unauthorized('Incorrect or expired OTP');
    const body = (await res.json()) as { user?: { id?: string; phone?: string } };
    const supaPhone = body.user?.phone ? `+${String(body.user.phone).replace(/^\+/, '')}` : undefined;
    if (!body.user?.id || (supaPhone && supaPhone !== phone)) throw unauthorized('OTP verification mismatch');
    return { providerUserId: body.user.id };
  },
};

export const otpProvider: OtpProvider = env.OTP_PROVIDER === 'supabase' ? supabaseProvider : devProvider;
