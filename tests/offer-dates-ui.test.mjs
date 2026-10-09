import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

// Real offer and public data hook, with deferred API calls and no browser/network.
const requireWeb = createRequire(new URL('../apps/frontoffice/package.json', import.meta.url));
const ts = requireWeb('typescript');
const dom = new JSDOM('<!doctype html><div id="test"></div>', { url: 'https://vanly.test' });
const keys = [
  'window',
  'document',
  'HTMLElement',
  'Element',
  'Node',
  'Event',
  'navigator',
  'IS_REACT_ACT_ENVIRONMENT',
];
const originals = Object.fromEntries(
  keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
for (const key of keys)
  Object.defineProperty(globalThis, key, {
    value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key],
    writable: true,
    configurable: true,
  });
const React = requireWeb('react');
const { act } = React;
const { createRoot } = requireWeb('react-dom/client');
function load(file, overrides = {}) {
  const compiled = ts.transpileModule(
    fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    (name) => {
      if (name in overrides) return overrides[name];
      if (name === 'next/link')
        return ({ children, href, ...props }) =>
          React.createElement('a', { href, ...props }, children);
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      return requireWeb(name);
    },
    module,
    module.exports,
  );
  return module.exports;
}
const shared = load('packages/ui/components/shared.tsx');
const publicData = load('apps/frontoffice/components/shared.tsx', {
  '../../../packages/ui/components/shared': shared,
});
let id, params, app, root, calls;
const { Offer } = load('apps/frontoffice/components/travel/offer.tsx', {
  '../shared': publicData,
  'next/navigation': { useSearchParams: () => params },
  '../../lib/request-id': { createRequestId: () => 'test-request' },
  '../../lib/seo-dates': load('apps/frontoffice/lib/seo-dates.ts'),
  '../../lib/brand': { isHeyvans: false },
  '../PhotoViewer': { PhotoViewer: () => null },
  '../PickupLocation': { pickupAddress: () => 'Gdynia' },
});
const vehicle = (vehicleId = 'coast', available = 4) => ({
  id: vehicleId,
  name: 'Campervan ' + vehicleId,
  company_name: 'Baltic Camp',
  city: 'Gdynia',
  asset: 'campervan.webp',
  tagline: 'W drogę',
  description: 'Opis pojazdu',
  instant: true,
  type: 'campervan',
  seats: 4,
  sleeps: 4,
  auto: true,
  km: 250,
  daily: 42900,
  min_days: 3,
  settings: { minDays: 3, open: '09:00', close: '17:00' },
  features: [],
  comments: [],
  similar: [],
  equipment: [
    { id: 'chair', name: 'Krzesło', excluded_types: [], price: 500, unit: 'day', available },
  ],
});
const quote = (totalMinor = 319300) => ({
  days: 7,
  baseMinor: totalMinor - 19000,
  prepMinor: 19000,
  totalMinor,
  plan: 'full',
  dueNowMinor: totalMinor,
  depositMinor: 400000,
  extras: [],
});
const input = (label) => document.querySelector('input[aria-label="' + label + '"]');
const reserve = () =>
  [...document.querySelectorAll('button')].find((b) =>
    b.textContent.includes('Przejdź do rezerwacji'),
  );
