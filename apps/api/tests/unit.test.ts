import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { maskPhone, normalizeIndianPhone } from '../src/lib/phone';
import { normalizeVehicleNumber } from '../src/lib/vehicle';
import { bucketDistance, clampRadius, isInIndia } from '../src/lib/geo';
import { countSpacedChecks } from '../src/services/verification';
import { verifyRazorpaySignature } from '../src/services/payments';
import { sniffImageMime } from '../src/services/storage';
import { decodeCursor, encodeCursor, openCursor, sealCursor } from '../src/lib/pagination';
import { needsReview } from '../src/services/moderation';
import { generateInviteCode } from '../src/modules/societies.routes';

describe('phone normalisation (India)', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
  ])('%s → %s', (input, out) => expect(normalizeIndianPhone(input)).toBe(out));

  it.each(['12345', '5876543210', '+1 415 555 0100', 'abcdefghij', '98765432101'])('rejects %s', (input) => {
    expect(normalizeIndianPhone(input)).toBeNull();
  });

  it('masks numbers for display', () => expect(maskPhone('+919876543210')).toBe('+91 98XXX XX210'));
});

describe('vehicle number normalisation', () => {
  it.each([
    ['ka-01 ab 1234', 'KA01AB1234'],
    ['MH12DE1433', 'MH12DE1433'],
    ['dl 3c ab 0001', 'DL3CAB0001'],
    ['22 BH 1234 AA', '22BH1234AA'],
  ])('%s → %s', (i, o) => expect(normalizeVehicleNumber(i)).toBe(o));
  it.each(['1234', 'HELLO WORLD', 'KA01AB12345'])('rejects %s', (i) => expect(normalizeVehicleNumber(i)).toBeNull());
});

describe('geo utils', () => {
  it('buckets distances up to the next 100 m (min 100)', () => {
    expect(bucketDistance(0)).toBe(100);
    expect(bucketDistance(101)).toBe(200);
    expect(bucketDistance(1999.9)).toBe(2000);
  });
  it('clamps radii', () => {
    expect(clampRadius(undefined, 2000, 5000, 3000)).toBe(3000);
    expect(clampRadius(100, 2000, 5000, 3000)).toBe(2000);
    expect(clampRadius(99999, 2000, 5000, 3000)).toBe(5000);
  });
  it('knows India’s bounding box (and catches swapped lat/lng)', () => {
    expect(isInIndia({ lat: 12.97, lng: 77.59 })).toBe(true);
    expect(isInIndia({ lat: 77.59, lng: 12.97 })).toBe(false);
    expect(isInIndia({ lat: 51.5, lng: -0.12 })).toBe(false);
  });
});

describe('GPS check spacing', () => {
  const h = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 3600_000);
  it('counts only checks at least gap hours apart', () => {
    expect(countSpacedChecks([h(0), h(1), h(2)], 6)).toBe(1);
    expect(countSpacedChecks([h(0), h(7)], 6)).toBe(2);
    expect(countSpacedChecks([h(7), h(0), h(3), h(13)], 6)).toBe(3);
    expect(countSpacedChecks([], 6)).toBe(0);
  });
});

describe('Razorpay signature', () => {
  it('accepts a valid signature and rejects tampering', () => {
    const secret = 'rzp_secret';
    const sig = crypto.createHmac('sha256', secret).update('order_1|pay_1').digest('hex');
    expect(verifyRazorpaySignature('order_1', 'pay_1', sig, secret)).toBe(true);
    expect(verifyRazorpaySignature('order_1', 'pay_2', sig, secret)).toBe(false);
    expect(verifyRazorpaySignature('order_1', 'pay_1', 'short', secret)).toBe(false);
  });
});

describe('image sniffing', () => {
  it('detects real image magic bytes, not extensions', () => {
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg');
    expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe('image/png');
    expect(sniffImageMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('image/webp');
    expect(sniffImageMime(Buffer.from('<?php echo 1; ?>....'))).toBeNull();
  });
});

describe('cursors', () => {
  it('round-trips plain cursors', () => {
    expect(decodeCursor(encodeCursor({ a: 1 }))).toEqual({ a: 1 });
    expect(() => decodeCursor('%%%')).toThrow();
  });
  it('sealed cursors hide their contents and reject tampering', () => {
    const c = sealCursor({ d: 201.6, id: 'x' });
    expect(Buffer.from(c, 'base64url').toString('utf8')).not.toContain('201.6');
    expect(openCursor(c)).toEqual({ d: 201.6, id: 'x' });
    const tampered = c.slice(0, -2) + (c.endsWith('A') ? 'BB' : 'AA');
    expect(() => openCursor(tampered)).toThrow();
  });
});

describe('moderation & invite codes', () => {
  it('flags common scam phrasing', () => {
    expect(needsReview('Please share OTP to receive refund')).toBe(true);
    expect(needsReview('Selling a cycle, ₹6,500')).toBe(false);
  });
  it('generates unambiguous 8-char invite codes', () => {
    for (let i = 0; i < 50; i++) expect(generateInviteCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });
});
