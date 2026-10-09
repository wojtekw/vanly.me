import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

// Exercise the real shared data hook in a local DOM, without a browser or network.
const ownerRequire = createRequire(new URL('../apps/owner/package.json', import.meta.url));
const ts = ownerRequire('typescript');
const dom = new JSDOM('<!doctype html><html><body><div id="test"></div></body></html>');
const globalKeys = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'FormData', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'];
const previousGlobals = Object.fromEntries(globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const key of globalKeys) Object.defineProperty(globalThis, key, {
  value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key],
  configurable: true, writable: true,
});
// JSDOM does not implement native modal opening, closing, or blob previews.
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const previousObjectUrls = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
let previewSequence = 0;
URL.createObjectURL = (file) => {
  const url = 'blob:stock-test-' + ++previewSequence;
  state.previewUrls.push({ url, name: file.name });
  return url;
};
URL.revokeObjectURL = (url) => { state.revokedUrls.push(url); };
const React = ownerRequire('react');
const { createRoot } = ownerRequire('react-dom/client');
const { act } = React;
let root, state;

function compile(relative, overrides = {}) {
  const source = fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const require = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name === 'next/link')
      return ({ children, href }) => React.createElement('a', { href }, children);
    return ownerRequire(name);
  };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  return module.exports;
}
const reservationStatuses = compile('../packages/ui/lib/reservation-status.ts');
const shared = compile('../packages/ui/components/shared.tsx', { '../lib/reservation-status': reservationStatuses });
const { Stock } = compile('../packages/ui/components/Stock.tsx', { './shared': shared });
const fleet = [
  { id: 'camper-a', name: 'Campervan Bursztyn', type: 'campervan', status: 'published' },
  { id: 'camper-b', name: 'Campervan Łąka', type: 'campervan', status: 'published' },
  { id: 'trailer', name: 'Przyczepa Sosna', type: 'trailer', status: 'draft' },
];
const copy = (value) => structuredClone(value);
const row = (overrides = {}) => ({
  id: 'chair',
  name: 'Krzesło turystyczne',
  quantity: 6,
  available: 4,
  reserved: 2,
  minimum_quantity: 2,
  price: 1500,
  unit: 'trip',
  vehicle_ids: ['camper-a'],
  active: true,
  photos: [],
  ...overrides,
});
const api = async (path, method = 'GET', body) => {
  const recordedBody = body instanceof FormData
    ? { files: [...body.entries()].map(([key, file]) => ({ key, name: file.name, type: file.type, size: file.size })) }
    : body === undefined ? undefined : copy(body);
  state.calls.push({ path, method, ...(recordedBody === undefined ? {} : { body: recordedBody }) });
  if (method === 'GET') {
    if (state.failReads > 0) {
      state.failReads--;
      throw Error('Nie udało się pobrać magazynu.');
    }
    return copy(state.rows);
  }
  if (state.deferWrites) await new Promise((resolve) => state.pendingWrites.push(resolve));
  if (state.failWrites > 0) {
    state.failWrites--;
    throw Error('Stan magazynu zmienił się. Spróbuj ponownie.');
  }
  const photoPath = path.match(/^\/owner\/stock\/([^/]+)\/photos(?:\/([^/]+))?$/);
  if (photoPath) {
    const saved = state.rows.find((item) => item.id === photoPath[1]);
    assert.ok(saved, 'Photo mutation must address an existing equipment item');
    if (method === 'DELETE') {
      assert.ok(saved.photos.some((photo) => photo.id === photoPath[2]), 'Deleted photo must belong to the item');
      saved.photos = saved.photos.filter((photo) => photo.id !== photoPath[2]);
      return { ok: true };
    }
    assert.equal(method, 'POST');
    assert.ok(body instanceof FormData, 'Photo upload must use multipart form data');
    state.uploadAttempts++;
    if (state.failUploadAttempts.includes(state.uploadAttempts)) throw Error('Nie udało się wgrać zdjęcia.');
    const uploaded = { id: 'photo-' + state.uploadAttempts, asset: '/media/photo-' + state.uploadAttempts + '.webp' };
    saved.photos.push(uploaded);
    return copy(uploaded);
  }
  const saved = method === 'POST'
    ? row({ id: 'new-stock', reserved: 0, minimum_quantity: 0 })
    : state.rows.find((item) => path === '/owner/stock/' + item.id);
  assert.ok(saved, 'Mutation must address an existing item or create a new one');
  for (const [key, value] of Object.entries(body))
    saved[key === 'vehicleIds' ? 'vehicle_ids' : key] = copy(value);
  saved.available = saved.quantity - saved.reserved;
  if (method === 'POST') state.rows.push(saved);
  return copy(saved);
};
const tick = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});
async function start(overrides = {}) {
  state = { rows: [], vehicles: copy(fleet), calls: [], failWrites: 0, failReads: 0, deferWrites: false, pendingWrites: [],
    uploadAttempts: 0, failUploadAttempts: [], previewUrls: [], revokedUrls: [], ...overrides };
  root = createRoot(document.getElementById('test'));
  await act(async () => root.render(
    React.createElement(React.StrictMode, null,
      React.createElement(shared.Context.Provider, { value: { api } }, React.createElement(Stock, { vehicles: state.vehicles }))),
  ));
  await tick();
}
const writes = () => state.calls.filter((call) => call.method !== 'GET');
const reads = () => state.calls.filter((call) => call.method === 'GET');
const editor = () => document.querySelector('.stock-editor');
const items = () => [...document.querySelectorAll('.stock-item')].map((item) => item.getAttribute('aria-label'));
const field = (name) => document.querySelector(`[name="${name}"]`);
async function click(button) {
  assert.ok(button, 'Button must exist');
  assert.equal(button.disabled, false, 'Button must be enabled');
  await act(async () => { button.focus(); button.click(); });
  await tick();
}
const clickText = (text) => click([...document.querySelectorAll('button')].find((button) => button.textContent.trim() === text));
const clickLabel = (label) => click(document.querySelector(`button[aria-label="${label}"]`));
const filter = (label) => click([...document.querySelectorAll('.stock-filters button')].find((button) => button.textContent.trim().startsWith(label)));
async function input(element, value) {
  assert.ok(element, 'Input must exist');
  const prototype = element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await tick();
}
async function check(vehicleId, value) {
  const checkbox = document.querySelector(`input[name="vehicleIds"][value="${vehicleId}"]`);
  assert.ok(checkbox, 'Vehicle checkbox must exist: ' + vehicleId);
  if (checkbox.checked !== value) await act(async () => checkbox.click());
}
async function submit(form) {
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await tick();
}
const photoInput = () => document.querySelector('[aria-label="Wybierz zdjęcia wyposażenia"]');
const photo = (name, type = 'image/jpeg', size) => {
  const file = new dom.window.File(['photo bytes'], name, { type });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  return file;
};
async function choosePhotos(files) {
  const input = photoInput();
  assert.ok(input, 'Equipment photo picker must exist');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await tick();
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
});
after(() => {
  dom.window.close();
  URL.createObjectURL = previousObjectUrls.create;
  URL.revokeObjectURL = previousObjectUrls.revoke;
  for (const key of globalKeys) {
    if (previousGlobals[key]) Object.defineProperty(globalThis, key, previousGlobals[key]);
    else delete globalThis[key];
  }
});

