import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import * as portalRoutes from '../packages/ui/portal-routes.mjs';

// Offline component tests: no browser, live API, gazetteer or Maps requests.
const webRequire = createRequire(new URL('../apps/frontoffice/package.json', import.meta.url));
const ts = webRequire('typescript');
const dom = new JSDOM('<!doctype html><div id="test"></div>', { url: 'https://vanly.test' });
const globalKeys = [
  'window',
  'document',
  'HTMLElement',
  'HTMLInputElement',
  'Element',
  'Node',
  'Event',
  'KeyboardEvent',
  'MouseEvent',
  'FormData',
  'navigator',
  'IS_REACT_ACT_ENVIRONMENT',
];
const previousGlobals = Object.fromEntries(
  globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
for (const key of globalKeys)
  Object.defineProperty(globalThis, key, {
    value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key],
    configurable: true,
    writable: true,
  });
const React = webRequire('react');
const { createRoot } = webRequire('react-dom/client');
const { act } = React;
let root, state;
const locality = {
  id: 'test-gmina',
  name: 'Nowa Wieś',
  label: 'Nowa Wieś · gmina Testowa',
  lat: 52.1,
  lng: 20.2,
};
const api = async (path, method, body) => {
  state.requests.push({ path, method, body });
  if (path.startsWith('/localities?')) {
    if (state.deferred)
      return new Promise((resolve, reject) => state.pending.push({ path, resolve, reject }));
    if (state.searchError) throw Error('Podpowiedzi są chwilowo niedostępne.');
    return state.localities;
  }
  if (path.endsWith('/photo') && state.failPhotoOnce) {
    state.failPhotoOnce = false;
    throw Error('Test photo failure');
  }
  if (path === '/owner/vehicles' && state.deferVehicle)
    return new Promise((resolve, reject) => state.pending.push({ path, resolve, reject }));
  return { id: state.vehicle?.id || 'saved-vehicle' };
};
const context = () => ({
  user: state.user,
  brand: { id: 'vanly', name: 'Vanly' },
  api,
  act: async (fn) => {
    try {
      return await fn();
    } catch (error) {
      state.errors.push(error.message);
    }
  },
  navigate: (path) => state.destinations.push(path),
  session: async () => {
    state.sessions++;
    return { ...state.user, role: 'owner' };
  },
});
const link = ({ href, children, ...props }) =>
  React.createElement('a', { href, ...props }, children);
