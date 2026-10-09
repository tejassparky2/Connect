/**
 * Razorpay integration for ad-wallet top-ups (UPI / cards / netbanking).
 * Flow: create order (server) → Razorpay Checkout (client) → verify signature (server) → credit wallet.
 * Crediting is idempotent on the Razorpay payment id.
 */
import crypto from 'node:crypto';
import { env, isProd } from '../config/env';
import { badRequest, conflict } from '../lib/errors';
import { prisma } from '../lib/prisma';

export const paymentsMode = (): 'razorpay' | 'dev' | 'disabled' =>
  env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET ? 'razorpay' : isProd ? 'disabled' : 'dev';

export async function createRazorpayOrder(amountPaise: number, receipt: string, notes: Record<string, string> = {}): Promise<{ id: string; amount: number; currency: string }> {
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: receipt.slice(0, 40), notes }),
  });
  if (!res.ok) throw badRequest('Payment gateway error. Please retry.');
  return (await res.json()) as { id: string; amount: number; currency: string };
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  amount_paid: number;
  status: 'created' | 'attempted' | 'paid';
  notes: Record<string, string> | [];
}

/** Server-side source of truth for an order (amount + which business it belongs to). */
export async function fetchRazorpayOrder(orderId: string): Promise<RazorpayOrder> {
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw badRequest('Unknown payment order');
  return (await res.json()) as RazorpayOrder;
}

export const orderBusinessId = (o: Pick<RazorpayOrder, 'notes'>) => (Array.isArray(o.notes) ? undefined : o.notes.businessId);

/** Max wallet balance (₹10 lakh) — keeps int4 paise far from overflow and limits exposure. */
export const MAX_WALLET_PAISE = 10_00_000_00;

/** Razorpay signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string, secret = env.RAZORPAY_KEY_SECRET): boolean {
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Razorpay webhook signature = HMAC_SHA256(rawBody, webhook_secret). */
export function verifyWebhookSignature(rawBody: Buffer, signature: string, secret = env.RAZORPAY_WEBHOOK_SECRET): boolean {
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Credit a wallet exactly once per payment id (client callback and webhook may both arrive). */
export async function creditWallet(businessId: string, paymentId: string, amountPaise: number): Promise<{ balancePaise: number; duplicate: boolean }> {
  const reference = `pay:${paymentId}`;
  if (await prisma.walletTransaction.findUnique({ where: { reference } })) {
    const b = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { walletPaise: true } });
    return { balancePaise: b.walletPaise, duplicate: true };
  }
  try {
    await prisma.$transaction([
      prisma.walletTransaction.create({ data: { businessId, type: 'TOPUP', amountPaise, reference, note: 'Wallet top-up' } }),
      prisma.business.update({ where: { id: businessId }, data: { walletPaise: { increment: amountPaise } } }),
    ]);
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw conflict('Payment already credited');
    throw e;
  }
  const b = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { walletPaise: true } });
  return { balancePaise: b.walletPaise, duplicate: false };
}