test('empty warehouse explains the first addition and opens an accessible, focused form', async () => {
  await start();
  assert.match(document.body.textContent, /Zacznij od pierwszego dodatku/);
  assert.equal(editor(), null);
  await clickText('Dodaj pierwsze wyposażenie');
  assert.ok(editor());
  assert.equal(document.querySelector('dialog').open, true);
  assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(editor().getAttribute('aria-labelledby'), 'stock-editor-title');
  assert.equal(document.activeElement, field('name'));
  assert.equal(field('name').getAttribute('aria-label'), 'Nazwa wyposażenia');
  assert.equal(field('quantity').value, '1');
  assert.equal(field('quantity').min, '0');
  assert.equal(field('price').value, '0');
  assert.equal(field('unit').value, 'trip');
  assert.deepEqual([...document.querySelectorAll('[name="vehicleIds"]')].map((input) => input.value), fleet.map((vehicle) => vehicle.id));
  assert.deepEqual([...document.querySelectorAll('[name="vehicleIds"]')].filter((input) => input.checked), []);
  await clickText('Anuluj');
  assert.equal(editor(), null);
  assert.equal(document.body.style.overflow, '');
  assert.equal(document.activeElement.textContent.trim(), 'Dodaj pierwsze wyposażenie');
  assert.deepEqual(writes(), []);
});

