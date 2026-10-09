import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Run after `pnpm --filter @vanly/frontoffice build`. These processes never use
// the live portal or database: the upstream API is an in-memory HTTP fixture.
const frontoffice = (process.env.VANLY_SEO_APP_ROOT || fileURLToPath(new URL('../apps/frontoffice/', import.meta.url))).replace(/\/?$/, '/');
const next = fileURLToPath(
  new URL('../apps/frontoffice/node_modules/next/dist/bin/next', import.meta.url),
);
const publicPort = Number(process.env.SEO_TEST_PORT || 3102);
const localPort = publicPort + 1;
const publicOrigin = `http://127.0.0.1:${publicPort}`;
const localOrigin = `http://127.0.0.1:${localPort}`;
const site = 'https://vanly.me';
const bot = 'Googlebot/2.1 (+http://www.google.com/bot.html)';
const processes = [];
const apiRequests = [];
let api;

const vehicle = {
  id: 'coast',
  name: 'Bałtycki Campervan',
  type: 'campervan',
  city: 'Gdynia',
  company_id: 'baltic',
  company_name: 'Bałtyckie Drogi',
  verified: true,
  status: 'published',
  lat: 54.5189,
  lng: 18.5305,
  seats: 4,
  sleeps: 4,
  daily: 42900,
  total_minor: 61900,
  prep: 19000,
  deposit: 500000,
  min_days: 2,
  auto: true,
  pets: true,
  instant: false,
  km: 300,
  asset: 'campervan.webp',
  tagline: 'Dobry początek drogi nad morzem.',
  description: 'Przestronny campervan z Gdyni na spokojny wyjazd nad Bałtyk.',
  features: ['Kuchnia', 'Prysznic', 'Ogrzewanie'],
  settings: { minDays: 2, open: '09:00', close: '17:00', prep: 19000, buffer: 1 },
  rating: null,
  review_count: 0,
  equipment: [],
  comments: [],
  similar: [],
  created_at: '2026-09-01T12:00:00.000Z',
  updated_at: '2026-09-30T12:00:00.000Z',
};
const article = {
  id: 'first',
  title: 'Pierwsza podróż kamperem',
  kind: 'guide',
  published: true,
  summary: 'Praktyczny poradnik przed pierwszym wyjazdem kamperem.',
  asset: 'guides/01-pierwszy-wyjazd.webp',
  body: [
    [
      'Zanim wyruszysz',
      'Zaplanuj pierwszy przystanek i sprawdź wyposażenie przed odbiorem kluczyków.',
    ],
  ],
  created_at: '2026-09-01T12:00:00.000Z',
  updated_at: '2026-09-30T12:00:00.000Z',
};
const escapedArticle = {
  ...article,
  id: 'escape',
  title: 'Podróż </script><script id="seo-injection">alert(1)</script>',
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  timer.unref();
  await exited;
  clearTimeout(timer);
}

