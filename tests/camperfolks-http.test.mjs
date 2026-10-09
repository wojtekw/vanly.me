import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { JSDOM } from 'jsdom';

// Safe live HTTP integration. No migration, seed, login, quote, hold or booking
// write is performed. Existing GET /catalog may expire old holds, as on the UI.
// TLS remains verified; use NODE_EXTRA_CA_CERTS for the local CA. Loopback
// examples: CAMPERFOLKS_BASE_URL=http://127.0.0.1:3104
//           VANLY_BASE_URL=http://127.0.0.1:3100
const camperfolks = new URL(process.env.CAMPERFOLKS_BASE_URL || 'https://camperfolks.com.local').origin;
const vanly = new URL(process.env.VANLY_BASE_URL || 'https://vanly.me.local').origin;
const camperfolksOrigin = process.env.CAMPERFOLKS_REQUEST_ORIGIN || 'https://camperfolks.com.local';
const vanlyOrigin = process.env.VANLY_REQUEST_ORIGIN || 'https://vanly.me.local';
const camperfolksSeoOrigin = process.env.CAMPERFOLKS_SEO_ORIGIN || 'https://camperfolks.com.local';
const unknownOrigin = 'https://camperfolks-api-origin-test.invalid';
let home, originalHome, catalog, originalCatalog, vehicle, articles;

async function request(base, pathname, options = {}) {
  return fetch(base + pathname, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
    ...options,
  });
}

async function json(base, pathname, options = {}) {
  const response = await request(base, pathname, options);
  const data = await response.json();
  return { response, data };
}

async function html(base, pathname) {
  const response = await request(base, pathname);
  const source = await response.text();
  const document = new JSDOM(source).window.document;
  return { response, document, source };
}

const meta = (document, selector) => document.querySelector(selector)?.getAttribute('content');
const assertNoindex = (document) => assert.match(meta(document, 'meta[name="robots"]') || '', /noindex/);
const validAsset = (name) => name?.startsWith('/api/') ? name : '/assets/' + (name || 'caravan.svg');

before(async () => {
  const [newHome, oldHome, newCatalog, oldCatalog, publishedArticles] = await Promise.all([
    html(camperfolks, '/'),
    html(vanly, '/'),
    json(camperfolks, '/api/v1/catalog'),
    json(vanly, '/api/v1/catalog'),
    json(camperfolks, '/api/v1/articles'),
  ]);
  home = newHome;
  originalHome = oldHome;
  assert.equal(newCatalog.response.status, 200, 'Camperfolks catalog API must respond');
  assert.equal(oldCatalog.response.status, 200, 'Vanly catalog API must stay available');
  catalog = newCatalog.data;
  originalCatalog = oldCatalog.data;
  assert.ok(Array.isArray(catalog) && catalog.length > 0, 'The existing catalog must contain offers');
  assert.equal(publishedArticles.response.status, 200);
  articles = publishedArticles.data;
  vehicle = catalog[0];
}, { timeout: 60000 });

test('both frontends run in parallel and return the same existing API data', async () => {
  assert.equal(home.response.status, 200);
  assert.equal(originalHome.response.status, 200);
  assert.deepEqual(catalog, originalCatalog, 'Catalog records, assets and integer prices must be shared');
  const [newHealth, oldHealth, newVehicle, oldVehicle] = await Promise.all([
    json(camperfolks, '/api/v1/health'),
    json(vanly, '/api/v1/health'),
    json(camperfolks, '/api/v1/vehicles/' + encodeURIComponent(vehicle.id)),
    json(vanly, '/api/v1/vehicles/' + encodeURIComponent(vehicle.id)),
  ]);
  for (const value of [newHealth, oldHealth, newVehicle, oldVehicle]) assert.equal(value.response.status, 200);
  assert.equal(newHealth.data.database, 'postgresql');
  assert.deepEqual(newHealth.data, oldHealth.data);
  assert.deepEqual(newVehicle.data, oldVehicle.data, 'Vehicle records and legal company data must be identical');
  assert.ok(Number.isInteger(Number(vehicle.daily)), 'API prices use integer grosz');
});