let shared, pickup;
const modules = new Map();
function componentRequire(name, parentFile) {
  if (name.endsWith('/portal-routes.mjs')) return portalRoutes;
  if (/\/shared$/.test(name)) return shared;
  if (/\/PickupLocation$/.test(name)) return pickup;
  if (/\/Account$/.test(name))
    return {
      Require: ({ children }) => React.createElement(React.Fragment, null, children),
      Booking: () => null,
      Messages: () => null,
    };
  if (/\/Stock$/.test(name)) return { Stock: () => null };
  if (name === 'next/link') return link;
  if (name === 'next/navigation') return { useSearchParams: () => new URLSearchParams() };
  if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
  if (name.endsWith('/lib/brand'))
    return { brand: { id: 'vanly', name: 'Vanly' }, isCamperfolks: false, isHeyvans: false };
  if (name.endsWith('/lib/request-id')) return { createRequestId: () => 'test-request' };
  if (
    name.endsWith('/lib/seo-dates') ||
    name.endsWith('/lib/guide-metadata.json') ||
    name.endsWith('.css')
  )
    return {};
  if (['HeyvansHome', 'ArticleText', 'PhotoViewer'].some((file) => name.endsWith('/' + file)))
    return new Proxy({}, { get: () => () => null });
  if (name.startsWith('.')) {
    const base = path.resolve(path.dirname(parentFile), name);
    const resolved = [base + '.tsx', base + '.ts', base + '/index.tsx'].find((file) =>
      fs.existsSync(file),
    );
    if (resolved) return load(resolved);
  }
  return webRequire(name);
}
function load(relative) {
  const file = path.isAbsolute(relative)
    ? relative
    : fileURLToPath(new URL(relative, import.meta.url));
  if (modules.has(file)) return modules.get(file).exports;
  const source = fs.readFileSync(file, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  modules.set(file, module);
  new Function('require', 'module', 'exports', compiled)(
    (name) => componentRequire(name, file),
    module,
    module.exports,
  );
  return module.exports;
}
shared = load('../packages/ui/components/shared.tsx');
shared.useApp = context;
shared.useData = () => ({
  data: state.dashboard,
  error: null,
  reload: () => state.reloads++,
});
pickup = load('../packages/ui/components/PickupLocation.tsx');
const { LocalityInput } = pickup;
const { Business } = load('../packages/ui/components/Backoffice.tsx');
const { CompanyOnboarding } = load('../apps/frontoffice/components/Travel.tsx');

function LocalityProbe() {
  const [value, setValue] = React.useState(state.value);
  return React.createElement(LocalityInput, {
    value,
    name: 'city',
    required: true,
    ariaLabel: 'Miejscowość odbioru',
    onChange: (text, selected) => {
      state.changes.push({ text, selected });
      setValue(text);
    },
  });
}
async function start(overrides = {}) {
  state = {
    view: 'locality',
    value: '',
    localities: [locality],
    deferred: false,
    requests: [],
    errors: [],
    pending: [],
    changes: [],
    destinations: [],
    sessions: 0,
    reloads: 0,
    user: { id: 'test-user', role: 'traveler', name: 'Test', email: 'test@example.test' },
    ...overrides,
  };
  state.dashboard = {
    company: {
      name: 'Testowa wypożyczalnia',
      city: 'Gdynia',
      lat: 54.5189,
      lng: 18.5305,
      verified: true,
      settings: { prep: 19000 },
    },
    vehicles: state.vehicle ? [state.vehicle] : [],
    bookings: [],
    blocks: [],
    tasks: [],
    team: [],
    seasons: [],
  };
  root = createRoot(document.getElementById('test'));
  const component =
    state.view === 'onboarding'
      ? React.createElement(CompanyOnboarding)
      : state.view === 'fleet'
        ? React.createElement(Business, { tab: 'pojazd', id: state.vehicleId || state.vehicle?.id })
        : state.view === 'calendar'
          ? React.createElement(Business, { tab: 'kalendarz' })
          : React.createElement(LocalityProbe);
  await act(async () => root.render(React.createElement(React.StrictMode, null, component)));
}
const combobox = () => {
  const input = document.querySelector('[role="combobox"]');
  assert.ok(input, 'Pickup locality must be an accessible combobox');
  return input;
};
async function change(input, value) {
  const prototype =
    input.tagName === 'TEXTAREA'
      ? dom.window.HTMLTextAreaElement.prototype
      : dom.window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function type(value) {
  const input = combobox();
  await act(async () => input.focus());
  await change(input, value);
}
async function waitSuggestions() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
}
async function key(value) {
  await act(async () =>
    combobox().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}
async function submit() {
  const form = document.querySelector('form');
  assert.ok(form);
  await act(async () =>
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
});
after(() => {
  dom.window.close();
  for (const key of globalKeys) {
    if (previousGlobals[key]) Object.defineProperty(globalThis, key, previousGlobals[key]);
    else delete globalThis[key];
  }
});

test('locality accepts free text and removes the selected location when typing resumes', async () => {
  await start();
  await type('Nowa');
  await waitSuggestions();
  assert.match(document.querySelector('[role="listbox"]').textContent, /gmina Testowa/);
  await key('ArrowDown');
  await key('Enter');
  assert.equal(combobox().value, locality.name);
  assert.deepEqual(state.changes.at(-1), { text: locality.name, selected: locality });
  await type('Osada wpisana ręcznie');
  assert.equal(combobox().value, 'Osada wpisana ręcznie');
  assert.deepEqual(state.changes.at(-1), { text: 'Osada wpisana ręcznie', selected: undefined });
  await key('Escape');
  assert.equal(combobox().value, 'Osada wpisana ręcznie');
});

test('autocomplete ignores delayed results from an earlier locality query', async () => {
  await start({ deferred: true });
  await type('Nowa');
  await waitSuggestions();
  const oldRequest = state.pending.at(-1);
  assert.ok(oldRequest.path.includes('Nowa'));
  await type('Stara');
  await waitSuggestions();
  const newRequest = state.pending.at(-1);
  assert.ok(newRequest.path.includes('Stara'));
  const fresh = { ...locality, id: 'fresh', name: 'Stara Wieś', label: 'Stara Wieś · gmina Nowa' };
  await act(async () => newRequest.resolve([fresh]));
  await act(async () => oldRequest.resolve([locality]));
  const options = [...document.querySelectorAll('[role="option"]')];
  assert.equal(options.length, 1);
  assert.match(options[0].textContent, /Stara Wieś/);
  await key('ArrowDown');
  await key('Enter');
  assert.equal(state.changes.at(-1).selected.id, 'fresh');
});

test('unavailable autocomplete still permits a custom locality', async () => {
  await start({ searchError: true });
  await type('Dowolna gmina');
  await waitSuggestions();
  assert.equal(combobox().value, 'Dowolna gmina');
  assert.equal(state.changes.at(-1).selected, undefined);
  assert.equal(document.querySelectorAll('[role="option"]').length, 0);
});

test('company registration asks only for the company name and sends no pickup', async () => {
  await start({ view: 'onboarding' });
  const form = document.querySelector('form');
  const inputs = [...form.querySelectorAll('input, select, textarea')];
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].required, true);
  await change(inputs[0], 'Moja nowa wypożyczalnia');
  await submit();
  assert.deepEqual(state.requests, [
    {
      path: '/company-onboarding',
      method: 'POST',
      body: { name: 'Moja nowa wypożyczalnia' },
    },
  ]);
  assert.equal(state.sessions, 1);
});

