import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CookieJar, JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';

const html = await readFile(new URL('../apps/coming-soon/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../apps/coming-soon/analytics.js', import.meta.url), 'utf8');
const measurementId = 'G-TEST123456';
const key = 'vanly.analytics-consent.v1';
const cookieKey = 'vanly_analytics_consent_v1';

function consentValue(document) {
  const cookie = document.cookie.split(';').find((item) => item.trim().startsWith(cookieKey + '='));
  return cookie ? JSON.parse(decodeURIComponent(cookie.trim().slice(cookieKey.length + 1))) : null;
}

function writeConsent(document, payload) {
  document.cookie = `${cookieKey}=${encodeURIComponent(payload)}; domain=vanly.me; path=/; Secure; SameSite=Lax`;
}

function savedConsent(analytics, changes = {}) {
  return JSON.stringify({ version: 1, analytics, savedAt: Date.now() - 1000, expiresAt: Date.now() + 86400000, ...changes });
}

function page(options = {}) {
  const network = [];
  const url = options.url || 'https://vanly.me/?email=private%40example.com#private';
  const origin = new URL(url).origin;
  class BlockNetwork extends ResourceLoader {
    fetch(resourceUrl) {
      if (new URL(resourceUrl).origin !== origin) network.push(resourceUrl);
      return null;
    }
  }
  const console = new VirtualConsole();
  const errors = [];
  console.on('jsdomError', (error) => errors.push(error.message));
  const dom = new JSDOM(html, {
    url,
    referrer: 'https://example.org/source?token=secret#private',
    runScripts: 'outside-only',
    resources: new BlockNetwork(),
    virtualConsole: console,
    pretendToBeVisual: true,
    cookieJar: options.cookieJar || new CookieJar(),
  });
  const { window } = dom;
  const document = window.document;
  document.querySelector('meta[name="ga4-measurement-id"]').content = options.id ?? measurementId;
  if (options.consent !== undefined) writeConsent(document, options.consent);
  if (options.legacyConsent !== undefined) window.localStorage.setItem(key, options.legacyConsent);
  if (options.blockCookies) Object.defineProperty(document, 'cookie', { get() { return ''; }, set() {} });
  else if (options.cookieReadOnly) {
    const cookie = Object.getOwnPropertyDescriptor(window.Document.prototype, 'cookie');
    Object.defineProperty(document, 'cookie', { get() { return cookie.get.call(document); }, set() { throw new Error('Cookie writing denied'); } });
  }
  if (options.fixedTime !== undefined) {
    const NativeDate = window.Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [options.fixedTime])); }
      static now() { return options.fixedTime; }
    };
  }
  if (options.blockStorage) {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage denied'); } });
  } else if (options.blockWrites) {
    const storage = window.localStorage;
    Object.defineProperty(window, 'localStorage', { value: {
      getItem: storage.getItem.bind(storage),
      removeItem: storage.removeItem.bind(storage),
      setItem() { throw new Error('Quota exceeded'); },
    } });
  }
  for (const cookie of options.cookies || []) document.cookie = cookie;
  const commands = [];
  const intervals = new Map();
  let intervalId = 0;
  window.setInterval = (callback) => { intervals.set(++intervalId, callback); return intervalId; };
  window.clearInterval = (id) => intervals.delete(id);
  window.gtag = function (...args) {
    commands.push({ args, disabled: window['ga-disable-' + measurementId] });
  };
  const append = document.head.appendChild.bind(document.head);
  document.head.appendChild = (node) => {
    if (node.tagName === 'SCRIPT' && node.src.startsWith('https://')) network.push(node.src);
    return append(node);
  };
  window.eval(script);
  return {
    dom, window, document, commands, network, errors,
    click(id) { document.getElementById(id).click(); },
    pageViews() { return commands.filter(({ args }) => args[0] === 'event' && args[1] === 'page_view'); },
    reloads() { return errors.filter((message) => message.includes('navigation')); },
    poll() { for (const callback of [...intervals.values()]) callback(); },
    close() { window.close(); },
  };
}