test('addition sends trimmed name, integer grosz, quantity, billing unit, and one specific vehicle among two of the same type', async () => {
  await start();
  const readsBefore = reads().length;
  await clickText('Dodaj wyposażenie');
  await input(field('name'), '  Łóżko składane  ');
  await input(field('quantity'), '3');
  await input(field('price'), '19.99');
  await input(field('unit'), 'day');
  await check('camper-a', true);
  assert.equal(document.querySelector('[name="vehicleIds"][value="camper-b"]').checked, false, 'Another campervan must remain unassigned');
  await clickText('Dodaj do magazynu');
  assert.deepEqual(writes(), [{ path: '/owner/stock', method: 'POST', body: {
    name: 'Łóżko składane', quantity: 3, price: 1999, unit: 'day', vehicleIds: ['camper-a'],
  } }]);
  assert.equal(editor(), null);
  assert.ok(reads().length > readsBefore, 'Successful mutation must reload real useData');
  assert.deepEqual(items(), ['Łóżko składane']);
  assert.match(document.body.textContent, /Wyposażenie dodane/);
  assert.match(document.querySelector('.stock-item').textContent, /3 dostępnych/);
  assert.match(document.querySelector('.stock-item').textContent, /za dobę/);
  assert.equal(document.querySelector('.stock-item-name p').textContent, 'Campervan Bursztyn');
  assert.doesNotMatch(document.querySelector('.stock-item-name p').textContent, /Campervan Łąka/);
});

test('save failure preserves entered values and selected vehicles, shows an inline error, and permits retry', async () => {
  await start({ failWrites: 1 });
  const readsBefore = reads().length;
  await clickText('Dodaj wyposażenie');
  await input(field('name'), 'Stół kempingowy');
  await input(field('quantity'), '0');
  await input(field('price'), '10.05');
  await input(field('unit'), 'day');
  await check('camper-b', true);
  await clickText('Dodaj do magazynu');
  assert.ok(editor());
  assert.equal(field('name').value, 'Stół kempingowy');
  assert.equal(field('quantity').value, '0');
  assert.equal(field('price').value, '10.05');
  assert.equal(field('unit').value, 'day');
  assert.equal(document.querySelector('[name="vehicleIds"][value="camper-b"]').checked, true);
  assert.equal(document.querySelector('[name="vehicleIds"][value="camper-a"]').checked, false);
  assert.match(editor().querySelector('[role="alert"]').textContent, /Stan magazynu zmienił się/);
  assert.equal(reads().length, readsBefore, 'Failed save must not reload and discard the form');
  assert.equal(writes().length, 1);
  await clickText('Dodaj do magazynu');
  assert.equal(writes().length, 2);
  assert.deepEqual(writes()[0].body, writes()[1].body);
  assert.equal(editor(), null);
  assert.match(document.querySelector('.stock-item').textContent, /Brak na stanie/);
});

test('editing preloads the record and enforces booked stock minimum before sending a PATCH', async () => {
  await start({ rows: [row({ minimum_quantity: 4, vehicle_ids: ['camper-b'], unit: 'day' })] });
  await clickLabel('Edytuj Krzesło turystyczne');
  assert.equal(field('name').value, 'Krzesło turystyczne');
  assert.equal(field('quantity').value, '6');
  assert.equal(field('quantity').min, '4');
  assert.equal(field('price').value, '15');
  assert.equal(field('unit').value, 'day');
  assert.equal(document.querySelector('[name="vehicleIds"][value="camper-b"]').checked, true);
  assert.equal(document.querySelector('[name="vehicleIds"][value="camper-a"]').checked, false);
  assert.match(editor().textContent, /co najmniej 4 szt/);
  await input(field('quantity'), '3');
  assert.equal(field('quantity').validity.rangeUnderflow, true);
  await clickText('Zapisz zmiany');
  assert.deepEqual(writes(), [], 'Browser form validation must stop quantity below existing bookings');
  await input(field('quantity'), '7');
  await input(field('price'), '25.05');
  await input(field('unit'), 'trip');
  await clickText('Zapisz zmiany');
  assert.deepEqual(writes(), [{ path: '/owner/stock/chair', method: 'PATCH', body: {
    name: 'Krzesło turystyczne', quantity: 7, price: 2505, unit: 'trip', vehicleIds: ['camper-b'],
  } }]);
  assert.equal(editor(), null);
  assert.match(document.body.textContent, /Zmiany wyposażenia zapisane/);
});

test('blank or one-character trimmed equipment names never save', async () => {
  await start();
  await clickText('Dodaj wyposażenie');
  for (const value of ['   ', '  x  ']) {
    await input(field('name'), value);
    await submit(editor());
    assert.match(editor().querySelector('[role="alert"]').textContent, /co najmniej 2 znaki/);
  }
  assert.deepEqual(writes(), []);
});

