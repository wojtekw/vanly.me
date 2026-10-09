import { chromium } from '/Users/wojtek/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:3100/', { waitUntil: 'networkidle' });
await page.screenshot({ path: '.local/qa/home-desktop.png', fullPage: true });
console.log(
  JSON.stringify({
    title: await page.title(),
    h1: await page.locator('h1').allTextContents(),
    cards: await page.locator('.vehicle-card').count(),
    overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    errors,
  }),
);
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: '.local/qa/home-mobile.png', fullPage: true });
await page.goto('http://127.0.0.1:3100/pojazd/coast', { waitUntil: 'networkidle' });
await page.screenshot({ path: '.local/qa/offer-mobile.png', fullPage: true });
console.log(
  JSON.stringify({
    h1: await page.locator('h1').allTextContents(),
    reserve: await page.getByRole('button', { name: 'Przejdź do rezerwacji' }).isEnabled(),
    overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    errors,
  }),
);
await browser.close();
