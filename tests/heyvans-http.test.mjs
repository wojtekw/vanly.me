import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// Live integration against all three frontend proxies. TLS stays verified;
// provide the existing local CA with NODE_EXTRA_CA_CERTS. No migration, seed,
// account/reset mutation, saved quote, hold, booking or payment is performed.
// Catalog and preview reads may expire stale holds, matching the existing UI.
const sites = [
  { name: 'Vanly', key: 'VANLY', origin: 'https://vanly.me.local', brand: null,
    logo: '/assets/logo-dark.png', footerLogo: '/assets/logo-light.png' },
  { name: 'Camperfolks', key: 'CAMPERFOLKS', origin: 'https://camperfolks.com.local', brand: 'camperfolks',
    logo: '/assets/camperfolks/camperfolks-patch-logo-480.webp', footerLogo: '/assets/camperfolks/camperfolks-patch-logo-480.webp' },
  { name: 'heyvans', key: 'HEYVANS', origin: 'https://heyvans.com.local', brand: 'heyvans',
    logo: '/assets/heyvans/logo-dark.svg', footerLogo: '/assets/heyvans/logo-dark.svg' },
].map((site) => ({
  ...site,
  base: new URL(process.env[`${site.key}_BASE_URL`] || site.origin).origin,
  requestOrigin: process.env[`${site.key}_REQUEST_ORIGIN`] || site.origin,
}));
const heyvans = sites[2];
const heyvansSeoOrigin = process.env.HEYVANS_SEO_ORIGIN || heyvans.origin;
const unknownOrigin = 'https://heyvans-origin-test.invalid';
const sessions = new Set();
let vehicle, articles, account;

async function request(site, pathname, options = {}) {
  return fetch(site.base + pathname, {
    redirect: 'manual', signal: AbortSignal.timeout(20000), ...options,
  });
}

async function json(site, pathname, options = {}) {
  const response = await request(site, pathname, options);
  return { response, data: await response.json() };
}

async function html(site, pathname) {
  const response = await request(site, pathname);
  const source = await response.text();
  return { response, document: new JSDOM(source).window.document, source };
}

const meta = (document, selector) => document.querySelector(selector)?.getAttribute('content');
const assertNoindex = (document) => assert.match(meta(document, 'meta[name="robots"]') || '', /noindex/);
const validAsset = (name) => name?.startsWith('/api/') ? name : '/assets/' + (name || 'caravan.svg');

