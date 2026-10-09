import { expect, test } from '@playwright/test';
import { expectToast, loginViaUi, randomPhone, shot, T, X } from './helpers';

test('privacy notice is readable before sign-up', async ({ page }) => {
  await page.goto('/');
  await T(page, 'get-started').click();
  await X(page, 'privacy notice').click();
  await expect(X(page, 'What neighbours can see')).toBeVisible();
  await expect(X(page, /Never your phone number/)).toBeVisible();
  await shot(page, '40-privacy');
});

test('alerts require the anti-profiling confirmation; own post deletes via sheet → confirm', async ({ page }) => {
  await loginViaUi(page, '9900000006'); // Sanjay — location verified, unused by other specs (per-phone OTP cooldown)
  await expect(T(page, 'hood-name')).toBeVisible();
  await T(page, 'tab-create').click();
  await T(page, 'type-ALERT').click();
  await T(page, 'sev-WARNING').click();
  await T(page, 'post-title').fill('Water main burst on 22nd Cross');
  await T(page, 'post-body').fill('Road flooded near the temple, avoid two-wheelers till BWSSB fixes it.');
  await T(page, 'submit-post').click();
  await expectToast(page, /describes what happened/);
  await T(page, 'fair-alert').click();
  await shot(page, '41-alert-composer');
  await T(page, 'submit-post').click();
  await expectToast(page, /Alert sent to neighbours/);
  await expect(X(page, 'Water main burst on 22nd Cross')).toBeVisible(); // pinned on top

  // Delete it: ⋯ → sheet → confirm dialog (in-window overlays, no stacked native modals)
  await T(page, 'tab-profile').click();
  await T(page, 'my-posts-row').click();
  const mine = page.locator('[data-testid^="post-"]', { hasText: 'Water main burst' }).filter({ visible: true }).first();
  await mine.locator('[data-testid^="post-more-"]').click();
  await T(page, 'sheet-Delete post').click();
  await expect(X(page, 'Delete this post?')).toBeVisible();
  await T(page, 'confirm-ok').click();
  await expectToast(page, /Post deleted/);
  await expect(page.locator('[data-testid^="post-"]', { hasText: 'Water main burst' }).filter({ visible: true })).toHaveCount(0);
});

test('error toasts stay visible over an open bottom sheet', async ({ page, context }) => {
  // A resident far from Green Meadows tries to join it: the 403 must be visible while the sheet is open.
  await context.setGeolocation({ latitude: 12.9116 + 0.012, longitude: 77.6474 }); // ~1.3 km north
  await loginViaUi(page, randomPhone());
  await T(page, 'name-input').fill('Far Resident');
  await T(page, 'save-name').click();
  await T(page, 'use-location').click();
  await T(page, 'unit-input').fill('12');
  await T(page, 'locality-input').fill('HSR Layout Sector 1');
  await T(page, 'city-input').fill('Bengaluru');
  await T(page, 'pincode-input').fill('560102');
  await T(page, 'save-address').click();
  await expect(T(page, 'hood-name')).toBeVisible();
  await T(page, 'tab-society').click();
  await T(page, 'find-society').click();
  await X(page, 'Green Meadows Residency').click();
  await T(page, 'join-unit').fill('404');
  await T(page, 'submit-join').click();
  await expectToast(page, /Only residents can join/);
  await expect(T(page, 'submit-join')).toBeVisible(); // sheet still open underneath
  await shot(page, '42-toast-over-sheet');
});