test('vehicle search preserves selected IDs even when the selected checkboxes are hidden at save time', async () => {
  await start();
  await clickText('Dodaj wyposażenie');
  await input(field('name'), 'Grill');
  await check('camper-a', true);
  const search = document.querySelector('[aria-label="Szukaj pojazdu"]');
  await input(search, '  LAKA  ');
  assert.equal(document.querySelector('[name="vehicleIds"][value="camper-a"]'), null);
  assert.equal(document.querySelector('[name="vehicleIds"][value="camper-b"]').checked, false);
  await check('camper-b', true);
  await input(search, 'Nieistniejący pojazd');
  assert.equal(document.querySelectorAll('[name="vehicleIds"]').length, 0);
  assert.match(editor().textContent, /Nie znaleźliśmy pojazdu/);
  assert.match(editor().querySelector('.stock-vehicles [role="status"]').textContent, /Wybrano 2 z 3 pojazdów/);
  await input(search, '');
  assert.equal(document.querySelector('[name="vehicleIds"][value="camper-a"]').checked, true);
  assert.equal(document.querySelector('[name="vehicleIds"][value="camper-b"]').checked, true);
  assert.equal(document.querySelector('[name="vehicleIds"][value="trailer"]').checked, false);
  await input(search, 'Nieistniejący pojazd');
  await clickText('Dodaj do magazynu');
  assert.deepEqual(writes()[0].body.vehicleIds, ['camper-a', 'camper-b']);
  assert.equal(document.querySelector('.stock-item-name p').textContent, 'Campervan Bursztyn · Campervan Łąka');
});

test('bulk selection targets the current fleet including hidden search results and clearing removes every assignment', async () => {
  await start();
  await clickText('Dodaj wyposażenie');
  await input(field('name'), 'Stół');
  const search = document.querySelector('[aria-label="Szukaj pojazdu"]');
  await input(search, 'Łąka');
  await clickText('Zaznacz całą flotę');
  assert.equal(document.querySelector('[name="vehicleIds"][value="camper-b"]').checked, true);
  assert.match(editor().querySelector('.stock-vehicles [role="status"]').textContent, /Wybrano 3 z 3 pojazdów/);
  await clickText('Odznacz wszystkie');
  assert.equal(document.querySelector('[name="vehicleIds"][value="camper-b"]').checked, false);
  assert.match(editor().querySelector('.stock-vehicles [role="status"]').textContent, /Wybrano 0 z 3 pojazdów/);
  await input(search, '');
  assert.equal([...document.querySelectorAll('[name="vehicleIds"]')].some((input) => input.checked), false);
  await input(search, 'Łąka');
  await clickText('Zaznacz całą flotę');
  await clickText('Dodaj do magazynu');
  assert.deepEqual(writes()[0].body.vehicleIds, fleet.map((vehicle) => vehicle.id));
  assert.equal(document.querySelector('.stock-item-name p').textContent, 'Campervan Bursztyn · Campervan Łąka · Przyczepa Sosna');
});

test('a fleet without selected vehicles can save warehouse equipment without offering it for bookings', async () => {
  await start();
  await clickText('Dodaj wyposażenie');
  assert.match(editor().querySelector('.stock-unassigned-note').textContent, /nie pojawi się przy nowych rezerwacjach/);
  await input(field('name'), 'Grill');
  await clickText('Dodaj do magazynu');
  assert.deepEqual(writes()[0].body.vehicleIds, []);
  assert.equal(document.querySelector('.stock-item-name .pill').textContent, 'Nieprzypisane');
  assert.equal(document.querySelector('.stock-item-name p').textContent, 'Brak przypisanych pojazdów');
  assert.match(document.querySelector('.stock-page > [role="status"]').textContent, /Przypisz pojazdy/);
});

test('an empty fleet still permits creating equipment and explains how to add a vehicle later', async () => {
  await start({ vehicles: [] });
  await clickText('Dodaj pierwsze wyposażenie');
  assert.equal(document.querySelectorAll('[name="vehicleIds"]').length, 0);
  assert.match(editor().textContent, /W Twojej flocie nie ma jeszcze pojazdów/);
  assert.equal(editor().querySelector('a').getAttribute('href'), '/company/fleet');
  await input(field('name'), 'Fotelik dziecięcy');
  await clickText('Dodaj do magazynu');
  assert.deepEqual(writes()[0].body.vehicleIds, []);
  assert.deepEqual(items(), ['Fotelik dziecięcy']);
  assert.equal(document.querySelector('.stock-item-name .pill').textContent, 'Nieprzypisane');
  await clickLabel('Edytuj Fotelik dziecięcy');
  assert.equal(document.querySelectorAll('[name="vehicleIds"]').length, 0);
  await clickText('Zapisz zmiany');
  assert.equal(writes()[1].method, 'PATCH');
  assert.deepEqual(writes()[1].body.vehicleIds, []);
});