test('initial HTML contains brand-specific presentation and unchanged offer images', async () => {
  assert.match(home.document.title, /Camperfolks/);
  assert.match(home.document.querySelector('h1')?.textContent || '', /Do zobaczenia w drodze\./);
  assert.match(home.document.querySelector('main')?.textContent || '', /kamper|przyczep/i);
  assert.equal(home.document.documentElement.getAttribute('data-brand'), 'camperfolks');
  assert.match(home.document.querySelector('header .brand')?.getAttribute('aria-label') || '', /Camperfolks/);
  assert.equal(home.document.querySelector('header .brand img')?.getAttribute('src'), '/assets/camperfolks/camperfolks-patch-logo-480.webp');
  assert.equal(home.document.querySelector('.footer-logo')?.getAttribute('src'), '/assets/camperfolks/camperfolks-patch-logo-480.webp');
  assert.match(originalHome.document.title, /Vanly/);
  assert.equal(originalHome.document.documentElement.getAttribute('data-brand'), null);
  assert.equal(originalHome.document.querySelector('header .brand img')?.getAttribute('src'), '/assets/logo-dark.png');
  assert.equal(originalHome.document.querySelector('.footer-logo')?.getAttribute('src'), '/assets/logo-light.png');
  assertNoindex(home.document);
  assertNoindex(originalHome.document);
  const offers = [...home.document.querySelectorAll('.vehicle-card')];
  assert.ok(offers.length > 0, 'SSR must render the existing offers without waiting for a browser session');
  assert.ok(offers.some((card) => card.querySelector('img')?.getAttribute('src') === validAsset(vehicle.asset)), 'Offer asset must come from the API');
});

test('metadata, structured data, manifest and local indexing settings use Camperfolks', async () => {
  const canonical = home.document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  assert.ok(canonical, 'A canonical URL must be rendered');
  assert.equal(new URL(canonical).href, new URL('/', camperfolksSeoOrigin).href);
  assert.equal(meta(home.document, 'meta[property="og:site_name"]'), 'Camperfolks');
  assert.match(meta(home.document, 'meta[property="og:title"]') || '', /Camperfolks/);
  const schemas = [...home.document.querySelectorAll('script[type="application/ld+json"]')].map((script) => JSON.parse(script.textContent));
  assert.ok(schemas.some((item) => item['@type'] === 'WebSite' && item.name === 'Camperfolks'));
  const favicon = home.document.querySelector('link[rel="icon"]')?.getAttribute('href');
  const manifestPath = home.document.querySelector('link[rel="manifest"]')?.getAttribute('href');
  assert.ok(favicon?.includes('camperfolks'));
  assert.ok(manifestPath, 'Camperfolks manifest must be exposed');
  const [robots, sitemap, manifest] = await Promise.all([
    request(camperfolks, '/robots.txt'),
    request(camperfolks, '/sitemap.xml'),
    json(camperfolks, manifestPath),
  ]);
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /^Disallow:\s*\/\s*$/m);
  assert.equal(sitemap.status, 200);
  assert.doesNotMatch(await sitemap.text(), /<loc>/);
  assert.equal(manifest.response.status, 200);
  assert.match(manifest.data.name, /Camperfolks/);
  assert.match(manifest.data.short_name, /camperfolks/i);
});