test('before consent no external tag loads, all storage defaults to denied, and choices are accessible', () => {
  const p = page();
  assert.equal(p.document.getElementById('privacy-panel').hidden, false);
  assert.equal(p.document.getElementById('privacy-settings').hidden, false);
  assert.equal(p.document.getElementById('privacy-settings').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(p.network, []);
  assert.equal(p.pageViews().length, 0);
  const defaults = p.commands.find(({ args }) => args[0] === 'consent' && args[1] === 'default').args[2];
  assert.equal(defaults.analytics_storage, 'denied');
  for (const name of ['ad_storage', 'ad_user_data', 'ad_personalization']) assert.equal(defaults[name], 'denied');
  assert.equal(p.window['ga-disable-' + measurementId], true);
  p.close();
});

test('rejection persists without a Google request, and settings can be reopened with keyboard focus', () => {
  const p = page();
  p.click('privacy-reject');
  assert.equal(consentValue(p.document).analytics, 'denied');
  assert.equal(p.document.getElementById('privacy-panel').hidden, true);
  assert.equal(p.document.activeElement.id, 'privacy-settings');
  assert.equal(p.reloads().length, 0);
  p.click('privacy-settings');
  assert.equal(p.document.getElementById('privacy-panel').hidden, false);
  assert.equal(p.document.activeElement.id, 'privacy-title');
  assert.equal(p.document.getElementById('privacy-choice').textContent, 'Pomiar odwiedzin jest wyłączony.');
  assert.deepEqual(p.network, []);
  p.close();
});

test('acceptance loads one GA4 tag and one clean pageview with advertising disabled', () => {
  const p = page();
  p.click('privacy-accept');
  p.click('privacy-settings');
  p.click('privacy-accept');
  assert.deepEqual(p.network, ['https://www.googletagmanager.com/gtag/js?id=' + measurementId]);
  assert.equal(p.pageViews().length, 1);
  const config = p.commands.find(({ args }) => args[0] === 'config').args[2];
  assert.equal(config.send_page_view, false);
  assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false);
  const event = p.pageViews()[0].args[2];
  assert.equal(event.page_location, 'https://vanly.me/');
  assert.equal(event.page_referrer, 'https://example.org');
  assert.equal(JSON.stringify(event).includes('private'), false);
  for (const command of p.commands.filter(({ args }) => args[0] === 'consent')) {
    for (const name of ['ad_storage', 'ad_user_data', 'ad_personalization']) assert.equal(command.args[2][name], 'denied');
  }
  const stored = consentValue(p.document);
  assert.equal(stored.analytics, 'granted');
  assert.equal(stored.version, 1);
  assert.ok(stored.expiresAt - stored.savedAt >= 181 * 86400000);
  assert.ok(stored.expiresAt - stored.savedAt <= 186 * 86400000);
  p.close();
});

test('remembered acceptance sends one view per later visit without prompting again', () => {
  const p = page({ consent: savedConsent('granted'), url: 'https://www.vanly.me/' });
  assert.equal(p.network.length, 1);
  assert.equal(p.pageViews().length, 1);
  assert.equal(p.document.getElementById('privacy-panel').hidden, true);
  assert.equal(p.pageViews()[0].args[2].page_location, 'https://www.vanly.me/');
  p.close();
});

test('remembered rejection remains silent and removes own cookies', () => {
  const p = page({ consent: savedConsent('denied'), cookies: ['_ga=test; path=/; domain=.vanly.me', '_ga_TEST123456=test; path=/', 'unrelated=keep; path=/'] });
  assert.deepEqual(p.network, []);
  assert.equal(p.document.getElementById('privacy-panel').hidden, true);
  assert.equal(p.document.cookie.includes('_ga='), false);
  assert.equal(p.document.cookie.includes('_ga_TEST123456='), false);
  assert.equal(p.document.cookie.includes('unrelated=keep'), true);
  p.close();
});

test('withdrawal disables sending before consent update, removes cookies, and reloads into rejection', () => {
  const p = page({ consent: savedConsent('granted'), url: 'https://www.vanly.me/', cookies: ['_ga=test; path=/; domain=.vanly.me', '_ga_TEST123456=test; path=/; domain=.vanly.me', '_ga_TEST123456=test; path=/; domain=www.vanly.me', 'unrelated=keep; path=/'] });
  p.click('privacy-settings');
  p.click('privacy-reject');
  assert.equal(p.window['ga-disable-' + measurementId], true);
  assert.equal(p.commands.at(-1).args[0], 'consent');
  assert.equal(p.commands.at(-1).args[2].analytics_storage, 'denied');
  assert.equal(p.commands.at(-1).disabled, true);
  assert.equal(p.document.cookie.includes('_ga='), false);
  assert.equal(p.document.cookie.includes('_ga_TEST123456='), false);
  assert.equal(p.document.cookie.includes('unrelated=keep'), true);
  assert.equal(p.reloads().length, 1);
  assert.equal(p.network.length, 1);
  const persisted = JSON.stringify(consentValue(p.document));
  const reloaded = page({ consent: persisted });
  assert.deepEqual(reloaded.network, []);
  assert.equal(reloaded.document.getElementById('privacy-panel').hidden, true);
  reloaded.close();
  p.close();
});

