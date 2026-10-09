import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
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
  'FormData',
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
const React = require('react'),
  { act } = React,
  { createRoot } = require('react-dom/client');
const Link = ({ children, href, ...props }) =>
  React.createElement('a', { href, ...props }, children);
function compile(relative, overrides = {}) {
  const output = ts.transpileModule(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(
    (name) =>
      Object.hasOwn(overrides, name)
        ? overrides[name]
        : name === 'next/link'
          ? Link
          : require(name),
    module,
    module.exports,
  );
  return module.exports;
}
const statuses = compile('../packages/ui/lib/reservation-status.ts');
const shared = compile('../packages/ui/components/shared.tsx', {
  '../lib/reservation-status': statuses,
  'lucide-react': new Proxy({}, { get: () => () => null }),
});
const { PaymentDecision } = compile('../packages/ui/features/bookings/PaymentDecision.tsx', {
  '../../components/shared': shared,
});
const held = {
  status: 'held',
  hold_until: new Date(Date.now() + 900000).toISOString(),
  company_name: 'Firma testowa',
  vehicle_name: 'Adria',
  start_date: '2026-11-01',
  end_date: '2026-11-05',
  guests: 2,
  snapshot: { settlementMode: 'direct' },
  asset: 'campervan.webp',
};
const { Checkout } = compile('../packages/ui/features/checkout/Checkout.tsx', {
  '../../components/shared': {
    ...shared,
    useData: () => ({ data: held, reload: () => {} }),
    Bill: () => null,
  },
  '../auth/Require': { Require: ({ children }) => children },
  '../../lib/request-id': compile('../packages/ui/lib/request-id.ts'),
  'lucide-react': new Proxy({}, { get: () => () => null }),
});
let root, calls;
async function renderDecision(defaults = '', direct = true) {
  calls = [];
  root = createRoot(document.getElementById('test'));
  await act(async () =>
    root.render(
      React.createElement(PaymentDecision, {
        booking: {
          snapshot: { settlementMode: direct ? 'direct' : 'local_test' },
          paymentInstructionsDefault: defaults,
        },
        busy: false,
        onDecision: async (...args) => calls.push(args),
      }),
    ),
  );
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
test('empty instructions prevent confirmation but never prevent rejection', async () => {
  await renderDecision();
  const buttons = [...document.querySelectorAll('button')];
  assert.equal(buttons[0].disabled, true);
  assert.equal(buttons[1].disabled, false);
  await act(async () => buttons[1].click());
  assert.deepEqual(calls, [[false]]);
  assert.match(document.body.textContent, /otrzyma e-mail/);
});
test('company default is editable per booking and the exact instruction is submitted on confirmation', async () => {
  await renderDecision('Zaliczka 30%, pozostała kwota przed odbiorem.');
  const textarea = document.querySelector('textarea');
  const custom = 'Wynajem opłać przelewem w ciągu 7 dni. Kaucja przy odbiorze.';
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(
      textarea,
      custom,
    );
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    document
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.deepEqual(calls, [[true, custom]]);
});
test('historical test-payment bookings keep their existing decision flow', async () => {
  await renderDecision('', false);
  assert.equal(document.querySelector('textarea'), null);
  await act(async () => document.querySelector('button').click());
  assert.deepEqual(calls, [[true, undefined]]);
});
test('checkout promises instructions only after rental confirmation and submits without a payment', async () => {
  calls = [];
  root = createRoot(document.getElementById('test'));
  await act(async () =>
    root.render(
      React.createElement(
        shared.Context.Provider,
        {
          value: {
            user: { name: 'Anna Kowalska', email: 'anna@example.test' },
            api: async (...args) => calls.push(args),
            act: async (fn) => fn(),
            navigate: () => {},
          },
        },
        React.createElement(Checkout, { id: 'booking-ui' }),
      ),
    ),
  );
  assert.ok(
    [...document.querySelectorAll('h2')].some(
      (h) => h.textContent === 'Zarezerwuj bez płatności na tym etapie.',
    ),
  );
  assert.match(
    document.body.textContent,
    /Po potwierdzeniu rezerwacji przez wypożyczalnię otrzymasz e-mail/,
  );
  assert.equal(
    document.querySelector('a[href="/regulamin"]').textContent,
    'Zobacz zasady rezerwacji',
  );
  assert.equal(document.querySelector('button').textContent, 'Zarezerwuj');
  await act(async () => document.querySelector('input[name="accept"]').click());
  await act(async () =>
    document
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/bookings/booking-ui/submit');
  assert.equal(calls[0][2].accept, true);
  assert.ok(!Object.hasOwn(calls[0][2], 'amountMinor'));
});