test('brand assets and the existing backend vehicle image load successfully', async () => {
  const share = meta(home.document, 'meta[property="og:image"]');
  assert.ok(share, 'A sharing image must be configured');
  const sharePath = new URL(share, camperfolks).pathname;
  const paths = [
    '/assets/camperfolks/camperfolks-patch-logo-480.webp',
    '/assets/camperfolks/road-camp.webp',
    home.document.querySelector('link[rel="icon"]').getAttribute('href'),
    sharePath,
    validAsset(vehicle.asset),
  ];
  for (const pathname of paths) {
    const response = await request(camperfolks, pathname);
    assert.equal(response.status, 200, pathname);
    assert.match(response.headers.get('content-type') || '', /^image\//, pathname);
    assert.ok((await response.arrayBuffer()).byteLength > 0, pathname);
  }
  const [newImage, oldImage] = await Promise.all([
    request(camperfolks, validAsset(vehicle.asset)), request(vanly, validAsset(vehicle.asset)),
  ]);
  assert.deepEqual(Buffer.from(await newImage.arrayBuffer()), Buffer.from(await oldImage.arrayBuffer()), 'The offer image must be the existing Vanly asset');
});

test('all existing public and traveler routes remain available with Camperfolks metadata', async () => {
  const bookingId = '00000000-0000-4000-8000-000000000000';
  const paths = [
    '/pojazdy', '/poradniki', '/odkrywaj', '/kempingi', '/dla-firm', '/mapy-i-prywatnosc',
    '/logowanie', '/rejestracja', '/reset', '/ulubione', '/porownaj', '/o-wersji',
    '/konto', ...['podroze', 'wiadomosci', 'dokumenty', 'profil', 'skrzynka', 'pomoc'].map((tab) => '/konto/' + tab),
    '/rezerwacja/' + bookingId, '/konto/rezerwacja/' + bookingId,
    '/pojazd/' + encodeURIComponent(vehicle.id),
    ...(articles?.length ? ['/artykul/' + encodeURIComponent(articles[0].id)] : []),
  ];
  for (const pathname of paths) {
    const value = await html(camperfolks, pathname);
    assert.equal(value.response.status, 200, pathname);
    assert.match(value.document.title, /Camperfolks/, pathname);
    assertNoindex(value.document);
    assert.equal(value.document.querySelector('header .brand img')?.getAttribute('src'), '/assets/camperfolks/camperfolks-patch-logo-480.webp', pathname);
  }
}, { timeout: 120000 });

test('missing routes and records keep the branded 404 page', async () => {
  for (const pathname of ['/camperfolks-http-test-missing-page', '/pojazd/camperfolks-http-test-missing-vehicle']) {
    const value = await html(camperfolks, pathname);
    assert.equal(value.response.status, 404, pathname);
    assert.match(value.document.querySelector('main')?.textContent || '', /Nie znaleźliśmy tej strony/);
    assert.equal(value.document.querySelector('header .brand img')?.getAttribute('src'), '/assets/camperfolks/camperfolks-patch-logo-480.webp');
  }
});

test('anonymous session reads do not set or expose a session and API access is not globally opened', async () => {
  for (const base of [camperfolks, vanly]) {
    const value = await json(base, '/api/v1/auth/me');
    assert.equal(value.response.status, 200);
    assert.equal(value.data.user, null);
    assert.equal(value.data.csrf, null);
    assert.equal(value.response.headers.get('set-cookie'), null);
    assert.notEqual(value.response.headers.get('access-control-allow-origin'), '*');
  }
});

test('unknown origins are rejected before quote logic and the configured frontend origins are accepted', async () => {
  for (const [base, origin] of [[camperfolks, camperfolksOrigin], [vanly, vanlyOrigin]]) {
    const post = (requestOrigin) => json(base, '/api/v1/preview-quote', {
      method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json' }, body: '{}',
    });
    const blocked = await post(unknownOrigin);
    assert.equal(blocked.response.status, 403);
    assert.match(blocked.data.message, /źródło żądania/);
    // Empty input fails Zod validation before any transaction or expiry routine.
    const permitted = await post(origin);
    assert.equal(permitted.response.status, 400, 'The explicit frontend Origin must reach input validation');
    assert.match(permitted.data.message, /Sprawdź dane/);
  }
});

for (const [name, base, origin, cookie] of [
  ['Camperfolks', camperfolks, camperfolksOrigin, process.env.CAMPERFOLKS_TEST_SESSION_COOKIE],
  ['Vanly', vanly, vanlyOrigin, process.env.VANLY_TEST_SESSION_COOKIE],
]) {
  test(`${name} existing session rejects missing CSRF without creating a new session or reservation`, {
    skip: cookie ? false : 'Existing session cookie was not supplied; positive cookie flags are verified in browser login QA.',
  }, async () => {
    const expectedName = new URL(base).protocol === 'https:' ? '__Host-vanly_session=' : 'vanly_session=';
    assert.ok(cookie.startsWith(expectedName), `Expected ${expectedName} for the actual HTTP/TLS entry point`);
    assert.ok(!cookie.includes(';'), 'Supply only the Cookie name=value pair, not Set-Cookie attributes');
    const session = await json(base, '/api/v1/auth/me', { headers: { cookie } });
    assert.equal(session.response.status, 200);
    assert.ok(session.data.user && session.data.csrf, 'The supplied cookie must be an existing valid session');
    const response = await json(base, '/api/v1/preview-quote', {
      method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(response.response.status, 403);
    assert.match(response.data.message, /Odśwież stronę/);
  });
}