for (const [label, stored] of [
  ['expired', savedConsent('granted', { expiresAt: Date.now() - 1 })],
  ['malformed JSON', '{no json'],
  ['null JSON', 'null'],
  ['unknown version', savedConsent('granted', { version: 2 })],
  ['unknown choice', savedConsent('accepted')],
  ['missing timestamp', JSON.stringify({ version: 1, analytics: 'granted' })],
  ['future timestamp', savedConsent('granted', { savedAt: Date.now() + 3600000 })],
  ['excessively long retention', savedConsent('granted', { expiresAt: Date.now() + 400 * 86400000 })],
]) {
  test(`${label} consent cannot load analytics`, () => {
    const p = page({ consent: stored });
    assert.deepEqual(p.network, []);
    assert.equal(p.pageViews().length, 0);
    assert.equal(p.document.getElementById('privacy-panel').hidden, false);
    p.close();
  });
}

for (const [label, options] of [
  ['empty measurement ID', { id: '' }],
  ['invalid measurement ID', { id: 'G-<script>' }],
  ['localhost', { url: 'http://localhost:3190/' }],
  ['loopback', { url: 'http://127.0.0.1:3190/' }],
  ['CloudFront', { url: 'https://example.cloudfront.net/' }],
  ['lookalike host', { url: 'https://vanly.me.example.org/' }],
]) {
  test(`${label} disables the entire analytics integration even with saved acceptance`, () => {
    const p = page({ ...options, consent: savedConsent('granted') });
    assert.deepEqual(p.network, []);
    assert.deepEqual(p.commands, []);
    assert.equal(p.document.getElementById('privacy-panel').hidden, true);
    assert.equal(p.document.getElementById('privacy-settings').hidden, true);
    p.close();
  });
}

test('blocked localStorage does not affect the authoritative consent cookie or safe withdrawal', () => {
  const p = page({ blockStorage: true });
  assert.deepEqual(p.network, []);
  p.click('privacy-accept');
  assert.equal(p.pageViews().length, 1);
  p.click('privacy-settings');
  assert.equal(consentValue(p.document).analytics, 'granted');
  assert.doesNotMatch(p.document.getElementById('privacy-choice').textContent, /nie pozwala zapamiętać/);
  p.click('privacy-reject');
  assert.equal(p.commands.at(-1).disabled, true);
  assert.equal(p.reloads().length, 1);
  assert.equal(p.network.length, 1);
  p.close();
});

test('a rejection in another tab revokes this tab without another pageview', () => {
  const p = page({ consent: savedConsent('granted') });
  writeConsent(p.document, savedConsent('denied'));
  p.window.localStorage.setItem(key, savedConsent('denied'));
  p.window.dispatchEvent(new p.window.StorageEvent('storage', { key }));
  assert.equal(p.commands.at(-1).disabled, true);
  assert.equal(p.reloads().length, 1);
  assert.equal(p.pageViews().length, 1);
  assert.equal(p.network.length, 1);
  p.close();
});

test('clearing consent in another tab revokes analytics', () => {
  const p = page({ consent: savedConsent('granted') });
  p.document.cookie = `${cookieKey}=; Max-Age=0; domain=vanly.me; path=/; Secure; SameSite=Lax`;
  p.window.localStorage.clear();
  p.window.dispatchEvent(new p.window.StorageEvent('storage', { key: null }));
  assert.equal(p.commands.at(-1).disabled, true);
  assert.equal(p.reloads().length, 1);
  p.close();
});

test('localStorage write quota failure cannot leave an older acceptance active after withdrawal', () => {
  const p = page({ consent: savedConsent('granted'), blockWrites: true });
  p.click('privacy-settings');
  p.click('privacy-reject');
  assert.equal(consentValue(p.document).analytics, 'denied');
  assert.equal(p.commands.at(-1).disabled, true);
  assert.equal(p.reloads().length, 1);
  p.close();
});

test('legacy localStorage acceptance without the shared cookie never restores analytics', () => {
  const p = page({ legacyConsent: savedConsent('granted') });
  assert.deepEqual(p.network, []);
  assert.equal(p.document.getElementById('privacy-panel').hidden, false);
  p.window.dispatchEvent(new p.window.StorageEvent('storage', { key }));
  assert.deepEqual(p.network, []);
  p.close();
});

test('the shared cookie is authoritative over a conflicting localStorage choice', () => {
  const p = page({ consent: savedConsent('granted'), legacyConsent: savedConsent('denied') });
  assert.equal(p.pageViews().length, 1);
  assert.equal(p.document.getElementById('privacy-panel').hidden, true);
  p.close();
});