test('editing can remove existing vehicle assignments while keeping the stock active', async () => {
  await start({ rows: [row({ vehicle_ids: ['camper-b', 'trailer'] })] });
  assert.equal(document.querySelector('.stock-item-name p').textContent, 'Campervan Łąka · Przyczepa Sosna');
  await clickLabel('Edytuj Krzesło turystyczne');
  assert.equal(document.querySelector('[name="vehicleIds"][value="camper-b"]').checked, true);
  assert.equal(document.querySelector('[name="vehicleIds"][value="trailer"]').checked, true);
  assert.equal(document.querySelector('[name="vehicleIds"][value="camper-a"]').checked, false);
  await clickText('Odznacz wszystkie');
  await clickText('Zapisz zmiany');
  assert.equal(writes()[0].method, 'PATCH');
  assert.deepEqual(writes()[0].body.vehicleIds, []);
  assert.equal(Object.hasOwn(writes()[0].body, 'active'), false);
  assert.equal(state.rows[0].active, true);
  assert.equal(document.querySelector('.stock-item-name .pill').textContent, 'Nieprzypisane');
});

test('numeric controls block invalid stock and prices and accept the documented upper limits', async () => {
  await start();
  await clickText('Dodaj wyposażenie');
  await input(field('name'), 'Grill');
  for (const [name, value, violation] of [
    ['quantity', '-1', 'rangeUnderflow'],
    ['quantity', '1001', 'rangeOverflow'],
    ['quantity', '1.5', 'stepMismatch'],
    ['price', '-0.01', 'rangeUnderflow'],
    ['price', '10000.01', 'rangeOverflow'],
    ['price', '0.001', 'stepMismatch'],
  ]) {
    await input(field('quantity'), '1');
    await input(field('price'), '0');
    await input(field(name), value);
    assert.equal(field(name).validity[violation], true, `${name} ${value} should violate ${violation}`);
    await clickText('Dodaj do magazynu');
    assert.deepEqual(writes(), [], `Invalid ${name} must not reach the API`);
  }
  await input(field('quantity'), '1000');
  await input(field('price'), '10000');
  await clickText('Dodaj do magazynu');
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].body.quantity, 1000);
  assert.equal(writes()[0].body.price, 1_000_000);
});

test('search ignores Polish diacritics and filters distinguish active, unavailable, and archived equipment', async () => {
  await start({ rows: [
    row({ id: 'bed', name: 'Łóżko składane' }),
    row({ id: 'seat', name: 'Fotelik dziecięcy', quantity: 2, available: 0, reserved: 2 }),
    row({ id: 'grill', name: 'Grill', active: false }),
  ] });
  assert.deepEqual(items(), ['Łóżko składane', 'Fotelik dziecięcy']);
  const search = document.querySelector('[aria-label="Szukaj wyposażenia"]');
  await input(search, '  LOZKO  ');
  assert.deepEqual(items(), ['Łóżko składane']);
  await input(search, 'DZIECIĘCY');
  assert.deepEqual(items(), ['Fotelik dziecięcy']);
  await input(search, '');
  await filter('Brak dostępności');
  assert.deepEqual(items(), ['Fotelik dziecięcy']);
  assert.match(document.querySelector('.stock-item').textContent, /Zarezerwowane/);
  await filter('Archiwum');
  assert.deepEqual(items(), ['Grill']);
  assert.match(document.querySelector('.stock-item').textContent, /W archiwum/);
  await filter('Wszystkie');
  assert.deepEqual(items(), ['Łóżko składane', 'Fotelik dziecięcy', 'Grill']);
  await input(search, 'Nieistniejąca pozycja');
  assert.deepEqual(items(), []);
  assert.match(document.body.textContent, /Nie znaleźliśmy wyposażenia/);
  await clickText('Pokaż aktywne wyposażenie');
  assert.deepEqual(items(), ['Łóżko składane', 'Fotelik dziecięcy']);
  assert.equal(search.value, '');
});

