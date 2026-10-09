import { chromium } from '/Users/wojtek/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import pg from 'pg';
import dotenv from 'dotenv';
import assert from 'node:assert/strict';
dotenv.config({ path: '.env.local', quiet: true });
const database = process.env.TEST_DATABASE_URL;
if (new URL(database).pathname !== '/vanly_test') throw Error('Isolated test DB required.');
// Exercise the LAN HTTP origin, where randomUUID is unavailable, by default.
const base = process.env.VANLY_BROWSER_ORIGIN || 'http://vanly.local';
const env = {
  ...process.env,
  DATABASE_URL: database,
  API_PORT: '4101',
  UPLOAD_DIR:process.cwd()+'/.local/test-uploads',
  APP_ORIGIN: base,
};
const db = new pg.Pool({ connectionString: database });
await db.query('TRUNCATE companies,users,articles,camps RESTART IDENTITY CASCADE');
execFileSync(process.execPath, ['scripts/seed.mjs'], { env, stdio: 'pipe' });
const server = spawn(process.execPath, ['apps/api/dist/main.js'], { env, stdio: 'ignore' }),
  worker = spawn(process.execPath, ['scripts/worker.mjs'], { env, stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch('http://127.0.0.1:4101/api/v1/health')).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 100));
}
const accounts = JSON.parse(await fs.readFile('.local/accounts.json', 'utf8')),
  browser = await chromium.launch({ headless: true });
