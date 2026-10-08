/**
 * Razorpay integration for ad-wallet top-ups (UPI / cards / netbanking).
 * Flow: create order (server) → Razorpay Checkout (client) → verify signature (server) → credit wallet.
 * Crediting is idempotent on the Razorpay payment id.
 */
import crypto from 'node:crypto';
import { env, isProd } from '../config/env';
import { badRequest } from '../lib/errors';

export const paymentsMode = (): 'razorpay' | 'dev' | 'disabled' =>
  env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET ? 'razorpay' : isProd ? 'disabled' : 'dev';

export async function createRazorpayOrder(amountPaise: number, receipt: string): Promise<{ id: string; amount: number; currency: string }> {
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: receipt.slice(0, 40) }),
  });
  if (!res.ok) throw badRequest('Payment gateway error. Please retry.');
  return (await res.json()) as { id: string; amount: number; currency: string };
}

export async function fetchRazorpayOrderAmount(orderId: string): Promise<number> {
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw badRequest('Unknown payment order');
  const body = (await res.json()) as { amount_paid: number; status: string };
  if (body.status !== 'paid') throw badRequest('Payment not completed');
  return body.amount_paid;
}

/** Razorpay signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string, secret = env.RAZORPAY_KEY_SECRET): boolean {
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
