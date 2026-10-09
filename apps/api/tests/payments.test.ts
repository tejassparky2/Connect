import crypto from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signPaySession } from '../src/modules/payments.routes';
import { app, locationVerified, prisma, resetDb } from './helpers';

beforeEach(resetDb);

async function business() {
  const owner = await locationVerified('Owner');
  const b = await owner.post('/v1/businesses', { name: 'Test Cafe', category: 'CAFE', phone: '9900000003', addressLine: '14th Main HSR', pincode: '560102', lat: 12.912, lng: 77.648 });
  return { owner, bizId: b.body.id as string };
}

const sign = (body: string) => crypto.createHmac('sha256', 'whsec_test_secret').update(body).digest('hex');

describe('Razorpay webhook', () => {
  it('credits the wallet once on order.paid (businessId from the ORDER notes)', async () => {
    const { bizId } = await business();
    const body = JSON.stringify({
      event: 'order.paid',
      payload: { payment: { entity: { id: 'pay_WH1', amount: 75000, order_id: 'order_1', notes: [] } }, order: { entity: { id: 'order_1', amount_paid: 75000, notes: { businessId: bizId } } } },
    });
    const send = () => request(app).post('/pay/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', sign(body)).send(body);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200); // retried delivery
    const biz = await prisma.business.findUniqueOrThrow({ where: { id: bizId } });
    expect(biz.walletPaise).toBe(75000);
    expect(await prisma.walletTransaction.count({ where: { businessId: bizId } })).toBe(1);
  });

  it('payment.captured (no order notes in payload) looks the order up and credits', async () => {
    const { bizId } = await business();
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input) === 'https://api.razorpay.com/v1/orders/order_2')
        return new Response(JSON.stringify({ id: 'order_2', amount: 50000, amount_paid: 50000, status: 'paid', notes: { businessId: bizId } }), { status: 200 });
      return realFetch(input, init);
    });
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_WH2', amount: 50000, order_id: 'order_2', notes: [] } } } });
    const r = await request(app).post('/pay/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', sign(body)).send(body);
    spy.mockRestore();
    expect(r.status).toBe(200);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: bizId } })).walletPaise).toBe(50000);
  });

  it('rejects bad signatures', async () => {
    const { bizId } = await business();
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_X', amount: 999999, notes: { businessId: bizId } } } } });
    const r = await request(app).post('/pay/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', 'deadbeef').send(body);
    expect(r.status).toBe(401);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: bizId } })).walletPaise).toBe(0);
  });
});

describe('hosted checkout', () => {
  it('serves a nonce-CSP checkout page for a valid session and rejects forged ones', async () => {
    const { owner, bizId } = await business();
    const s = signPaySession({ b: bizId, u: owner.id, o: 'order_ABC', a: 50000 });
    const page = await request(app).get(`/pay/checkout?s=${s}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('order_ABC');
    expect(page.text).toContain('Add ₹500');
    expect(page.headers['content-security-policy']).toMatch(/script-src 'nonce-/);
    expect((await request(app).get('/pay/checkout?s=forged.token.here')).status).toBe(403);

    const mismatch = await request(app).post('/pay/complete').send({ s, orderId: 'order_OTHER', paymentId: 'pay_1', signature: 'x' });
    expect(mismatch.status).toBe(403);
    const badSig = await request(app).post('/pay/complete').send({ s, orderId: 'order_ABC', paymentId: 'pay_1', signature: 'nope' });
    expect(badSig.status).toBe(403);
  });
});
