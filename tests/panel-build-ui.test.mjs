import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { canonicalPanelPath, isPanelPath, panelRoute, panelRedirects } from '../packages/ui/portal-routes.mjs';

// Execute the actual Vite output, rather than re-transpiling TSX with a test-only
// JSX setting. The two panel builds must work without a global React variable.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = resolve(process.env.VANLY_PANEL_DIST_ROOT || projectRoot);
const ownerDashboard = {
  company: { id: 'company-test', name: 'Testowa wypożyczalnia', verified: true },
  bookings: [],
  vehicles: [{ id: 'vehicle-test', name: 'Testowy kamper' }],
  tasks: [],
};
const adminDashboard = {
  stats: { users: 2, vehicles: 1, bookings: 0, total_minor: 0 },
  companies: [{ id: 'company-test', name: 'Testowa wypożyczalnia', verified: true }],
  comments: [],
  reports: [],
  bookings: [],
};

async function panel(kind, authenticated, { location, canLogin = false } = {}) {
  const dist = resolve(distRoot, 'apps', kind, 'dist');
  const html = await readFile(resolve(dist, 'index.html'), 'utf8');
  const errors = [];
  const requests = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.stack || error.message));
  virtualConsole.on('error', (...args) => errors.push(args.map(String).join(' ')));
  const dom = new JSDOM(html, {
    url: `https://${kind}.vanly.me.local${location || (kind === 'owner' ? '/company' : '/operator')}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  window.scrollTo = () => {};
  window.addEventListener('error', event => errors.push(event.error?.stack || event.message));
  window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  window.fetch = async (url, options = {}) => {
    const path = new URL(String(url), window.location.href).pathname;
    requests.push({ path, method: options.method || 'GET' });
    if (canLogin && path === '/api/v1/auth/login' && options.method === 'POST') {
      authenticated = true;
      return { ok: true, json: async () => ({ ok: true }) };
    }
    assert.equal(options.method || 'GET', 'GET', 'rendering must not mutate data');
    if (path === '/api/v1/auth/me') {
      return {
        ok: true,
        json: async () => ({
          csrf: 'test-csrf',
          user: authenticated
            ? { id: `test-${kind}`, name: 'Testowy użytkownik', role: kind, company_id: 'company-test' }
            : null,
        }),
      };
    }
    if (authenticated && path === `/api/v1/${kind}/dashboard`) {
      return { ok: true, json: async () => kind === 'owner' ? ownerDashboard : adminDashboard };
    }
    if (authenticated && kind === 'owner' && path === '/api/v1/messages') {
      return { ok: true, json: async () => [] };
    }
    throw new Error(`Unexpected request in isolated panel test: ${path}`);
  };
  assert.equal(window.React, undefined);
  const scripts = [...window.document.querySelectorAll('script[type="module"][src]')];
  assert.equal(scripts.length, 1, 'expected the panel production entry point');
  const assetPath = new URL(scripts[0].src).pathname;
  assert.match(assetPath, /^\/assets\/[^/]+\.js$/);
  const bundle = await readFile(resolve(dist, assetPath.slice(1)), 'utf8');
  try {
    new Script(bundle, { filename: `${kind}:${assetPath}` }).runInContext(dom.getInternalVMContext());
  } catch (error) {
    dom.window.close();
    throw error;
  }
  return { dom, window, document: window.document, errors, requests };
}

test('panel routes preserve identifiers, query strings, hashes and segment boundaries', () => {
  for (const [legacy, canonical, tab, id] of [
    ['/firma', '/company', 'pulpit'],
    ['/firma/wiadomosci?next=%2Ffirma%2Fflota#rozmowa', '/company/messages?next=%2Ffirma%2Fflota#rozmowa', 'wiadomosci'],
    ['/firma/rezerwacja/flota', '/company/booking/flota', 'rezerwacja', 'flota'],
    ['/company/pojazd/nowy?mode=draft#photo', '/company/vehicle/new?mode=draft#photo', 'pojazd', 'new'],
    ['/firma/vehicle/pulpit', '/company/vehicle/pulpit', 'pojazd', 'pulpit'],
    ['/operator/rezerwacja/nowy#documents', '/operator/booking/nowy#documents', 'rezerwacja', 'nowy'],
    ['/operator/zgloszenia', '/operator/reports', 'zgloszenia'],
  ]) {
    assert.equal(canonicalPanelPath(legacy), canonical);
    assert.equal(canonicalPanelPath(canonical), canonical, 'canonical paths must be stable');
    assert.deepEqual(panelRoute(legacy, canonical.startsWith('/operator') ? 'admin' : 'owner'), { tab, id });
    assert.equal(isPanelPath(legacy), true);
  }
  for (const route of ['/firma-old', '/companynews', '/operators', '/konto/firma', 'https://owner.vanly.me.local/firma']) {
    assert.equal(isPanelPath(route), false);
    assert.equal(canonicalPanelPath(route), route);
  }
  for (const segment of ['constructor', 'toString', '__proto__']) {
    assert.equal(canonicalPanelPath('/company/' + segment), '/company/' + segment);
    assert.equal(canonicalPanelPath('/operator/' + segment), '/operator/' + segment);
  }
  assert.equal(canonicalPanelPath('/logowanie?next=%2Ffirma#login'), '/login?next=%2Ffirma#login');
  assert.equal(canonicalPanelPath('/reset?token=test'), '/reset?token=test');
});

test('server panel aliases use the same canonical mapping and resolve new vehicles first', () => {
  for (const route of panelRedirects) {
    assert.equal(canonicalPanelPath(route.source), route.destination);
  }
  for (const prefix of ['firma', 'company']) {
    const newVehicle = panelRedirects.findIndex(route => route.source === `/${prefix}/pojazd/nowy/:path*`);
    const vehicle = panelRedirects.findIndex(route => route.source === `/${prefix}/pojazd/:path*`);
    assert.ok(newVehicle >= 0 && newVehicle < vehicle);
  }
});

async function waitForRender(page, selector) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    assert.deepEqual(page.errors, [], 'the production bundle must not throw a client error');
    if (page.document.querySelector(selector)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`The production panel did not render ${selector}`);
}

for (const kind of ['owner', 'admin']) {
  test(`${kind} production build renders the login form without global React`, async () => {
    const page = await panel(kind, false);
    try {
      await waitForRender(page, '#main .auth-form input[name="email"]');
      assert.ok(page.document.querySelector('#main input[name="password"]'));
      assert.match(page.document.querySelector('#main .auth-form h2').textContent,
        kind === 'owner' ? /Zaloguj się do konta wypożyczalni/ : /Zaloguj się do Vanly/);
      assert.deepEqual(page.requests, [{ path: '/api/v1/auth/me', method: 'GET' }]);
      assert.equal(page.window.React, undefined);
      assert.deepEqual(page.errors, []);
    } finally {
      page.dom.window.close();
    }
  });

  test(`${kind} production build renders its authenticated dashboard without global React`, async () => {
    const page = await panel(kind, true);
    try {
      await waitForRender(page, '#main .metric-grid .metric');
      assert.equal(page.document.querySelector('#main h1').textContent,
        kind === 'owner' ? 'Testowa wypożyczalnia' : 'Dobre wyjazdy pod kontrolą.');
      assert.ok(page.document.querySelector(kind === 'owner'
        ? 'nav[aria-label="Panel firmy"]' : 'nav[aria-label="Panel operatora"]'));
      const links = [...page.document.querySelectorAll('.side-nav a')].map(link => link.getAttribute('href'));
      assert.deepEqual(links, kind === 'owner'
        ? ['/company/dashboard', '/company/calendar', '/company/bookings', '/company/fleet', '/company/inventory', '/company/messages', '/company/reviews', '/company/team', '/company/settings']
        : ['/operator/dashboard', '/operator/bookings', '/operator/companies', '/operator/moderation', '/operator/reports', '/operator/content', '/operator/system', '/operator/history']);
      assert.equal(page.document.querySelectorAll('#main .metric-grid .metric').length, 4);
      assert.deepEqual(page.requests, [
        { path: '/api/v1/auth/me', method: 'GET' },
        { path: `/api/v1/${kind}/dashboard`, method: 'GET' },
      ]);
      assert.equal(page.window.React, undefined);
      assert.deepEqual(page.errors, []);
    } finally {
      page.dom.window.close();
    }
  });

  test(`${kind} canonicalizes legacy routes at startup and on browser history navigation`, async () => {
    const page = await panel(kind, true, { location: `/${kind === 'owner' ? 'firma' : 'operator'}/rezerwacje?status=pending#bookings` });
    try {
      await waitForRender(page, '#main select[aria-label="Status rezerwacji"]');
      const prefix = kind === 'owner' ? '/company' : '/operator';
      assert.equal(page.window.location.pathname, prefix + '/bookings');
      assert.equal(page.window.location.search, '?status=pending');
      assert.equal(page.window.location.hash, '#bookings');
      assert.equal(page.document.querySelector('.side-nav a.active').getAttribute('href'), prefix + '/bookings');
      page.window.history.pushState({ source: 'test' }, '', `/${kind === 'owner' ? 'firma' : 'operator'}/pulpit?source=back#today`);
      page.window.dispatchEvent(new page.window.PopStateEvent('popstate'));
      await waitForRender(page, '#main .metric-grid .metric');
      assert.equal(page.window.location.pathname, prefix + '/dashboard');
      assert.equal(page.window.location.search, '?source=back');
      assert.equal(page.window.location.hash, '#today');
      assert.deepEqual(page.window.history.state, { source: 'test' });
      assert.deepEqual(page.errors, []);
    } finally {
      page.dom.window.close();
    }
  });
}

test('owner messages deep link survives login and keeps its query and hash', async () => {
  const page = await panel('owner', false, { location: '/firma/wiadomosci?conversation=test#latest', canLogin: true });
  try {
    await waitForRender(page, '#main .auth-form input[name="email"]');
    page.document.querySelector('input[name="email"]').value = 'owner@example.test';
    page.document.querySelector('input[name="password"]').value = 'test-password';
    page.document.querySelector('.auth-form form').dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));
    await waitForRender(page, '#main .messages-panel');
    assert.equal(page.window.location.pathname, '/company/messages');
    assert.equal(page.window.location.search, '?conversation=test');
    assert.equal(page.window.location.hash, '#latest');
    assert.equal(page.document.querySelector('.side-nav a.active').textContent, 'Wiadomości');
    assert.ok(page.requests.some(request => request.path === '/api/v1/messages'));
    assert.deepEqual(page.errors, []);
  } finally {
    page.dom.window.close();
  }
});
