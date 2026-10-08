import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDistance, formatRupees, humanize, initials, normalizePhone, rupeesToPaise, timeAgo } from './format.ts';

test('formatRupees uses Indian grouping', () => {
  assert.equal(formatRupees(650000), '₹6,500');
  assert.equal(formatRupees(1234567890), '₹1,23,45,678.90');
  assert.equal(formatRupees(9900), '₹99');
  assert.equal(formatRupees(5), '₹0.05');
  assert.equal(formatRupees(null), '');
});

test('rupeesToPaise parses user input', () => {
  assert.equal(rupeesToPaise('6,500'), 650000);
  assert.equal(rupeesToPaise('₹99.5'), 9950);
  assert.equal(rupeesToPaise('abc'), null);
  assert.equal(rupeesToPaise('1.234'), null);
});

test('formatDistance', () => {
  assert.equal(formatDistance(100), '100 m');
  assert.equal(formatDistance(1400), '1.4 km');
  assert.equal(formatDistance(12000), '12 km');
});

test('timeAgo', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  assert.equal(timeAgo('2026-10-08T11:59:30Z', now), 'just now');
  assert.equal(timeAgo('2026-10-08T11:15:00Z', now), '45m');
  assert.equal(timeAgo('2026-10-08T07:00:00Z', now), '5h');
  assert.equal(timeAgo('2026-10-06T12:00:00Z', now), '2d');
});

test('phone + text helpers', () => {
  assert.equal(normalizePhone('98765 43210'), '+919876543210');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(initials('Priya Sharma'), 'PS');
  assert.equal(initials('Lakshmamma'), 'L');
  assert.equal(humanize('LOST_FOUND'), 'Lost found');
});
