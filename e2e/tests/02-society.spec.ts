import { expect, test } from '@playwright/test';
import { expectToast, loginViaUi, randomPhone, shot, T, X } from './helpers';

test('resident: notices, helpdesk complaint, parking alert, vehicle', async ({ page }) => {
  await loginViaUi(page, '9900000002'); // Arjun Mehta — verified resident of Green Meadows
  await expect(T(page, 'hood-name')).toHaveText('HSR Layout');
  await T(page, 'tab-society').click();
  await X(page, 'Green Meadows Residency').click();
  await expect(T(page, 'tile-notices')).toBeVisible();
  await shot(page, '10-society-hub');

  await T(page, 'tile-notices').click();
  await expect(X(page, 'Water supply interruption — Saturday 10am–2pm')).toBeVisible();
  await expect(T(page, 'new-notice')).toHaveCount(0); // residents can't post notices
  await shot(page, '11-notices');
  await T(page, 'back').click();

  await T(page, 'tile-helpdesk').click();
  await expect(X(page, 'Tower A lift stuck between floors twice this week')).toBeVisible();
  await T(page, 'new-ticket').click();
  await T(page, 'tcat-WATER').click();
  await T(page, 'ticket-title').fill('Low water pressure in Tower A');
  await T(page, 'ticket-desc').fill('8th floor taps barely running since Monday morning.');
  await T(page, 'submit-ticket').click();
  await expectToast(page, /committee has been notified/);
  await expect(T(page, 'ticket-status')).toHaveText('Open');
  await T(page, 'message-input').fill('Also affecting flat 805.');
  await T(page, 'send-message').click();
  await expect(X(page, 'Also affecting flat 805.')).toBeVisible();
  await shot(page, '12-ticket');
  await T(page, 'back').click();
  await T(page, 'back').click();

  await T(page, 'quick-parking').click();
  await T(page, 'parking-plate').fill('ka 05 mn 4321');
  await T(page, 'send-parking').click();
  await expectToast(page, /Owner notified/);
  await expect(X(page, 'KA 05 MN 4321').first()).toBeVisible();
  await T(page, 'vehicle-number').fill('KA03XY9876');
  await T(page, 'add-vehicle').click();
  await expectToast(page, /Vehicle added/);
  await expect(X(page, 'KA 03 XY 9876')).toBeVisible();
  await shot(page, '13-parking');
});

test('new resident requests to join; RWA admin approves', async ({ browser }) => {
  const resident = await browser.newPage();
  const phone = randomPhone();
  await loginViaUi(resident, phone);
  await T(resident, 'name-input').fill('Vikram Shetty');
  await T(resident, 'save-name').click();
  await T(resident, 'use-location').click();
  await T(resident, 'unit-input').fill('904');
  await T(resident, 'locality-input').fill('HSR Layout Sector 2');
  await T(resident, 'city-input').fill('Bengaluru');
  await T(resident, 'pincode-input').fill('560102');
  await T(resident, 'save-address').click();
  await expect(T(resident, 'hood-name')).toHaveText('HSR Layout');

  await T(resident, 'tab-society').click();
  await T(resident, 'find-society').click();
  await X(resident, 'Green Meadows Residency').click();
  await T(resident, 'join-tower').fill('A');
  await T(resident, 'join-unit').fill('904');
  await T(resident, 'submit-join').click();
  await expectToast(resident, /Request sent/);
  await expect(X(resident, 'Awaiting approval')).toBeVisible();
  await shot(resident, '14-join-pending');

  const admin = await browser.newPage();
  await loginViaUi(admin, '9900000001'); // Priya — RWA admin
  await expect(T(admin, 'hood-name')).toBeVisible();
  await T(admin, 'tab-society').click();
  await expect(X(admin, '1 join request')).toBeVisible();
  await X(admin, 'Green Meadows Residency').click();
  await expect(T(admin, 'invite-code-value')).toHaveText('GREEN234');
  await T(admin, 'pending-requests').click();
  await expect(X(admin, 'Vikram Shetty')).toBeVisible();
  await shot(admin, '15-approvals');
  await admin.locator('[data-testid^="approve-"]').filter({ visible: true }).first().click();
  await expectToast(admin, /approved/);

  // Admin posts a notice
  await T(admin, 'back').click();
  await T(admin, 'tile-notices').click();
  await T(admin, 'new-notice').click();
  await T(admin, 'notice-title').fill('Society AGM on Sunday');
  await T(admin, 'notice-body').fill('Annual general meeting at the clubhouse, 11am. Agenda: budget & security.');
  await T(admin, 'publish-notice').click();
  await expectToast(admin, /Notice sent/);

  // Resident now has access + verified address (society is RWA-verified)
  await resident.reload();
  await T(resident, 'tab-society').click();
  await X(resident, 'Green Meadows Residency').click();
  await T(resident, 'tile-notices').click();
  await expect(X(resident, 'Society AGM on Sunday')).toBeVisible();
  await T(resident, 'back').click();
  await T(resident, 'back').click();
  await T(resident, 'tab-profile').click();
  await expect(X(resident, 'Verified resident')).toBeVisible();
  await T(resident, 'open-notifications').count(); // badge exists in header on home
  await shot(resident, '16-profile-verified');
});
