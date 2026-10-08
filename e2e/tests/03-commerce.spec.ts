import { expect, test } from '@playwright/test';
import { expectToast, loginViaUi, shot, T, X } from './helpers';

test('café owner: wallet top-up → launch ad; neighbour sees it', async ({ page, browser }) => {
  await loginViaUi(page, '9900000003'); // Kavya — owns Filter Kaapi House
  await expect(T(page, 'hood-name')).toBeVisible();
  await T(page, 'tab-profile').click();
  await page.locator('[data-testid^="my-biz-"]').filter({ visible: true }).first().click();
  await expect(T(page, 'wallet-balance')).toHaveText('₹1,500');
  await T(page, 'topup-100000').click();
  await T(page, 'add-money').click();
  await expectToast(page, /₹1,000 added/);
  await expect(T(page, 'wallet-balance')).toHaveText('₹2,500');

  await X(page, '+ New ad').click();
  await T(page, 'ad-headline').fill('Weekend dosa festival 🥞');
  await T(page, 'ad-body').fill('12 kinds of dosa, Sat & Sun only. Show the app for free filter coffee!');
  await T(page, 'radius-2000').click();
  await expect(T(page, 'ad-reach')).toContainText('verified households');
  await T(page, 'budget-50000').click();
  await shot(page, '20-ad-builder');
  await T(page, 'launch-ad').click();
  await expectToast(page, /live/);
  await expect(X(page, 'Weekend dosa festival 🥞')).toBeVisible();
  await expect(T(page, 'wallet-balance')).toHaveText('₹2,000');
  await T(page, 'offer-title').fill('Free cookie with every coffee');
  await T(page, 'offer-body').fill('This week only for Mohalla Connect users');
  await T(page, 'post-offer').click();
  await expectToast(page, /Offer published/);
  await shot(page, '21-business-dashboard');
});

test('neighbour: browse local, review a shop, check a worker, add a worker', async ({ page }) => {
  await loginViaUi(page, '9900000004'); // Rohan — location verified
  await expect(T(page, 'hood-name')).toBeVisible();
  await T(page, 'tab-local').click();
  await expect(X(page, 'Deals near you')).toBeVisible();
  await expect(X(page, 'Filter Kaapi House').first()).toBeVisible();
  await shot(page, '22-local');
  await T(page, 'cat-SALON').click();
  await expect(X(page, 'Glow Unisex Salon')).toBeVisible();
  await expect(X(page, 'Sri Lakshmi Provision Stores')).toHaveCount(0);
  await X(page, 'Glow Unisex Salon').click();
  await T(page, 'star-5').click();
  await T(page, 'review-text').fill('Great haircut, very hygienic.');
  await T(page, 'submit-review').click();
  await expectToast(page, /Thanks for your review/);
  await expect(X(page, 'Great haircut, very hygienic.')).toBeVisible();
  await shot(page, '23-business');
  await T(page, 'back').click();

  await T(page, 'seg-services').click();
  await expect(X(page, 'Ramesh Kumar')).toBeVisible();
  await T(page, 'local-search').fill('laksh');
  await expect(X(page, 'Lakshmamma')).toBeVisible();
  await expect(X(page, 'Ramesh Kumar')).toHaveCount(0);
  await X(page, 'Lakshmamma').click();
  await expect(X(page, 'ID / police verified')).toBeVisible();
  await shot(page, '24-worker');
  await T(page, 'back').click();
  await T(page, 'local-search').fill('');

  await T(page, 'add-listing').click();
  await T(page, 'prov-name').fill('Sunita Devi');
  await T(page, 'prov-phone').fill('98450 77777');
  await T(page, 'skill-COOK').click();
  await T(page, 'skill-NANNY').click();
  await T(page, 'prov-consent').click();
  await T(page, 'submit-provider').click();
  await expectToast(page, /Sunita Devi added/);
  await expect(X(page, '1 vouches').or(X(page, 'vouches')).first()).toBeVisible();
});
