import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

// Exercise the real shared data hook; all requests are deferred offline boundaries.
const require = createRequire(new URL('../apps/frontoffice/package.json', import.meta.url));
const ts = require('typescript');
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
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
function compile(relative, overrides = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    (name) => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name === 'next/link')
        return ({ children, href }) => React.createElement('a', { href }, children);
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      return require(name);
    },
    module,
    module.exports,
  );
  return module.exports;
}
const statuses = compile('../packages/ui/lib/reservation-status.ts');
const shared = compile('../packages/ui/components/shared.tsx', {
  '../lib/reservation-status': statuses,
});
const { Context, useData, ReservationBadge } = shared;
const { Reservations } = compile('../packages/ui/components/backoffice/Reservations.tsx', {
  '../shared': shared,
  '../../lib/reservation-status': statuses,
});
let root, pending, props, api, output, seen;
function Probe() {
  output = useData(props.path, props.version || 0);
  seen.push(output.data);
  return React.createElement(
    'div',
    { id: 'result' },
    output.error || output.data?.privateName || 'loading',
  );
}
async function render() {
  await act(async () =>
    root.render(
      React.createElement(
        Context.Provider,
        {
          value: { api, user: props.user },
        },
        React.createElement(Probe),
      ),
    ),
  );
}
async function start() {
  pending = [];
  seen = [];
  props = { path: '/bookings', user: { id: 'user-a', role: 'owner', company_id: 'company-a' } };
  api = (path) =>
    new Promise((resolve, reject) =>
      pending.push({ path, user: { ...props.user }, resolve, reject }),
    );
  root = createRoot(document.getElementById('test'));
  await render();
}
async function resolve(index, privateName) {
  await act(async () => pending[index].resolve({ privateName }));
}
const text = () => document.querySelector('#result').textContent;
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

test('switching account clears private data in the first render, then reads the new scope', async () => {
  await start();
  await resolve(0, 'Private account A');
  assert.equal(text(), 'Private account A');
  seen.length = 0;
  props.user = { id: 'user-b', role: 'owner', company_id: 'company-b' };
  await render();
  assert.equal(seen[0], null);
  assert.equal(text(), 'loading');
  assert.equal(pending.length, 2);
  assert.equal(pending[1].user.id, 'user-b');
  await resolve(1, 'Private account B');
  assert.equal(text(), 'Private account B');
});

test('company or role change on the same account cannot retain old company data', async () => {
  await start();
  await resolve(0, 'Private company A');
  props.user = { ...props.user, company_id: 'company-b' };
  await render();
  assert.equal(text(), 'loading');
  await resolve(1, 'Private company B');
  props.user = { ...props.user, role: 'traveler', company_id: null };
  await render();
  assert.equal(text(), 'loading');
  assert.equal(pending.length, 3);
  await resolve(2, 'Private traveler');
  assert.equal(text(), 'Private traveler');
});

test('a late request or failure from the previous scope cannot replace the new account result', async () => {
  await start();
  props.user = { id: 'user-b', role: 'traveler' };
  await render();
  await resolve(1, 'Private B');
  await resolve(0, 'Private A');
  assert.equal(text(), 'Private B');
  await act(async () => output.reload());
  props.user = { id: 'user-c', role: 'traveler' };
  await render();
  await resolve(3, 'Private C');
  await act(async () => pending[2].reject(Error('Old scope error')));
  assert.equal(text(), 'Private C');
  assert.equal(output.error, '');
});

test('changing resource path clears old data immediately and reload retries a failed request', async () => {
  await start();
  await resolve(0, 'Booking one');
  props.path = '/bookings/two';
  seen.length = 0;
  await render();
  assert.equal(seen[0], null);
  assert.equal(text(), 'loading');
  await act(async () => pending[1].reject(Error('Unavailable')));
  assert.equal(text(), 'Unavailable');
  await act(async () => output.reload());
  assert.equal(text(), 'loading');
  await resolve(2, 'Booking two');
  assert.equal(text(), 'Booking two');
});

test('reservation status filters show exactly four labels and retain historical handovers in confirmed results', async () => {
  const rows = [
    'held',
    'pending',
    'cancelled',
    'expired',
    'rejected',
    'confirmed',
    'in_rental',
    'completed',
  ].map((status, id) => ({
    id: String(id),
    status,
    vehicle_name: status,
    reference: 'TEST-' + id,
    start_date: '2026-11-01',
    end_date: '2026-11-05',
    payment_status: 'external',
    total_minor: 100000,
  }));
  root = createRoot(document.getElementById('test'));
  await act(async () =>
    root.render(React.createElement(Reservations, { rows, prefix: '/firma/rezerwacja/' })),
  );
  const select = document.querySelector('select[aria-label="Status rezerwacji"]');
  assert.deepEqual(
    [...select.options].map((option) => option.textContent),
    ['Wszystkie statusy', 'Niepotwierdzona', 'Anulowana', 'Odrzucona', 'Potwierdzona'],
  );
  for (const [status, expected] of [
    ['pending', ['held', 'pending']],
    ['cancelled', ['cancelled', 'expired']],
    ['rejected', ['rejected']],
    ['confirmed', ['confirmed', 'in_rental', 'completed']],
  ]) {
    await act(async () => {
      select.value = status;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.deepEqual(
      [...document.querySelectorAll('.booking-card h3')].map((heading) => heading.textContent),
      expected,
    );
    assert.deepEqual(
      [...document.querySelectorAll('.booking-card .pill:first-child')].map(
        (badge) => badge.textContent,
      ),
      expected.map(() => statuses.reservationLabels[status]),
    );
  }
});