test('archive requires confirmation; archive and restore submit only the active flag and reload the list', async () => {
  await start({ rows: [row()] });
  await clickLabel('Archiwizuj Krzesło turystyczne');
  assert.ok(document.querySelector('[aria-label="Archiwizacja Krzesło turystyczne"]'));
  assert.deepEqual(writes(), [], 'Opening the confirmation must not archive immediately');
  await clickText('Anuluj');
  assert.equal(document.querySelector('.stock-archive-confirm'), null);
  assert.deepEqual(writes(), []);
  await clickLabel('Archiwizuj Krzesło turystyczne');
  await clickText('Archiwizuj wyposażenie');
  assert.deepEqual(writes(), [{ path: '/owner/stock/chair', method: 'PATCH', body: { active: false } }]);
  assert.deepEqual(items(), []);
  assert.equal(state.rows[0].quantity, 6);
  assert.equal(state.rows[0].price, 1500);
  assert.deepEqual(state.rows[0].vehicle_ids, ['camper-a'], 'Archiving must retain concrete vehicle assignments');
  await filter('Archiwum');
  assert.deepEqual(items(), ['Krzesło turystyczne']);
  await clickLabel('Przywróć Krzesło turystyczne');
  assert.deepEqual(writes()[1], { path: '/owner/stock/chair', method: 'PATCH', body: { active: true } });
  assert.deepEqual(items(), []);
  await filter('Aktywne');
  assert.deepEqual(items(), ['Krzesło turystyczne']);
  assert.match(document.body.textContent, /Wyposażenie przywrócone do oferty/);
});

test('focus returns to the opening control after cancel and the header after saving, archive, and restore', async () => {
  await start({ rows: [row()], deferWrites: true });
  const add = document.querySelector('.stock-heading button');
  const assertAddFocused = () => {
    assert.equal(add.disabled, false, 'Add button must be enabled before receiving focus');
    assert.equal(document.activeElement, add, 'Finishing the action must restore focus to the header add button');
  };
  const finishWrite = async (expected = add) => {
    assert.equal(add.disabled, true, 'A pending mutation must disable the add button');
    assert.equal(state.pendingWrites.length, 1);
    await act(async () => state.pendingWrites.shift()());
    await tick();
    assert.equal(expected.disabled, false, 'Focus restoration waits until the control is enabled');
    assert.equal(document.activeElement, expected, 'Finishing the action must restore the opening control or header fallback');
  };
  await clickText('Dodaj wyposażenie');
  await clickText('Anuluj');
  assertAddFocused();
  await clickText('Dodaj wyposażenie');
  await input(field('name'), 'Stół kempingowy');
  await clickText('Dodaj do magazynu');
  assert.ok(editor(), 'Pending save keeps the editor mounted');
  await finishWrite();
  assert.equal(editor(), null);
  const edit = document.querySelector('button[aria-label="Edytuj Krzesło turystyczne"]');
  await click(edit);
  await clickLabel('Zamknij formularz');
  assert.equal(document.activeElement, edit);
  await click(edit);
  await clickText('Zapisz zmiany');
  await finishWrite();
  await clickLabel('Archiwizuj Krzesło turystyczne');
  await clickText('Archiwizuj wyposażenie');
  await finishWrite();
  await filter('Archiwum');
  await clickLabel('Przywróć Krzesło turystyczne');
  await finishWrite();
});

test('failed archive preserves its confirmation and current list until the owner retries', async () => {
  await start({ rows: [row()], failWrites: 1 });
  const readsBefore = reads().length;
  await clickLabel('Archiwizuj Krzesło turystyczne');
  await clickText('Archiwizuj wyposażenie');
  assert.deepEqual(items(), ['Krzesło turystyczne']);
  assert.ok(document.querySelector('.stock-archive-confirm'));
  assert.match(document.querySelector('.stock-page > [role="alert"]').textContent, /Stan magazynu zmienił się/);
  assert.equal(reads().length, readsBefore);
  assert.equal(state.rows[0].active, true);
  await clickText('Archiwizuj wyposażenie');
  assert.equal(writes().length, 2);
  assert.equal(state.rows[0].active, false);
  assert.equal(document.querySelector('.stock-archive-confirm'), null);
  assert.equal(document.querySelector('.stock-page > [role="alert"]'), null);
});

test('read failure exposes retry and re-renders the returned warehouse using the real data hook', async () => {
  // StrictMode replays the initial effect, so reject both initial reads.
  await start({ rows: [row()], failReads: 2 });
  assert.match(document.querySelector('.stock-list-panel [role="alert"]').textContent, /Nie udało się pobrać magazynu/);
  assert.deepEqual(items(), []);
  await clickText('Spróbuj ponownie');
  assert.deepEqual(items(), ['Krzesło turystyczne']);
  assert.equal(document.querySelector('.stock-list-panel [role="alert"]'), null);
  assert.equal(reads().length, 3);
});

