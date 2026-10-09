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
const { act } = React;
const { createRoot } = require('react-dom/client');
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
    (name) => (Object.hasOwn(overrides, name) ? overrides[name] : require(name)),
    module,
    module.exports,
  );
  return module.exports;
}
const statuses = compile('../packages/ui/lib/reservation-status.ts');
const shared = compile('../packages/ui/components/shared.tsx', {
  '../lib/reservation-status': statuses,
  'next/link': ({ children, href }) => React.createElement('a', { href }, children),
  'lucide-react': new Proxy({}, { get: () => () => null }),
});
const ids = compile('../packages/ui/lib/request-id.ts');
const { CreditsWallet, PublicationInfo } = compile(
  '../packages/ui/components/backoffice/Credits.tsx',
  { '../shared': shared, '../../lib/request-id': ids },
);
let root, calls, pending, reloads, error;
async function start({ enabled = true, defer = false, fail = false } = {}) {
  calls = [];
  pending = [];
  reloads = 0;
  error = null;
  const api = (path, method, body, key) => {
    calls.push({ path, method, body, key });
    if (defer) return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    if (fail) return Promise.reject(Error('Odrzucona płatność'));
    return Promise.resolve({ credits: body.credits });
  };
  const action = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      error = e.message;
    }
  };
  root = createRoot(document.getElementById('test'));
  await act(async () =>
    root.render(
      React.createElement(
        shared.Context.Provider,
        { value: { api, act: action } },
        React.createElement(CreditsWallet, {
          billing: {
            wallet: { balance: 50 },
            creditPriceMinor: 20000,
            testPaymentsEnabled: enabled,
            ledger: [],
          },
          reload: () => reloads++,
        }),
      ),
    ),
  );
}
async function change(value) {
  const input = document.querySelector('input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    document
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
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
test('wallet makes simulation explicit and submits only count with an operation identifier', async () => {
  await start();
  await change('50');
  assert.match(document.body.textContent, /10\s000/);
  assert.match(document.body.textContent, /nie pobieramy prawdziwych pieniędzy/);
  await submit();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { credits: 50, scenario: 'success' });
  assert.equal(calls[0].path, '/owner/credits/buy-test');
  assert.ok(calls[0].key.length >= 8);
  assert.equal(reloads, 1);
  await submit();
  assert.notEqual(
    calls[0].key,
    calls[1].key,
    'New deliberate purchase needs a fresh operation key',
  );
});
test('empty, fractional and negative counts cannot submit; disabled simulator stays disabled', async () => {
  await start();
  for (const value of ['', '0', '-1', '1.5', '100001']) {
    await change(value);
    assert.equal(document.querySelector('button').disabled, true);
    await submit();
  }
  assert.equal(calls.length, 0);
  await act(async () => root.unmount());
  root = undefined;
  await start({ enabled: false });
  await submit();
  assert.equal(calls.length, 0);
  assert.equal(document.querySelector('button').disabled, true);
});
test('rapid submits send one purchase and an uncertain failure retries the same operation', async () => {
  await start({ defer: true });
  await act(async () => {
    const form = document.querySelector('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.equal(calls.length, 1);
  assert.equal(document.querySelector('button').disabled, true);
  await act(async () => pending[0].reject(Error('Przerwane połączenie')));
  assert.equal(reloads, 0);
  assert.match(error, /Przerwane/);
  await submit();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].key, calls[1].key);
  await act(async () => pending[1].resolve({ credits: 1 }));
  assert.equal(reloads, 1);
});
test('publication states explain the free first vehicle and wallet pause without losing paid period', async () => {
  root = createRoot(document.getElementById('test'));
  await act(async () =>
    root.render(React.createElement(PublicationInfo, { publication: { exempt: true } })),
  );
  assert.match(document.body.textContent, /bezpłatna/);
  await act(async () =>
    root.render(
      React.createElement(PublicationInfo, {
        publication: {
          exempt: false,
          valid_until: '2026-11-09T12:00:00Z',
          paused_for_credits: true,
        },
      }),
    ),
  );
  assert.match(document.body.textContent, /Opłacony okres/);
  assert.match(document.body.textContent, /Zasil portfel/);
});