test('acceptance and withdrawal are shared by vanly.me and www.vanly.me without resurrecting older acceptance', () => {
  const cookieJar = new CookieJar();
  const apex = page({ cookieJar });
  apex.click('privacy-accept');
  const storedCookie = cookieJar.getCookiesSync('https://vanly.me/').find((cookie) => cookie.key === cookieKey);
  assert.equal(storedCookie.domain, 'vanly.me');
  assert.equal(storedCookie.hostOnly, false);
  assert.equal(storedCookie.path, '/');
  assert.equal(storedCookie.secure, true);
  assert.equal(storedCookie.sameSite, 'lax');
  const www = page({ cookieJar, url: 'https://www.vanly.me/' });
  assert.equal(www.pageViews().length, 1);
  assert.equal(www.document.getElementById('privacy-panel').hidden, true);
  www.click('privacy-settings');
  www.click('privacy-reject');
  assert.equal(www.reloads().length, 1);
  apex.poll();
  assert.equal(apex.commands.at(-1).disabled, true);
  assert.equal(apex.reloads().length, 1);
  const later = page({ cookieJar, legacyConsent: savedConsent('granted') });
  assert.deepEqual(later.network, []);
  assert.equal(later.document.getElementById('privacy-panel').hidden, true);
  assert.equal(consentValue(later.document).analytics, 'denied');
  later.close();
  www.close();
  apex.close();
});

test('returning to an open tab reads a withdrawal made on the other host', () => {
  const cookieJar = new CookieJar();
  const apex = page({ cookieJar });
  apex.click('privacy-accept');
  const www = page({ cookieJar, url: 'https://www.vanly.me/' });
  www.click('privacy-settings');
  www.click('privacy-reject');
  apex.window.dispatchEvent(new apex.window.Event('focus'));
  assert.equal(apex.commands.at(-1).disabled, true);
  assert.equal(apex.reloads().length, 1);
  www.close();
  apex.close();
});

test('blocked cookies permit this visit’s explicit consent but cannot restore it on a later visit', () => {
  const p = page({ blockCookies: true, legacyConsent: savedConsent('granted') });
  assert.deepEqual(p.network, []);
  p.click('privacy-accept');
  p.poll();
  assert.equal(p.pageViews().length, 1);
  assert.equal(p.reloads().length, 0);
  p.click('privacy-settings');
  assert.match(p.document.getElementById('privacy-choice').textContent, /nie pozwala zapamiętać/);
  p.click('privacy-reject');
  assert.equal(p.commands.at(-1).disabled, true);
  assert.equal(p.reloads().length, 1);
  const later = page({ blockCookies: true, legacyConsent: savedConsent('granted') });
  assert.deepEqual(later.network, []);
  later.close();
  p.close();
});

test('six calendar months clamp the last day instead of rolling into a seventh month', () => {
  const cookieJar = new CookieJar();
  const now = Date.UTC(2026, 7, 31, 12, 30);
  const expected = Date.UTC(2027, 1, 28, 12, 30);
  const p = page({ fixedTime: now, cookieJar });
  p.click('privacy-accept');
  assert.equal(consentValue(p.document).savedAt, now);
  assert.equal(consentValue(p.document).expiresAt, expected);
  const cookie = cookieJar.getCookiesSync('https://vanly.me/').find((item) => item.key === cookieKey);
  assert.equal(cookie.maxAge, Math.floor((expected - now) / 1000));
  p.close();
});

test('a newly unwritable consent cookie cannot reactivate old acceptance through an automatic reload', () => {
  const p = page({ consent: savedConsent('granted'), cookieReadOnly: true });
  p.click('privacy-settings');
  p.click('privacy-reject');
  assert.equal(p.commands.at(-1).disabled, true);
  assert.equal(p.reloads().length, 0);
  p.poll();
  assert.equal(p.pageViews().length, 1);
  assert.equal(p.network.length, 1);
  p.close();
});

test('a blocked Google tag leaves privacy settings and the announcement usable', () => {
  const p = page();
  p.click('privacy-accept');
  p.document.getElementById('vanly-ga4').dispatchEvent(new p.window.Event('error'));
  assert.match(p.document.querySelector('h1').textContent, /Więcej drogi/);
  assert.equal(p.document.querySelector('time').getAttribute('datetime'), '2026-10-20');
  p.click('privacy-settings');
  assert.equal(p.document.getElementById('privacy-panel').hidden, false);
  assert.deepEqual(p.errors, []);
  p.close();
});