test('availability dates query only on submission; invalid or empty ranges never query', async () => {
  await start({ rows: [row()] });
  const readsBefore = reads().length;
  const originalPath = reads().at(-1).path;
  const dates = [...document.querySelectorAll('.stock-dates input[type="date"]')];
  await input(dates[0], '2027-08-10');
  assert.equal(dates[1].value, '2027-08-17', 'Moving the start past the end should preserve a usable one-week interval');
  assert.equal(dates[1].min, '2027-08-11');
  await input(dates[1], '2027-08-12');
  assert.equal(reads().length, readsBefore, 'Editing draft dates must not query availability');
  assert.equal(reads().at(-1).path, originalPath);
  await input(dates[1], '2027-08-10');
  await submit(document.querySelector('.stock-dates'));
  assert.equal(reads().length, readsBefore);
  assert.match(document.querySelector('.stock-error').textContent, /Koniec wyjazdu musi być późniejszy/);
  await input(dates[1], '');
  await submit(document.querySelector('.stock-dates'));
  assert.equal(reads().length, readsBefore);
  await input(dates[1], '2027-08-12');
  await clickText('Sprawdź dostępność');
  assert.equal(reads().length, readsBefore + 1);
  assert.equal(reads().at(-1).path, '/owner/stock?start=2027-08-10&end=2027-08-12');
  assert.equal(document.querySelector('.stock-error'), null);
  assert.match(document.querySelector('.stock-availability').textContent, /10 sierpnia 2027.*12 sierpnia 2027/);
});

test('Escape cancels staged photo changes, releases preview URLs, and restores the opening edit control', async () => {
  const existing = { id: 'saved-photo', asset: '/media/saved-photo.webp' };
  await start({ rows: [row({ photos: [existing] })] });
  const edit = document.querySelector('button[aria-label="Edytuj Krzesło turystyczne"]');
  await click(edit);
  await clickLabel('Usuń zdjęcie 1');
  await choosePhotos([photo('new-chair.jpg')]);
  assert.equal(editor().querySelectorAll('.stock-photo').length, 1);
  assert.match(editor().querySelector('figcaption').textContent, /Do zapisania/);
  assert.deepEqual(writes(), [], 'Selecting and removing photos is staged until save');
  const preview = state.previewUrls[0].url;
  const cancel = new Event('cancel', { bubbles: false, cancelable: true });
  await act(async () => document.querySelector('dialog').dispatchEvent(cancel));
  await tick();
  assert.equal(cancel.defaultPrevented, true, 'React handles native Escape cancellation');
  assert.equal(editor(), null);
  assert.equal(document.activeElement, edit);
  assert.equal(document.body.style.overflow, '');
  assert.deepEqual(writes(), []);
  assert.deepEqual(state.rows[0].photos, [existing], 'Cancel leaves persisted photos unchanged');
  assert.ok(state.revokedUrls.includes(preview));
  await click(edit);
  assert.equal(editor().querySelectorAll('.stock-photo').length, 1);
  assert.equal(editor().querySelector('.stock-photo img').getAttribute('src'), existing.asset);
  assert.equal(editor().querySelector('figcaption').textContent, 'Zapisane');
});

test('photo validation rejects unsupported formats, oversized images, and batches beyond six without uploading', async () => {
  await start();
  await clickText('Dodaj wyposażenie');
  await choosePhotos([photo('chair.svg', 'image/svg+xml')]);
  assert.match(editor().querySelector('[role="alert"]').textContent, /JPG, PNG lub WebP/);
  assert.equal(editor().querySelectorAll('.stock-photo').length, 0);
  await choosePhotos([photo('chair.jpg', 'image/jpeg', 10 * 1024 * 1024 + 1)]);
  assert.match(editor().querySelector('[role="alert"]').textContent, /maksymalnie 10 MB/);
  assert.equal(editor().querySelectorAll('.stock-photo').length, 0);
  await choosePhotos(Array.from({ length: 7 }, (_, index) => photo('chair-' + index + '.jpg')));
  assert.match(editor().querySelector('[role="alert"]').textContent, /maksymalnie 6 zdjęć/);
  assert.equal(editor().querySelectorAll('.stock-photo').length, 0);
  assert.equal(state.previewUrls.length, 0, 'Rejected batches never allocate preview URLs');
  await choosePhotos([photo('chair.jpg'), photo('chair.png', 'image/png'), photo('chair.webp', 'image/webp'),
    photo('chair-4.jpg'), photo('chair-5.jpg'), photo('chair-6.jpg', 'image/jpeg', 10 * 1024 * 1024)]);
  assert.equal(editor().querySelectorAll('.stock-photo').length, 6);
  assert.equal(editor().querySelector('[role="alert"]'), null);
  assert.equal([...editor().querySelectorAll('button')].find((button) => button.textContent.trim() === 'Dodaj zdjęcia').disabled, true);
  await choosePhotos([photo('seventh.jpg')]);
  assert.match(editor().querySelector('[role="alert"]').textContent, /maksymalnie 6 zdjęć/);
  assert.equal(editor().querySelectorAll('.stock-photo').length, 6);
  await clickLabel('Usuń zdjęcie 1');
  assert.equal(editor().querySelectorAll('.stock-photo').length, 5);
  assert.equal(editor().querySelector('[role="alert"]'), null);
  assert.equal([...editor().querySelectorAll('button')].find((button) => button.textContent.trim() === 'Dodaj zdjęcia').disabled, false);
  assert.deepEqual(writes(), [], 'Valid staged previews and validation errors never mutate the API');
});