const pending = (path) => calls.filter((call) => call.path.startsWith(path));
async function render() {
  await act(async () =>
    root.render(
      React.createElement(
        shared.Context.Provider,
        { value: app },
        React.createElement(Offer, { id }),
      ),
    ),
  );
}
async function tick() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 180)));
}
async function resolve(call, value) {
  assert.ok(call, 'Expected API request');
  await act(async () => call.resolve(value));
}
async function change(label, value) {
  const element = input(label);
  assert.ok(element, 'Date control must remain accessible: ' + label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(
      element,
      value,
    );
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function start() {
  id = 'coast';
  params = new URLSearchParams('start=2026-10-23&end=2026-10-30&guests=2');
  calls = [];
  app = {
    ready: true,
    today: '2026-10-09',
    user: null,
    initialData: { '/vehicles/coast?start=2026-10-23&end=2026-10-30': vehicle() },
    api: (path, method, body) =>
      new Promise((resolve, reject) => calls.push({ path, method, body, resolve, reject })),
  };
  root = createRoot(document.getElementById('test'));
  await render();
  await resolve(pending('/vehicles/').at(-1), vehicle());
  await tick();
  await resolve(pending('/preview-quote').at(-1), quote());
  assert.equal(reserve().disabled, false);
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
});
after(() => {
  dom.window.close();
  for (const key of keys) {
    if (originals[key]) Object.defineProperty(globalThis, key, originals[key]);
    else delete globalThis[key];
  }
});

test('changing pickup shifts return by the same days and refreshes price and stock together', async () => {
  await start();
  const startControl = input('Odbiór'),
    endControl = input('Zwrot'),
    requestCount = calls.length;
  await change('Odbiór', '2026-11-10');
  await tick();
  assert.equal(input('Odbiór'), startControl);
  assert.equal(input('Zwrot'), endControl);
  assert.equal(startControl.value, '2026-11-10');
  assert.equal(endControl.value, '2026-11-17', 'Preserve the selected seven-day rental');
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.ok(
    calls
      .slice(requestCount)
      .every(
        (call) =>
          call.path === '/vehicles/coast?start=2026-11-10&end=2026-11-17' ||
          (call.path === '/preview-quote' &&
            call.body.start === '2026-11-10' &&
            call.body.end === '2026-11-17'),
      ),
    'Both dates reach the API atomically, without a reversed intermediate term',
  );
  assert.equal(endControl.min, '2026-11-11');
  assert.equal(reserve().disabled, true);
  assert.equal(document.querySelector('select.qty').disabled, true);
  assert.equal(document.querySelector('.bill'), null, 'Old price cannot represent new dates');
  assert.equal(input('Odbiór'), startControl, 'Controls stay mounted while fetching');
  assert.equal(reserve().disabled, true);
  await resolve(pending('/vehicles/').at(-1), vehicle('coast', 2));
  await resolve(pending('/preview-quote').at(-1), quote(400000));
  assert.equal(input('Zwrot'), endControl);
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.equal(reserve().disabled, false);
  assert.equal(document.querySelector('select.qty').options.length, 3);
  assert.match(document.querySelector('.bill-total').textContent, /4000/);
  assert.equal(pending('/preview-quote').at(-1).body.start, '2026-11-10');
  assert.equal(pending('/preview-quote').at(-1).body.end, '2026-11-17');
});

test('pickup shifts work backwards, across daylight saving, month and year boundaries, using a manually edited length', async () => {
  await start();
  await change('Odbiór', '2026-10-20');
  assert.equal(input('Zwrot').value, '2026-10-27');
  await change('Zwrot', '2026-10-31');
  await change('Odbiór', '2026-12-28');
  assert.equal(input('Zwrot').value, '2027-01-08', 'Preserve the manually selected eleven days');
  await change('Odbiór', '2027-02-25');
  assert.equal(input('Zwrot').value, '2027-03-08');
});

test('temporarily clearing pickup retains the chosen duration when a complete date is entered', async () => {
  await start();
  await change('Zwrot', '2026-11-02');
  await change('Odbiór', '');
  assert.equal(input('Zwrot').value, '2026-11-02');
  assert.equal(reserve().disabled, true);
  await change('Odbiór', '2026-11-10');
  assert.equal(input('Zwrot').value, '2026-11-20', 'Preserve ten days after incomplete input');
  assert.equal(document.querySelector('[role="alert"]'), null);
});

test('empty, equal, past and excessive dates are editable without date-dependent API calls', async () => {
  await start();
  for (const [label, value] of [
    ['Zwrot', '2026-10-23'],
    ['Zwrot', ''],
    ['Zwrot', '2027-03-01'],
    ['Odbiór', '2026-10-08'],
  ]) {
    const count = calls.length;
    await change(label, value);
    await tick();
    assert.ok(input('Odbiór'));
    assert.ok(input('Zwrot'));
    assert.ok(document.querySelector('.booking-panel [role="alert"]'));
    assert.equal(reserve().disabled, true);
    assert.ok(calls.slice(count).every((call) => call.path === '/vehicles/coast'));
  }
});

test('late quote responses and failures cannot replace the latest term', async () => {
  await start();
  await change('Zwrot', '2026-10-31');
  await tick();
  const oldQuote = pending('/preview-quote').at(-1),
    oldVehicle = pending('/vehicles/').at(-1);
  await change('Zwrot', '2026-11-01');
  await tick();
  const latestQuote = pending('/preview-quote').at(-1);
  await resolve(pending('/vehicles/').at(-1), vehicle('coast', 1));
  await resolve(latestQuote, quote(450000));
  await resolve(oldVehicle, vehicle('coast', 4));
  await resolve(oldQuote, quote(100));
  assert.match(document.querySelector('.bill-total').textContent, /4500/);
  assert.equal(document.querySelector('select.qty').options.length, 2);
  await change('Zwrot', '2026-11-02');
  await tick();
  const failingQuote = pending('/preview-quote').at(-1);
  await change('Zwrot', '2026-11-03');
  await tick();
  await resolve(pending('/vehicles/').at(-1), vehicle());
  await resolve(pending('/preview-quote').at(-1), quote());
  await act(async () => failingQuote.reject(Error('Stare żądanie')));
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.equal(reserve().disabled, false);
});

test('a stock refresh failure stays beside the form and recovers on another date', async () => {
  await start();
  await change('Zwrot', '2026-10-31');
  await tick();
  await act(async () => pending('/vehicles/').at(-1).reject(Error('Błąd dostępności')));
  await resolve(pending('/preview-quote').at(-1), quote());
  assert.ok(input('Zwrot'));
  assert.match(
    document.querySelector('.booking-panel [role="alert"]').textContent,
    /Błąd dostępności/,
  );
  assert.equal(reserve().disabled, true);
  await change('Zwrot', '2026-11-01');
  await tick();
  await resolve(pending('/vehicles/').at(-1), vehicle());
  await resolve(pending('/preview-quote').at(-1), quote());
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.equal(reserve().disabled, false);
});

test('the cached offer is never shown for a different vehicle', async () => {
  await start();
  id = 'wild';
  await render();
  assert.equal(document.querySelector('h1'), null);
  await resolve(pending('/vehicles/').at(-1), vehicle('wild'));
  assert.equal(document.querySelector('h1').textContent, 'Campervan wild');
});