const errors = [];
const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
async function context(email) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await c.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const response = await route.fetch({
      url: 'http://127.0.0.1:4101' + url.pathname + url.search,
      postData:request.postDataBuffer()||undefined,
    });
    await route.fulfill({ response });
  });
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '/logowanie');
  if (base === 'http://vanly.local') {
    assert.deepEqual(
      await p.evaluate(() => ({
        secure: window.isSecureContext,
        randomUUID: typeof crypto.randomUUID,
        getRandomValues: typeof crypto.getRandomValues,
      })),
      { secure: false, randomUUID: 'undefined', getRandomValues: 'function' },
    );
  }
  const account = accounts.find((a) => a.email === email);
  await p.getByLabel('Adres e-mail', { exact: true }).fill(account.email);
  await p.getByLabel(/^Hasło/).fill(account.password);
  await p.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await p.waitForURL(/\/(konto|company|operator)$/);
  return { context: c, page: p };
}
async function noOverflow(p, label) {
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    'Overflow: ' + label,
  );
}
try {
  const { page: p } = await context('podroznik@vanly.local');
  await p.goto(base + '/');
  await p.getByLabel('Miejsce odbioru', { exact: true }).fill('Gdynia');
  await p.getByLabel('Data odbioru', { exact: true }).fill(day(20));
  await p.getByLabel('Data zwrotu', { exact: true }).fill(day(27));
  await p.getByRole('button', { name: 'Szukaj', exact: true }).click();
  await p.waitForURL(/\/pojazdy\?/);
  await p.locator('.vehicle-card').first().waitFor();
  assert.equal(await p.locator('.vehicle-card').count(), 2);
  await noOverflow(p, 'results desktop');
  console.log('OK: search and city filtering');
  await p.goto(base + '/pojazd/weekend?start=' + day(14) + '&end=' + day(35) + '&guests=2');
  await p.getByRole('button', { name: 'Przejdź do rezerwacji' }).click();
  await p.waitForURL(/\/rezerwacja\//);
  await p.getByRole('heading', { name: 'Jeszcze kilka ustaleń i ruszamy.' }).waitFor();
  await p.getByRole('button', { name: 'Potwierdź płatność testową' }).waitFor();
  await p.screenshot({ path: '.local/qa/weekend-checkout.png', fullPage: true });
  console.log('OK: Weekend checkout opens on ' + base);
  await p.goto(base + '/pojazd/coast?start=' + day(20) + '&end=' + day(27) + '&guests=2');
  await p.getByLabel('Krzesło turystyczne — liczba sztuk').selectOption('2');
  await p.getByRole('button', { name: 'Przejdź do rezerwacji' }).click();
  await p.waitForURL(/\/rezerwacja\//);
  const bookingId = new URL(p.url()).pathname.split('/').pop();
  await p.getByLabel('Scenariusz testowy').selectOption('failure');
  await p.getByLabel('Akceptuję podsumowanie i zasady tej lokalnej rezerwacji testowej.').check();
  await p.getByRole('button', { name: 'Potwierdź płatność testową' }).click();
  await p.getByRole('alert').filter({ hasText: 'odrzucona' }).waitFor();
  await p.getByLabel('Scenariusz testowy').selectOption('success');
  await p.getByRole('button', { name: 'Potwierdź płatność testową' }).click();
  await p.waitForURL(/\/konto\/rezerwacja\//);
  await p.getByText('Potwierdzona', { exact: true }).waitFor();
  await p.reload();
  await p.getByText('Potwierdzona', { exact: true }).waitFor();
  console.log('OK: hold, failed payment, successful payment and persistence');
  await p.getByLabel('Nowy odbiór').fill(day(22));
  await p.getByLabel('Nowy zwrot').fill(day(29));
  await p.getByLabel('Co chcesz ustalić?').fill('Zmiana terminu podczas testu przeglądarkowego.');
  await p.getByRole('button', { name: 'Poproś o zmianę terminu' }).click();
  await p.getByRole('heading', { name: 'Historia zmian' }).waitFor();
  const { page: o } = await context('baltic@vanly.local');
  await o.goto(base + '/company/booking/' + bookingId);
  await o.getByRole('button', { name: 'Akceptuj nowy termin i cenę' }).click();
  await o.getByText('Zaakceptowana', { exact: true }).waitFor();
  await p.reload();
  await p.getByRole('button', { name: /Dopłać testowo/ }).click();
  await p.getByText('Opłacona', { exact: true }).waitFor();
  console.log('OK: owner accepts amendment, traveler pays remaining balance');
  await o.getByLabel('Przebieg (km)', { exact: true }).fill('15000');
  await o.getByLabel('Sprawdzono wyposażenie', { exact: true }).check();
  await o.getByLabel('Sprawdzono stan pojazdu', { exact: true }).check();
  await o.getByLabel('Sprawdzono poziom paliwa', { exact: true }).check();
  await o.getByRole('button', { name: 'Zapisz protokół i zmień status wynajmu' }).click();
  await o.getByText('W podróży', { exact: true }).waitFor();
  await o.getByLabel('Przebieg (km)', { exact: true }).fill('15500');
  await o.getByLabel('Sprawdzono wyposażenie', { exact: true }).check();
  await o.getByLabel('Sprawdzono stan pojazdu', { exact: true }).check();
  await o.getByLabel('Sprawdzono poziom paliwa', { exact: true }).check();
  await o.getByRole('button', { name: 'Zapisz protokół i zmień status wynajmu' }).click();
  await o.getByText('Zakończona', { exact: true }).waitFor();
  await p.reload();
  await p
    .getByLabel('Opinia po wynajmie')
    .fill('Przeglądarkowy test rezerwacji przeszedł od wyboru pojazdu do zwrotu.');
  await p.getByRole('button', { name: 'Dodaj opinię do moderacji' }).click();
  await p.getByRole('status').filter({ hasText: 'moderacji' }).waitFor();
  console.log('OK: pickup, return and review');
  const { page: a } = await context('operator@vanly.local');
  await a.goto(base + '/operator/moderation');
  await a
    .getByLabel('Uzasadnienie', { exact: true })
    .fill('Opinia z zakończonej rezerwacji testowej.');
  await a.getByRole('button', { name: 'Zapisz decyzję' }).click();
  await a.getByText('Opublikowana', { exact: true }).waitFor();
  await p.goto(base + '/pojazd/coast');
  await p
    .getByText('Przeglądarkowy test rezerwacji przeszedł od wyboru pojazdu do zwrotu.')
    .waitFor();
  console.log('OK: moderation controls publication');
  for (const path of [
    '/company',
    '/company/dashboard',
    '/company/calendar',
    '/company/bookings',
    '/company/fleet',
    '/company/inventory',
    '/company/messages',
    '/company/settings',
    '/company/team',
    '/company/reviews',
    '/company/vehicle/coast',
  ]) {
    await o.goto(base + path);
    await o
      .locator('.office-main .panel,.office-main .metric,.office-main .vehicle-card')
      .first()
      .waitFor();
    await noOverflow(o, path);
  }
  await o.goto(base + '/company/vehicle/coast');
  // CDP request interception omits multipart file bytes. The real upload path is
  // covered separately by scripts/check-upload.mjs, without interception.
  await o.getByLabel('Krótki opis', {exact:true}).fill('Opis zapisany w teście przeglądarkowym.');
  await o.getByRole('button', { name: 'Zapisz pojazd', exact: true }).click();
  await o.waitForURL(/\/company\/fleet$/);
  const result = await db.query("SELECT tagline FROM vehicles WHERE id='coast'");
  assert.equal(result.rows[0].tagline, 'Opis zapisany w teście przeglądarkowym.');
  console.log('OK: fleet editing and persistence');
  for (const path of [
    '/operator',
    '/operator/dashboard',
    '/operator/companies',
    '/operator/bookings',
    '/operator/reports',
    '/operator/content',
    '/operator/system',
    '/operator/history',
  ]) {
    await a.goto(base + path);
    await a.locator('.office-main').waitFor();
    await a.waitForLoadState('networkidle');
    await noOverflow(a, path);
  }
  await o.goto(base + '/company');
  await o.waitForLoadState('networkidle');
  await o.screenshot({ path: '.local/qa/owner-desktop.png', fullPage: true });
  await a.goto(base + '/operator');
  await a.waitForLoadState('networkidle');
  await a.screenshot({ path: '.local/qa/operator-desktop.png', fullPage: true });
  await p.goto(base + '/konto/rezerwacja/' + bookingId);
  await p.waitForLoadState('networkidle');
  await p.screenshot({ path: '.local/qa/booking-desktop.png', fullPage: true });
  await p.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    '/',
    '/pojazdy',
    '/pojazd/coast',
    '/konto',
    '/konto/profil',
    '/konto/rezerwacja/' + bookingId,
  ]) {
    await p.goto(base + path);
    await p.waitForLoadState('networkidle');
    await noOverflow(p, path + ' mobile');
  }
  await o.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/company', '/company/calendar', '/company/inventory', '/company/vehicle/coast']) {
    await o.goto(base + path);
    await o.waitForLoadState('networkidle');
    await noOverflow(o, path + ' mobile');
  }
  await o.goto(base + '/company');
  await o.waitForLoadState('networkidle');
  await o.screenshot({ path: '.local/qa/owner-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: full browser journey, owner and admin screens, fleet editing, responsive layouts; no JavaScript errors.',
  );
} catch (e) {
  for (const c of browser.contexts())
    for (const [i, p] of c.pages().entries())
      await p
        .screenshot({
          path:
            '.local/qa/failure-' +
            new URL(p.url()).pathname.replaceAll('/', '-') +
            '-' +
            i +
            '.png',
          fullPage: true,
        })
        .catch(() => {});
  throw e;
} finally {
  await browser.close();
  server.kill('SIGTERM');
  worker.kill('SIGTERM');
  await db.end();
}