async function startNext(port, env) {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(
    process.execPath,
    [next, 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: frontoffice,
      env: { ...process.env, NODE_ENV: 'production', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  processes.push(child);
  let log = '';
  child.stdout.on('data', (data) => {
    log = (log + data).slice(-12000);
  });
  child.stderr.on('data', (data) => {
    log = (log + data).slice(-12000);
  });
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error(`SEO test Next server exited (${port}):\n${log}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/robots.txt`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`SEO test Next server did not start (${port}):\n${log}`);
}

async function page(path, { origin = publicOrigin, headers = {} } = {}) {
  const response = await fetch(origin + path, {
    headers: { 'user-agent': bot, ...headers },
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  const html = await response.text();
  return { response, html, document: new JSDOM(html).window.document };
}

const robots = (document) =>
  [...document.querySelectorAll('meta[name="robots"]')].map((meta) => meta.content).join(', ');
const canonical = (document) => document.querySelector('link[rel="canonical"]')?.href;
const description = (document) => document.querySelector('meta[name="description"]')?.content;
function structuredData(document) {
  return [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((script) => {
    const data = JSON.parse(script.textContent);
    return Array.isArray(data) ? data : data['@graph'] || [data];
  });
}
function schema(document, type) {
  return structuredData(document).find((item) => [item['@type']].flat().includes(type));
}

before(
  async () => {
    await access(frontoffice + '.next/BUILD_ID');
    api = createServer((req, res) => {
      const url = new URL(req.url, 'http://fixture.invalid');
      apiRequests.push({ path: url.pathname, headers: req.headers });
      const path = url.pathname.replace(/^\/api\/v1/, '');
      if (path === '/catalog') return sendJson(res, 200, [vehicle]);
      if (path === '/articles') return sendJson(res, 200, [article, escapedArticle]);
      if (path === '/camps') return sendJson(res, 200, []);
      if (path === '/seo/inventory')
        return sendJson(res, 200, {
          vehicles: [{ id: vehicle.id, updated_at: vehicle.updated_at }],
          articles: [article, escapedArticle].map(({ id, updated_at }) => ({ id, updated_at })),
        });
      if (path === '/vehicles/coast' || path === '/vehicles/cookie-check')
        return sendJson(res, 200, { ...vehicle, id: path.split('/').at(-1) });
      if (path === '/articles/first') return sendJson(res, 200, article);
      if (path === '/articles/escape') return sendJson(res, 200, escapedArticle);
      if (path.endsWith('/unavailable'))
        return sendJson(res, 503, { message: 'API temporarily unavailable' });
      return sendJson(res, 404, { message: 'Not found' });
    });
    api.listen(0, '127.0.0.1');
    await once(api, 'listening');
    const env = {
      SEO_API_INTERNAL_URL: `http://127.0.0.1:${api.address().port}/api/v1`,
      SEO_SITE_URL: site,
    };
    await startNext(publicPort, { ...env, SEO_INDEXING_ENABLED: 'true' });
    // An absent opt-in must remain safe even if a production canonical is set.
    await startNext(localPort, { ...env, SEO_INDEXING_ENABLED: '' });
  },
  { timeout: 60000 },
);

after(async () => {
  await Promise.all(processes.map(stop));
  if (api) {
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
  }
});

test('public pages contain actual page content in initial HTML, with distinct metadata', async () => {
  const pages = await Promise.all(
    ['/', '/pojazdy', '/pojazd/coast', '/poradniki', '/artykul/first'].map((path) => page(path)),
  );
  for (const { response, document } of pages) {
    assert.equal(response.status, 200);
    assert.ok(
      document.querySelector('main h1'),
      'The page must render its h1 before JavaScript runs',
    );
    assert.equal(
      document.querySelector('main')?.closest('[hidden]'),
      null,
      'Public content must not wait in a hidden React streaming container',
    );
    assert.ok(description(document), 'Each page needs a description');
    assert.doesNotMatch(robots(document), /noindex/);
  }
  assert.equal(new Set(pages.map(({ document }) => document.title)).size, pages.length);
  assert.equal(new Set(pages.map(({ document }) => description(document))).size, pages.length);
  assert.ok(
    pages[0].document.querySelector('main a[href="/pojazd/coast"]'),
    'Home cards must be server-rendered',
  );
  assert.ok(
    pages[1].document.querySelector('main a[href="/pojazd/coast"]'),
    'Catalog cards must be server-rendered',
  );
  assert.equal(pages[2].document.querySelector('main h1').textContent, vehicle.name);
  assert.match(
    pages[2].document.querySelector('main').textContent,
    /Przestronny campervan z Gdyni/,
  );
  assert.ok(
    pages[3].document.querySelector('main a[href="/artykul/first"]'),
    'Guide cards must be server-rendered',
  );
  assert.match(
    pages[4].document.querySelector('main article').textContent,
    /Zaplanuj pierwszy przystanek/,
  );
  for (let i = 0; i < pages.length; i++)
    assert.equal(
      canonical(pages[i].document),
      site + ['/', '/pojazdy', '/pojazd/coast', '/poradniki', '/artykul/first'][i],
    );
  assert.equal(
    pages[2].document.querySelector('meta[property="og:title"]').content,
    pages[2].document.title,
  );
  for (const path of ['/', '/pojazdy', '/pojazd/coast', '/poradniki', '/artykul/first']) {
    const { response, document } = await page(path, { headers: { 'user-agent': 'Mozilla/5.0' } });
    assert.equal(response.status, 200, path);
    assert.ok(document.querySelector('main h1'), path);
    assert.equal(
      document.querySelector('main')?.closest('[hidden]'),
      null,
      `${path}: readable HTML must also reach browsers without JavaScript`,
    );
  }
});

test('brand, breadcrumbs and editorial structured data agree with visible content', async () => {
  const home = (await page('/')).document;
  assert.equal(schema(home, 'WebSite').name, 'Vanly');
  assert.equal(schema(home, 'WebSite').url, site + '/');
  const offer = (await page('/pojazd/coast')).document;
  const breadcrumbs = schema(offer, 'BreadcrumbList');
  assert.ok(breadcrumbs.itemListElement.some((item) => item.item === site + '/pojazdy'));
  const guide = (await page('/artykul/first')).document;
  assert.equal(schema(guide, 'Article').headline, article.title);
});

test('footer documents are readable without an account and have working public routes', async () => {
  const documents = [
    ['/regulamin', 'Regulamin serwisu'],
    ['/polityka-prywatnosci', 'Polityka prywatności'],
    ['/polityka-cookies', 'Polityka cookies'],
    ['/pomoc', 'Pomoc'],
    ['/kontakt', 'Kontakt'],
  ];
  const titles = new Set();
  const requestsBefore = apiRequests.length;
  for (const [path, heading] of documents) {
    const { response, document } = await page(path);
    assert.equal(response.status, 200, path);
    assert.equal(document.querySelector('main h1')?.textContent, heading, path);
    assert.equal(document.querySelector('main')?.closest('[hidden]'), null, path);
    assert.equal(canonical(document), site + path, path);
    assert.doesNotMatch(robots(document), /noindex/, path);
    assert.ok(description(document), path);
    titles.add(document.title);
    const footer = document.querySelector('footer');
    for (const [target] of documents)
      assert.ok(
        footer.querySelector(`a[href="${target}"]`),
        `${path}: missing footer link to ${target}`,
      );
    assert.doesNotMatch(footer.textContent, /lokalna instalacja/);
    if (['/regulamin', '/polityka-prywatnosci', '/kontakt'].includes(path)) {
      assert.match(document.querySelector('main').textContent, /6342487971/);
      assert.ok(document.querySelector('main a[href="mailto:info@vanly.me"]'));
    }
    const local = await page(path, { origin: localOrigin });
    assert.equal(local.response.status, 200, path);
    assert.equal(local.document.querySelector('main h1')?.textContent, heading, path);
    assert.match(robots(local.document), /noindex/, path);
  }
  assert.equal(titles.size, documents.length);
  assert.equal(
    apiRequests.length,
    requestsBefore,
    'Static documents must not depend on API or a session',
  );
});

test('JSON-LD cannot turn an editorial title into executable markup', async () => {
  const { response, document } = await page('/artykul/escape');
  assert.equal(response.status, 200);
  assert.equal(document.querySelector('main h1').textContent, escapedArticle.title);
  assert.equal(document.querySelector('#seo-injection'), null);
  assert.equal(schema(document, 'Article').headline, escapedArticle.title);
  for (const script of document.querySelectorAll('script[type="application/ld+json"]'))
    assert.doesNotMatch(script.textContent, /<\/script/i);
});

test('search variants and account flows stay out of the index', async () => {
  for (const path of [
    '/konto',
    '/logowanie',
    '/rejestracja',
    '/reset',
    '/ulubione',
    '/porownaj',
    '/rezerwacja/00000000-0000-4000-8000-000000000000',
    '/konto/rezerwacja/00000000-0000-4000-8000-000000000000',
  ]) {
    const { response, document } = await page(path);
    assert.equal(response.status, 200, path);
    assert.match(robots(document), /noindex/, path);
  }
  for (const path of ['/pojazdy?type=campervan', '/pojazdy?start=2027-05-01&end=2027-05-08']) {
    const { document } = await page(path);
    assert.match(robots(document), /noindex/, path);
    assert.equal(canonical(document), site + path.split('?')[0]);
  }
  for (const path of [
    '/pojazd/coast?start=2027-05-01&end=2027-05-08',
    '/artykul/first?utm_source=seo-test',
  ]) {
    const { document } = await page(path);
    assert.doesNotMatch(robots(document), /noindex/, path);
    assert.equal(canonical(document), site + path.split('?')[0]);
  }
});

test('missing public pages return an HTTP 404 instead of a soft 404', async () => {
  for (const path of [
    '/missing-route',
    '/pojazd/missing',
    '/artykul/missing',
    '/pojazd/coast/extra',
  ]) {
    const { response, document } = await page(path);
    assert.equal(response.status, 404, path);
    assert.match(robots(document), /noindex/, path);
    assert.ok(
      document.querySelector('.main-nav a[href="/pojazdy"]'),
      '404 navigation must be present without JavaScript',
    );
    assert.match(document.querySelector('main')?.textContent || '', /Ta droga się tu kończy/);
  }
  const browser = await page('/pojazd/missing', { headers: { 'user-agent': 'Mozilla/5.0' } });
  assert.equal(
    browser.response.status,
    404,
    'A browser must receive the same missing-resource HTTP status',
  );
  const httpsProxy = await page('/pojazd/missing', {
    headers: { host: 'vanly.me', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'vanly.me' },
  });
  assert.equal(
    httpsProxy.response.status,
    404,
    'HTTPS termination at a reverse proxy must preserve the internal 404',
  );
  assert.ok(httpsProxy.document.querySelector('.main-nav a[href="/pojazdy"]'));
});

test('temporary API failure preserves a server error rather than claiming content was deleted', async () => {
  for (const path of ['/pojazd/unavailable', '/artykul/unavailable']) {
    const { response } = await page(path);
    assert.ok(
      response.status >= 500 && response.status <= 599,
      `${path}: expected 5xx, got ${response.status}`,
    );
  }
});

test('server-rendered public API fetches do not forward customer credentials', async () => {
  const marker = apiRequests.length;
  const { response } = await page('/pojazd/cookie-check', {
    headers: { cookie: 'vanly_session=seo-test-session', authorization: 'Bearer seo-test-token' },
  });
  assert.equal(response.status, 200);
  const requests = apiRequests
    .slice(marker)
    .filter((req) => req.path.endsWith('/vehicles/cookie-check'));
  assert.ok(requests.length, 'Test must observe the public server-to-server request');
  for (const { headers } of requests) {
    assert.equal(headers.cookie, undefined);
    assert.equal(headers.authorization, undefined);
  }
});

test('production robots and sitemap expose only canonical public URLs from published inventory', async () => {
  const robotsResponse = await fetch(publicOrigin + '/robots.txt');
  assert.equal(robotsResponse.status, 200);
  assert.match(robotsResponse.headers.get('content-type'), /text\/plain/);
  const text = await robotsResponse.text();
  assert.match(text, /User-Agent:\s*\*/i);
  assert.match(text, /Sitemap:\s*https:\/\/vanly\.me\/sitemap\.xml/i);
  for (const prefix of ['/firma/', '/company/', '/operator/', '/api/'])
    assert.ok(text.includes('Disallow: ' + prefix), `Robots must exclude ${prefix}`);
  for (const prefix of [
    '/konto',
    '/rezerwacja',
    '/logowanie',
    '/rejestracja',
    '/reset',
    '/ulubione',
    '/porownaj',
  ])
    assert.ok(
      !text.includes('Disallow: ' + prefix),
      `Google must be able to crawl ${prefix} to read its noindex directive`,
    );
  const response = await fetch(publicOrigin + '/sitemap.xml');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /xml/);
  const document = new JSDOM(await response.text(), { contentType: 'text/xml' }).window.document;
  const urls = [...document.querySelectorAll('loc')].map((item) => item.textContent);
  assert.equal(new Set(urls).size, urls.length);
  for (const path of [
    '/',
    '/pojazdy',
    '/poradniki',
    '/odkrywaj',
    '/pojazd/coast',
    '/artykul/first',
    '/artykul/escape',
    '/regulamin',
    '/polityka-prywatnosci',
    '/polityka-cookies',
    '/pomoc',
    '/kontakt',
  ])
    assert.ok(urls.includes(site + path), `Sitemap must include ${path}`);
  for (const url of urls) {
    assert.equal(new URL(url).origin, site);
    assert.equal(new URL(url).search, '');
    assert.doesNotMatch(
      new URL(url).pathname,
      /^\/(konto|rezerwacja|logowanie|rejestracja|reset|firma|company|operator|api|ulubione|porownaj|o-wersji)(\/|$)/,
    );
  }
  assert.ok(!urls.includes(site + '/pojazd/missing'));
  assert.ok(!urls.includes(site + '/pojazd/cookie-check'));
});

test('frontoffice forwards company and legacy panel deep links to canonical panel origins', async () => {
  for (const [path, destination, status] of [
    ['/firma/wiadomosci?conversation=booking-1', 'https://owner.vanly.me.local/company/messages?conversation=booking-1', 308],
    ['/firma/pojazd/nowy', 'https://owner.vanly.me.local/company/vehicle/new', 308],
    ['/company/booking/00000000-0000-4000-8000-000000000000?from=mail', 'https://owner.vanly.me.local/company/booking/00000000-0000-4000-8000-000000000000?from=mail', 307],
    ['/operator/rezerwacje?status=pending', 'https://admin.vanly.me.local/operator/bookings?status=pending', 308],
  ]) {
    const response = await fetch(publicOrigin + path, { redirect: 'manual' });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('location'), destination);
    await response.body?.cancel();
  }
});

test('default local deployment never opts into Google indexing', async () => {
  const { response, document } = await page('/pojazd/coast', { origin: localOrigin });
  assert.equal(response.status, 200);
  assert.match(robots(document), /noindex/);
  const text = await (await fetch(localOrigin + '/robots.txt')).text();
  assert.match(text, /Disallow:\s*\/(?:\s|$)/);
  assert.doesNotMatch(text, /Sitemap:/i);
  const sitemap = new JSDOM(await (await fetch(localOrigin + '/sitemap.xml')).text(), {
    contentType: 'text/xml',
  }).window.document;
  assert.equal(sitemap.querySelectorAll('loc').length, 0);
});
