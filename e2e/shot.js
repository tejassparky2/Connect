const { chromium } = require('@playwright/test');
(async () => {
  const exe = process.env.CHROME || '/opt/pw-browsers/chromium';
  const browser = await chromium.launch({ executablePath: require('fs').statSync(exe).isDirectory() ? undefined : exe });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
  await page.goto(process.argv[2] || 'http://localhost:8081/');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: process.argv[3] || 'shot.png' });
  console.log('url', page.url());
  await browser.close();
})();
