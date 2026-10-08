/**
 * Hosted Razorpay Checkout for native apps + Razorpay webhook.
 *
 *   App → POST /v1/businesses/:id/wallet/orders → { checkoutUrl }
 *   App opens checkoutUrl in an auth browser session (expo-web-browser)
 *   Page runs Razorpay Checkout (UPI / cards / netbanking) → POST /pay/complete
 *   Server verifies signature + order amount → credits wallet → redirects to mohalla://wallet
 *   Webhook (payment.captured) credits as a fallback if the user closes the page early.
 * Crediting is idempotent on the Razorpay payment id, so callback + webhook never double-credit.
 */
import crypto from 'node:crypto';
import express, { Router } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { badRequest, forbidden } from '../lib/errors';
import { logger } from '../lib/logger';
import { creditWallet, fetchRazorpayOrderAmount, verifyRazorpaySignature, verifyWebhookSignature } from '../services/payments';

export const paymentsRouter = Router();

interface PaySession {
  b: string; // business id
  u: string; // user id
  o: string; // razorpay order id
  a: number; // amount paise
}

export function signPaySession(s: PaySession): string {
  return jwt.sign(s, env.JWT_ACCESS_SECRET, { expiresIn: '30m', audience: 'pay', issuer: 'mohalla-connect', algorithm: 'HS256' });
}

function openPaySession(token: unknown): PaySession {
  if (typeof token !== 'string') throw badRequest('Missing payment session');
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { audience: 'pay', issuer: 'mohalla-connect', algorithms: ['HS256'] }) as unknown as PaySession;
  } catch {
    throw forbidden('Payment session expired. Please start again from the app.');
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

paymentsRouter.get('/checkout', (req, res) => {
  const session = openPaySession(req.query.s);
  const nonce = crypto.randomBytes(16).toString('base64');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'nonce-${nonce}' https://checkout.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; connect-src 'self' https://*.razorpay.com; img-src 'self' data: https:; style-src 'unsafe-inline'`,
  );
  const rupees = (session.a / 100).toLocaleString('en-IN');
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Add ₹${esc(rupees)} · Mohalla Connect</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#F8FAFC;color:#0B1220;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#fff;border-radius:24px;padding:28px;max-width:360px;width:90%;text-align:center;box-shadow:0 8px 24px rgba(11,18,32,.08)}
button{background:#0F766E;color:#fff;border:0;border-radius:16px;padding:14px 20px;font-size:16px;font-weight:600;width:100%;margin-top:16px}
#msg{margin-top:12px;color:#475569;font-size:14px}</style></head>
<body><div class="card"><div style="font-size:40px">🏘️</div><h2 style="margin:8px 0">Add ₹${esc(rupees)} to ad wallet</h2>
<p style="color:#64748B;margin:0">Secure payment by Razorpay · UPI, cards & netbanking</p>
<button id="pay">Pay ₹${esc(rupees)}</button><div id="msg"></div></div>
<script nonce="${nonce}" src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script nonce="${nonce}">
var S=${JSON.stringify(String(req.query.s))};
function done(ok,text){document.getElementById('msg').textContent=text;if(ok){setTimeout(function(){location.href='mohalla://wallet?status=success'},800)}}
var rzp=new Razorpay({key:${JSON.stringify(env.RAZORPAY_KEY_ID)},order_id:${JSON.stringify(session.o)},amount:${session.a},currency:'INR',name:'Mohalla Connect',description:'Ad wallet top-up',theme:{color:'#0F766E'},
handler:function(r){done(false,'Verifying payment…');fetch('/pay/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({s:S,paymentId:r.razorpay_payment_id,orderId:r.razorpay_order_id,signature:r.razorpay_signature})})
.then(function(x){return x.json()}).then(function(j){j.ok?done(true,'Payment successful! Returning to the app…'):done(false,(j.error&&j.error.message)||'Verification failed')}).catch(function(){done(false,'Network error. If money was deducted it will be credited automatically.')})},
modal:{ondismiss:function(){done(false,'Payment cancelled.')}}});
document.getElementById('pay').onclick=function(){rzp.open()};rzp.open();
</script></body></html>`);
});

paymentsRouter.post('/complete', express.json(), async (req, res) => {
  const session = openPaySession(req.body?.s);
  const { paymentId, orderId, signature } = req.body ?? {};
  if (orderId !== session.o) throw forbidden('Order mismatch');
  if (!verifyRazorpaySignature(String(orderId), String(paymentId), String(signature))) throw forbidden('Payment signature mismatch');
  const paid = await fetchRazorpayOrderAmount(session.o);
  const r = await creditWallet(session.b, String(paymentId), paid);
  res.json({ ok: true, balancePaise: r.balancePaise });
});

/** Razorpay → us. Must be mounted BEFORE express.json() so we can HMAC the raw body. */
export const razorpayWebhook = [
  express.raw({ type: 'application/json', limit: '100kb' }),
  async (req: express.Request, res: express.Response) => {
    const sig = req.get('x-razorpay-signature') ?? '';
    if (!Buffer.isBuffer(req.body) || !verifyWebhookSignature(req.body, sig)) return res.status(401).json({ ok: false });
    const evt = JSON.parse(req.body.toString('utf8')) as {
      event: string;
      payload?: { payment?: { entity?: { id: string; amount: number; notes?: { businessId?: string } } } };
    };
    const p = evt.payload?.payment?.entity;
    if (evt.event === 'payment.captured' && p?.notes?.businessId) {
      try {
        await creditWallet(p.notes.businessId, p.id, p.amount);
      } catch (err) {
        logger.error({ err }, 'Webhook credit failed');
        return res.status(500).json({ ok: false }); // Razorpay retries
      }
    }
    res.json({ ok: true });
  },
];