test('new fleet vehicle starts with no pickup and saves custom locality with optional address', async () => {
  await start({ view: 'fleet' });
  assert.equal(combobox().value, '', 'New pickup must not inherit company headquarters');
  assert.equal(document.querySelector('input[name="lat"]:not([type="hidden"])'), null);
  assert.equal(document.querySelector('input[name="lng"]:not([type="hidden"])'), null);
  const street = document.querySelector('input[name="street"]');
  const number = document.querySelector('input[name="house_number"]');
  assert.ok(street);
  assert.ok(number);
  assert.equal(street.required, false);
  assert.equal(number.required, false);
  await change(document.querySelector('input[name="name"]'), 'Mój nowy kamper');
  await change(
    document.querySelector('textarea[name="description"]'),
    'Wygodny kamper na spokojny wyjazd.',
  );
  await type('Moja własna gmina');
  await change(street, 'Leśna');
  await change(number, '12A/3');
  await submit();
  const saved = state.requests.find((request) => request.path === '/owner/vehicles');
  assert.ok(saved);
  assert.equal(saved.method, 'POST');
  assert.equal(saved.body.city, 'Moja własna gmina');
  assert.equal(saved.body.street, 'Leśna');
  assert.equal(saved.body.house_number, '12A/3');
  assert.equal(saved.body.lat, null);
  assert.equal(saved.body.lng, null);
  assert.deepEqual(state.destinations, ['/company/fleet']);
});

test('fleet edit keeps chosen coordinates for address changes and clears them for a new free-text locality', async () => {
  await start({
    view: 'fleet',
    vehicle: {
      id: 'existing-vehicle',
      name: 'Gotowy kamper',
      type: 'campervan',
      city: 'Nowa Wieś',
      lat: 52.1,
      lng: 20.2,
      street: 'Letnia',
      house_number: '5',
      seats: 4,
      sleeps: 4,
      daily: 50000,
      prep: 19000,
      deposit: 100000,
      min_days: 2,
      km: null,
      auto: false,
      pets: false,
      instant: true,
      description: 'Gotowy kamper na wyjazd.',
      tagline: '',
      features: [],
      asset: 'campervan.webp',
      status: 'draft',
    },
  });
  await change(document.querySelector('input[name="street"]'), 'Zmieniona');
  await submit();
  let saved = state.requests.filter((request) => request.method === 'PATCH').at(-1);
  assert.equal(saved.body.lat, 52.1);
  assert.equal(saved.body.lng, 20.2);
  assert.equal(saved.body.street, 'Zmieniona');
  await type('Nowe miejsce ręczne');
  await submit();
  saved = state.requests.filter((request) => request.method === 'PATCH').at(-1);
  assert.equal(saved.body.city, 'Nowe miejsce ręczne');
  assert.equal(saved.body.lat, null);
  assert.equal(saved.body.lng, null);
});

test('retrying a failed photo upload updates the already created vehicle instead of duplicating it', async () => {
  await start({ view: 'fleet', failPhotoOnce: true });
  await change(document.querySelector('input[name="name"]'), 'Mój nowy kamper');
  await change(document.querySelector('textarea[name="description"]'), 'Wygodny kamper na wyjazd.');
  await type('Moja gmina');
  const photo = document.querySelector('input[type="file"]');
  Object.defineProperty(photo, 'files', {
    configurable: true,
    value: [new dom.window.File(['photo'], 'photo.png', { type: 'image/png' })],
  });
  await act(async () => photo.dispatchEvent(new Event('change', { bubbles: true })));
  await submit();
  assert.match(state.errors[0], /Dane pojazdu zapisane/);
  assert.deepEqual(state.destinations, []);
  assert.equal(state.reloads, 0);
  await submit();
  const saves = state.requests.filter(
    (request) => request.path.startsWith('/owner/vehicles') && !request.path.endsWith('/photo'),
  );
  assert.deepEqual(
    saves.map(({ path, method }) => ({ path, method })),
    [
      { path: '/owner/vehicles', method: 'POST' },
      { path: '/owner/vehicles/saved-vehicle', method: 'PATCH' },
    ],
  );
  assert.deepEqual(state.destinations, ['/company/fleet']);
  assert.equal(state.reloads, 1);
});

test('vehicle creation ignores duplicate form submissions while its first save is pending', async () => {
  await start({ view: 'fleet', deferVehicle: true });
  const form = document.querySelector('form');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.equal(state.requests.filter((request) => request.path === '/owner/vehicles').length, 1);
  await act(async () => state.pending[0].resolve({ id: 'saved-vehicle' }));
  assert.equal(state.reloads, 1);
  assert.deepEqual(state.destinations, ['/company/fleet']);
});

test('an unavailable vehicle edit never renders a new-vehicle form', async () => {
  await start({ view: 'fleet', vehicleId: 'foreign-or-missing-vehicle' });
  assert.equal(document.querySelector('form'), null);
  assert.match(document.body.textContent, /Nie znaleźliśmy tego pojazdu w Twojej flocie/);
  assert.deepEqual(state.requests, []);
});

test('clearing the calendar start date preserves a valid calendar instead of crashing', async () => {
  await start({ view: 'calendar' });
  const input = document.querySelector('input[aria-label="Początek kalendarza"]');
  const original = input.value;
  await change(input, '');
  assert.equal(input.value, original);
  assert.equal(document.querySelectorAll('.fleet-calendar thead th').length, 29);
});
