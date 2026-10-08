import { expect, test } from '@playwright/test';
import { loginViaUi, shot, T, X } from './helpers';

test('buyer chats with seller about a listing; seller sees unread and replies', async ({ browser }) => {
  const buyer = await browser.newPage();
  await loginViaUi(buyer, '9900000005'); // Fatima
  await expect(T(buyer, 'hood-name')).toBeVisible();
  const table = buyer.locator('[data-testid^="post-"]', { hasText: 'IKEA study table + chair' }).filter({ visible: true }).first();
  await table.locator('[data-testid^="message-"]').click();
  await T(buyer, 'send-message').click(); // prefilled "Is this still available?"
  await expect(X(buyer, 'Hi! Is this still available?')).toBeVisible();
  await expect(X(buyer, 'IKEA study table + chair')).toBeVisible();
  await shot(buyer, '30-chat-buyer');

  const seller = await browser.newPage();
  await loginViaUi(seller, '9900000007'); // Meera — the seller
  await expect(T(seller, 'hood-name')).toBeVisible();
  await T(seller, 'open-messages').click();
  await seller.locator('[data-testid^="conv-"]').filter({ visible: true }).first().click();
  await expect(X(seller, 'Hi! Is this still available?')).toBeVisible();
  await T(seller, 'message-input').fill('Yes! Come by after 6pm 🙂');
  await T(seller, 'send-message').click();
  await expect(X(buyer, 'Yes! Come by after 6pm 🙂')).toBeVisible({ timeout: 10_000 }); // polled
  await shot(buyer, '31-chat-reply');

  // Seller marks the listing sold from the post menu
  await T(seller, 'back').click();
  await T(seller, 'back').click();
  await T(seller, 'tab-profile').click();
  await T(seller, 'my-posts-row').click();
  const mine = seller.locator('[data-testid^="post-"]', { hasText: 'IKEA study table + chair' }).filter({ visible: true }).first();
  await mine.locator('[data-testid^="post-more-"]').click();
  await T(seller, 'sheet-Mark as sold').click();
  await expect(mine.getByText('SOLD')).toBeVisible();

  await T(seller, 'back').click();
  await T(seller, 'logout').click();
  await T(seller, 'confirm-ok').click();
  await expect(T(seller, 'get-started')).toBeVisible();
});
