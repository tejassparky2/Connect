import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';

const chrome = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:8100',
    ...devices['Pixel 7'],
    // HSR Layout, Bengaluru — inside the seeded neighbourhood, ~260 m from Green Meadows.
    geolocation: { latitude: 12.9126, longitude: 77.6466, accuracy: 15 },
    permissions: ['geolocation'],
    launchOptions: fs.existsSync(chrome) ? { executablePath: chrome } : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
