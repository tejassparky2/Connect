import { expect, type Page } from '@playwright/test';

export const API = process.env.API_URL ?? 'http://localhost:4100';
export const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${name}.png` });

/** Logs in through the real UI using the dev OTP shown on screen. */
export async function loginViaUi(page: Page, phone: string) {
  await page.goto('/');
  await page.getByTestId('get-started').filter({ visible: true }).click();
  await page.getByTestId('phone-input').fill(phone);
  await page.getByTestId('send-otp').click();
  const code = (await page.getByTestId('dev-code').textContent())!.trim();
  await page.getByTestId('otp-input').fill(code);
}

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.getByTestId('toast').first()).toContainText(text);
}

export const randomPhone = () => `9${Math.floor(600000000 + Math.random() * 399999999)}`;

/**
 * Visible-only selectors. On web, the stack navigator keeps previous screens
 * mounted (hidden), so the same testID/text can exist several times in the DOM.
 */
export const T = (page: Page, id: string) => page.getByTestId(id).filter({ visible: true }).first();
export const X = (page: Page, text: string | RegExp) => page.getByText(text).filter({ visible: true }).first();