async function post(site, pathname, body, session, origin = site.requestOrigin) {
  return json(site, pathname, {
    method: 'POST',
    headers: {
      origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(session?.cookie ? { cookie: session.cookie } : {}),
      ...(session?.csrf ? { 'x-csrf-token': session.csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

before(async () => {
  await Promise.all(sites.map(async (site) => {
    const [home, catalog, health] = await Promise.all([
      html(site, '/'), json(site, '/api/v1/catalog'), json(site, '/api/v1/health'),
    ]);
    assert.equal(home.response.status, 200, `${site.name} homepage must be available`);
    assert.equal(catalog.response.status, 200, `${site.name} catalog must be available`);
    assert.equal(health.response.status, 200, `${site.name} shared API must be available`);
    assert.ok(Array.isArray(catalog.data) && catalog.data.length > 0, 'Existing catalog must contain offers');
    Object.assign(site, { home, catalog: catalog.data, health: health.data });
  }));
  vehicle = heyvans.catalog[0];
  const publishedArticles = await json(heyvans, '/api/v1/articles');
  assert.equal(publishedArticles.response.status, 200);
  articles = publishedArticles.data;
  const accounts = JSON.parse(await fs.readFile('.local/accounts.json', 'utf8'));
  account = accounts.find((value) => value.email === 'podroznik@vanly.local');
  assert.ok(account, 'Existing traveler account is required for safe session checks.');
}, { timeout: 60000 });

after(async () => {
  for (const session of sessions) {
    await post(session.site, '/api/v1/auth/logout', undefined, session).catch(() => {});
  }
});

test('three frontends return the same existing catalog, details, API status and integer prices', async () => {
  const details = await Promise.all(sites.map((site) => json(site, '/api/v1/vehicles/' + encodeURIComponent(vehicle.id))));
  for (let index = 0; index < sites.length; index++) {
    assert.deepEqual(sites[index].catalog, sites[0].catalog, `${sites[index].name} must share all catalog data`);
    assert.deepEqual(sites[index].health, sites[0].health);
    assert.equal(sites[index].health.database, 'postgresql');
    assert.ok(['disabled', 'local_test'].includes(sites[index].health.payments));
    assert.equal(details[index].response.status, 200);
    assert.deepEqual(details[index].data, details[0].data, 'Legal company details and inventory must be shared');
  }
  for (const offer of heyvans.catalog) {
    for (const amount of [offer.daily, offer.prep, offer.deposit, offer.total_minor]) assert.ok(Number.isInteger(Number(amount)));
  }
});

test('heyvans renders the campaign and backend offers while both existing brands retain their presentation', () => {
  for (const site of sites) {
    const document = site.home.document;
    assert.match(document.title, new RegExp(site.name, 'i'));
    assert.equal(document.documentElement.getAttribute('data-brand'), site.brand);
    assert.equal(document.querySelector('header .brand img')?.getAttribute('src'), site.logo);
    assert.equal(document.querySelector('.footer-logo')?.getAttribute('src'), site.footerLogo);
    assertNoindex(document);
  }
  const text = heyvans.home.document.querySelector('main')?.textContent || '';
  const h1 = (heyvans.home.document.querySelector('h1')?.textContent || '').replace(/\s+/g, ' ').trim();
  assert.match(h1, /Hej, po\s*przygodę\./);
  assert.match(text, /Twoja baza\. Twój następny ruch\./);
  assert.match(sites[1].home.document.querySelector('h1')?.textContent || '', /Do zobaczenia w drodze\./);
  assert.doesNotMatch(text, /makieta|demonstracyjne przekierowanie|projekt koncepcyjny strony/i);
  const offers = [...heyvans.home.document.querySelectorAll('.vehicle-card')];
  assert.ok(offers.length > 0, 'The initial HTML must render existing offers');
  assert.ok(offers.some((card) => card.querySelector('img')?.getAttribute('src') === validAsset(vehicle.asset)),
    'Offer imagery must come from the existing backend');
  for (const anchor of heyvans.home.document.querySelectorAll('a[href]')) {
    assert.doesNotMatch(anchor.getAttribute('href'), /^https?:\/\/(?:vanly\.me\.local|camperfolks\.com\.local)(?:\/|$)/,
      'Traveler links must remain on heyvans');
  }
});

test('heyvans canonical, sharing metadata, structured data, manifest and indexing settings use its own origin', async () => {
  const document = heyvans.home.document;
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  assert.ok(canonical, 'The heyvans canonical must be present.');
  assert.equal(new URL(canonical).href, new URL('/', heyvansSeoOrigin).href);
  assert.equal(meta(document, 'meta[property="og:site_name"]'), 'heyvans');
  assert.match(meta(document, 'meta[property="og:title"]') || '', /heyvans/i);
  assert.equal(new URL(meta(document, 'meta[property="og:image"]')).origin, heyvansSeoOrigin);
  const schemas = [...document.querySelectorAll('script[type="application/ld+json"]')].map((script) => JSON.parse(script.textContent));
  for (const type of ['WebSite', 'Organization']) {
    const schema = schemas.find((item) => item['@type'] === type);
    assert.ok(schema, `${type} structured data must be present`);
    assert.equal(schema.name, 'heyvans');
    assert.equal(new URL(schema.url).origin, heyvansSeoOrigin);
  }
  assert.equal(document.querySelector('link[rel="icon"]')?.getAttribute('href'), '/assets/heyvans/favicon.svg');
  const manifestPath = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
  assert.equal(manifestPath, '/manifest.webmanifest');
  const [robots, sitemap, manifest] = await Promise.all([
    request(heyvans, '/robots.txt'), request(heyvans, '/sitemap.xml'), json(heyvans, manifestPath),
  ]);
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /^Disallow:\s*\/\s*$/m);
  assert.equal(sitemap.status, 200);
  assert.doesNotMatch(await sitemap.text(), /<loc>/);
  assert.equal(manifest.response.status, 200);
  assert.match(manifest.data.name, /heyvans/i);
  assert.match(manifest.data.short_name, /heyvans/i);
  assert.equal(manifest.data.start_url, '/');
});

test('campaign assets, local fonts and licenses load, and original vehicle image bytes match across domains', async () => {
  const imagePaths = [
    '/assets/heyvans/logo-dark.svg', '/assets/heyvans/logo-light.svg', '/assets/heyvans/favicon.svg',
    '/assets/heyvans/share.png', '/assets/heyvans/heyvans-color-hero.webp',
    '/assets/heyvans/heyvans-color-surf.webp', '/assets/heyvans/heyvans-color-trail.webp',
  ];
  for (const pathname of imagePaths) {
    const response = await request(heyvans, pathname);
    assert.equal(response.status, 200, pathname);
    assert.match(response.headers.get('content-type') || '', /^image\//, pathname);
    assert.ok((await response.arrayBuffer()).byteLength > 0, pathname);
  }
  for (const pathname of [
    '/assets/heyvans/Manrope-variable.ttf', '/assets/heyvans/BarlowCondensed-Bold.ttf',
    '/assets/heyvans/OFL-Manrope.txt', '/assets/heyvans/OFL-Barlow-Condensed.txt',
  ]) {
    const response = await request(heyvans, pathname);
    assert.equal(response.status, 200, pathname);
    assert.ok((await response.arrayBuffer()).byteLength > 0, pathname);
  }
  const images = await Promise.all(sites.map(async (site) => {
    const response = await request(site, validAsset(vehicle.asset));
    assert.equal(response.status, 200);
    return Buffer.from(await response.arrayBuffer());
  }));
  assert.deepEqual(images[1], images[0]);
  assert.deepEqual(images[2], images[0]);
});

test('public, account and booking routes retain heyvans branding, same-host navigation and local noindex', async () => {
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
    const value = await html(heyvans, pathname);
    assert.equal(value.response.status, 200, pathname);
    assert.match(value.document.title, /heyvans/i, pathname);
    assertNoindex(value.document);
    assert.equal(value.document.documentElement.getAttribute('data-brand'), 'heyvans', pathname);
    assert.equal(value.document.querySelector('header .brand img')?.getAttribute('src'), heyvans.logo, pathname);
    const canonical = value.document.querySelector('link[rel="canonical"]')?.getAttribute('href');
    assert.equal(new URL(canonical).origin, heyvansSeoOrigin, pathname);
    for (const anchor of value.document.querySelectorAll('a[href]')) {
      assert.doesNotMatch(anchor.getAttribute('href'), /^https?:\/\/(?:vanly\.me\.local|camperfolks\.com\.local)(?:\/|$)/, pathname);
    }
  }
}, { timeout: 120000 });

test('missing heyvans routes and records return its branded 404', async () => {
  for (const pathname of ['/heyvans-http-test-missing-page', '/pojazd/heyvans-http-test-missing-vehicle']) {
    const value = await html(heyvans, pathname);
    assert.equal(value.response.status, 404);
    assert.match(value.document.querySelector('main')?.textContent || '', /Nie znaleźliśmy tej strony/);
    assert.equal(value.document.querySelector('header .brand img')?.getAttribute('src'), heyvans.logo);
  }
});

test('anonymous sessions remain empty and unknown or lookalike origins are blocked on every frontend proxy', async () => {
  for (const site of sites) {
    const session = await json(site, '/api/v1/auth/me');
    assert.equal(session.response.status, 200);
    assert.equal(session.data.user, null);
    assert.equal(session.data.csrf, null);
    assert.equal(session.response.headers.get('set-cookie'), null);
    assert.notEqual(session.response.headers.get('access-control-allow-origin'), '*');
    for (const origin of [unknownOrigin, site.requestOrigin + '.evil.invalid']) {
      const blocked = await post(site, '/api/v1/preview-quote', {}, undefined, origin);
      assert.equal(blocked.response.status, 403);
      assert.match(blocked.data.message, /źródło żądania/);
    }
    const allowed = await post(site, '/api/v1/preview-quote', {});
    assert.equal(allowed.response.status, 400, 'Exact configured origin must reach input validation');
  }
});

test('shared API returns the same safe preview quote in integer grosz and rejects a supplied client total', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
  const day = (offset) => new Date(Date.parse(today + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
  const length = Math.max(7, Number(vehicle.min_days), Number(vehicle.settings?.minDays || 2));
  assert.ok(length <= 60, 'Existing offer must support a preview interval of at most 60 days');
  let input, preview;
  for (const offset of [365, 540, 720]) {
    input = { vehicleId: vehicle.id, start: day(offset), end: day(offset + length), guests: 1, extras: {}, plan: 'deposit' };
    preview = await post(heyvans, '/api/v1/preview-quote', input);
    if (preview.response.status !== 409) break;
  }
  assert.equal(preview.response.status, 201, 'A safe existing offer preview must be available');
  assert.equal(preview.data.id, undefined, 'Preview must not persist a quote or reservation');
  assert.equal(preview.data.currency, 'PLN');
  assert.equal(preview.data.totalMinor, preview.data.baseMinor + preview.data.prepMinor + preview.data.equipmentMinor);
  for (const key of ['baseMinor', 'prepMinor', 'equipmentMinor', 'totalMinor', 'depositMinor', 'dueNowMinor']) {
    assert.ok(Number.isInteger(preview.data[key]), `${key} must use integer grosz`);
  }
  for (const site of sites.slice(0, 2)) {
    const value = await post(site, '/api/v1/preview-quote', input);
    assert.equal(value.response.status, 201);
    assert.deepEqual(value.data, preview.data, `${site.name} must calculate the same preview`);
  }
  assert.equal((await post(heyvans, '/api/v1/preview-quote', { ...input, totalMinor: 1 })).response.status, 400,
    'The API must reject a client-provided total');
});

test('login/logout uses the same account, host-only cookie and CSRF through each actual proxy', async () => {
  for (const site of sites) {
    const login = await post(site, '/api/v1/auth/login', { email: account.email, password: account.password });
    assert.equal(login.response.status, 201);
    const setCookie = login.response.headers.get('set-cookie');
    const session = { site, cookie: setCookie?.split(';')[0], csrf: login.data.csrf };
    sessions.add(session);
    const isHttps = new URL(site.base).protocol === 'https:';
    assert.ok(setCookie?.startsWith(isHttps ? '__Host-vanly_session=' : 'vanly_session='), 'Session cookie name must match the actual proxy protocol.');
    for (const flag of ['HttpOnly', 'SameSite=Strict', 'Path=/']) assert.ok(setCookie.includes(flag));
    if (isHttps) assert.ok(setCookie.includes('Secure'));
    assert.ok(!/Domain=/i.test(setCookie), 'Cookie must remain host-only.');
    const me = await json(site, '/api/v1/auth/me', { headers: { cookie: session.cookie } });
    assert.equal(me.data.user.email, account.email);
    assert.ok(me.data.csrf === session.csrf, 'The API must return the same session CSRF token.');
    const noCsrf = await post(site, '/api/v1/preview-quote', {}, { cookie: session.cookie });
    assert.equal(noCsrf.response.status, 403);
    const badCsrf = await post(site, '/api/v1/preview-quote', {}, { ...session, csrf: 'incorrect' });
    assert.equal(badCsrf.response.status, 403);
    const validCsrf = await post(site, '/api/v1/preview-quote', {}, session);
    assert.equal(validCsrf.response.status, 400);
    const logout = await post(site, '/api/v1/auth/logout', undefined, session);
    assert.equal(logout.response.status, 201);
    assert.equal((await json(site, '/api/v1/auth/me', { headers: { cookie: session.cookie } })).data.user, null);
    sessions.delete(session);
  }
});

test('heyvans HTTP entry redirects to HTTPS with the same route and query', {
  skip: new URL(heyvans.base).protocol !== 'https:' ? 'Loopback HTTP override skips local TLS redirect check.' : false,
}, async () => {
  const response = await fetch(new URL('/pojazdy?guests=2', heyvans.origin.replace('https:', 'http:')), {
    redirect: 'manual', signal: AbortSignal.timeout(20000),
  });
  assert.ok([301, 302, 307, 308].includes(response.status));
  assert.equal(response.headers.get('location'), heyvans.origin + '/pojazdy?guests=2');
});
