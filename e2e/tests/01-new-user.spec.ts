import { expect, test } from '@playwright/test';
import { expectToast, loginViaUi, randomPhone, shot, T, X } from './helpers';

test('new resident: OTP → profile → home pin → feed → verify → post → like → comment', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(T(page, 'get-started')).toBeVisible();
  await shot(page, '01-welcome');

  await loginViaUi(page, randomPhone());
  await expect(T(page, 'name-input')).toBeVisible();
  await shot(page, '02-profile-setup');
  await T(page, 'name-input').fill('Ananya Iyer');
  await T(page, 'save-name').click();

  // Home pin via (mocked) device GPS + flat details
  await T(page, 'use-location').click();
  await expect(X(page, 'Home pin set')).toBeVisible();
  await T(page, 'unit-input').fill('C-702');
  await T(page, 'building-input').fill('Tower C');
  await T(page, 'locality-input').fill('HSR Layout Sector 2');
  await T(page, 'city-input').fill('Bengaluru');
  await T(page, 'pincode-input').fill('560102');
  await shot(page, '03-address');
  await T(page, 'save-address').click();

  // Lands on the geo-fenced feed for HSR Layout with seeded content
  await expect(T(page, 'hood-name')).toHaveText('HSR Layout');
  await expect(X(page, 'Decathlon cycle (Btwin Rockrider ST100)')).toBeVisible();
  await expect(X(page, 'Chain snatching near 19th Main bus stop').first()).toBeVisible();
  await expect(X(page, 'Sponsored · Local')).toBeVisible();
  await expect(T(page, 'verify-banner')).toBeVisible();
  await shot(page, '04-feed');

  // Filters
  await T(page, 'filter-CLASSIFIED').click();
  await expect(X(page, 'IKEA study table + chair')).toBeVisible();
  await expect(X(page, 'Badminton partners wanted 🏸')).toHaveCount(0);
  await shot(page, '05-feed-marketplace');
  await T(page, 'filter-ALL').click();

  // PHONE-level users can't post yet
  await T(page, 'tab-create').click();
  await expect(X(page, 'Verify your location to post')).toBeVisible();
  await X(page, 'Verify now').click();

  // Two GPS checks → LOCATION
  await expect(T(page, 'gps-check')).toBeVisible();
  await T(page, 'gps-check').click();
  await expectToast(page, /Check 1\/2 passed/);
  await T(page, 'gps-check').click();
  await expectToast(page, /Location verified/);
  await shot(page, '06-verified');
  await T(page, 'back').click();

  // Create a marketplace listing
  await T(page, 'tab-create').click();
  await T(page, 'type-CLASSIFIED').click();
  await T(page, 'post-title').fill('Kids bicycle (Hero 16")');
  await T(page, 'post-price').fill('2,500');
  await T(page, 'post-body').fill('Outgrown by my son, barely used. Pickup from Sector 2.');
  await shot(page, '07-composer');
  await T(page, 'submit-post').click();
  await expectToast(page, /Posted/);
  const card = page.locator('[data-testid^="post-"]', { hasText: 'Kids bicycle (Hero 16")' }).filter({ visible: true }).first();
  await expect(card).toBeVisible();
  await expect(card).toContainText('₹2,500');

  // Like + comment on a neighbour's post
  const cycle = page.locator('[data-testid^="post-"]', { hasText: 'Decathlon cycle' }).filter({ visible: true }).first();
  const likeBtn = cycle.locator('[data-testid^="like-"]');
  await expect(likeBtn).toContainText('2');
  await likeBtn.click();
  await expect(likeBtn).toContainText('3');
  await cycle.getByText('Decathlon cycle (Btwin Rockrider ST100)').click();
  await expect(X(page, 'Is the price negotiable?')).toBeVisible();
  await T(page, 'comment-input').fill('Would love to check it out this weekend!');
  await T(page, 'send-comment').click();
  await expect(X(page, 'Would love to check it out this weekend!')).toBeVisible();
  await shot(page, '08-post-detail');

  expect(errors).toEqual([]);
});