test('removing a persisted equipment photo only deletes it after saving, and reload retains the remaining photo', async () => {
  const retained = { id: 'retain-photo', asset: '/media/retain-photo.webp' };
  await start({ rows: [row({ photos: [{ id: 'remove-photo', asset: '/media/remove-photo.webp' }, retained] })] });
  await clickLabel('Edytuj Krzesło turystyczne');
  await clickLabel('Usuń zdjęcie 1');
  assert.deepEqual(writes(), []);
  assert.equal(state.rows[0].photos.length, 2);
  assert.equal(editor().querySelector('.stock-photo img').getAttribute('src'), retained.asset);
  await clickText('Zapisz zmiany');
  assert.deepEqual(writes().map(({ path, method }) => ({ path, method })), [
    { path: '/owner/stock/chair', method: 'PATCH' },
    { path: '/owner/stock/chair/photos/remove-photo', method: 'DELETE' },
  ]);
  assert.deepEqual(state.rows[0].photos, [retained]);
  assert.equal(editor(), null);
  await clickLabel('Edytuj Krzesło turystyczne');
  assert.equal(editor().querySelectorAll('.stock-photo').length, 1);
  assert.equal(editor().querySelector('.stock-photo img').getAttribute('src'), retained.asset);
});

test('new equipment upload failure preserves form and saved ID; retry patches the same item and uploads only unfinished photos', async () => {
  await start({ failUploadAttempts: [2] });
  await clickText('Dodaj wyposażenie');
  await input(field('name'), 'Składany fotelik');
  await input(field('quantity'), '3');
  await input(field('price'), '19.99');
  await input(field('unit'), 'day');
  await check('camper-b', true);
  await choosePhotos([photo('front.jpg'), photo('side.png', 'image/png')]);
  const previews = copy(state.previewUrls);
  await clickText('Dodaj do magazynu');
  assert.equal(state.rows.length, 1, 'A partly successful save creates only one equipment item');
  assert.ok(editor());
  assert.match(editor().querySelector('[role="alert"]').textContent, /Dane wyposażenia zapisane.*Ponowny zapis dokończy zmiany/);
  assert.equal(field('name').value, 'Składany fotelik');
  assert.equal(field('quantity').value, '3');
  assert.equal(field('price').value, '19.99');
  assert.equal(field('unit').value, 'day');
  assert.equal(document.querySelector('[name="vehicleIds"][value="camper-b"]').checked, true);
  assert.deepEqual([...editor().querySelectorAll('figcaption')].map((caption) => caption.textContent), ['Zapisane', 'Do zapisania']);
  assert.ok(state.revokedUrls.includes(previews[0].url), 'Successful upload releases its local preview');
  assert.equal(state.revokedUrls.includes(previews[1].url), false, 'Unfinished upload keeps its retry preview');
  assert.deepEqual(writes().map(({ path, method }) => ({ path, method })), [
    { path: '/owner/stock', method: 'POST' },
    { path: '/owner/stock/new-stock/photos', method: 'POST' },
    { path: '/owner/stock/new-stock/photos', method: 'POST' },
  ]);
  await input(field('name'), 'Składany fotelik z pokrowcem');
  await clickText('Dodaj do magazynu');
  assert.equal(editor(), null);
  assert.equal(state.rows.length, 1, 'Retry must reuse the ID saved before the upload failure');
  assert.deepEqual(writes().slice(3).map(({ path, method }) => ({ path, method })), [
    { path: '/owner/stock/new-stock', method: 'PATCH' },
    { path: '/owner/stock/new-stock/photos', method: 'POST' },
  ]);
  assert.equal(writes()[3].body.name, 'Składany fotelik z pokrowcem');
  assert.deepEqual(writes().filter((call) => call.path.endsWith('/photos')).map((call) => call.body.files[0].name), ['front.jpg', 'side.png', 'side.png']);
  assert.equal(state.rows[0].photos.length, 2);
  assert.ok(state.revokedUrls.includes(previews[1].url));
});
