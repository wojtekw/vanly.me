import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
const require = createRequire(new URL('../apps/frontoffice/package.json', import.meta.url));
const dom = new JSDOM('<div id="test"></div>', {
  url: 'https://vanly.test/potwierdz-email?token=' + 'a'.repeat(64),
});
const globals = [
  'window',
  'document',
  'HTMLElement',
  'HTMLInputElement',
  'Element',
  'Node',
  'Event',
  'navigator',
  'IS_REACT_ACT_ENVIRONMENT',
];
const previous = Object.fromEntries(
  globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
for (const key of globals)
  Object.defineProperty(globalThis, key, {
    value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key],
    configurable: true,
    writable: true,
  });
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
let root, state;
const source = fs.readFileSync(
  new URL('../apps/frontoffice/components/EmailConfirmation.tsx', import.meta.url),
  'utf8',
);
const compiled = require('typescript').transpileModule(source, {
  compilerOptions: { module: 1, jsx: 4, target: 7, esModuleInterop: true },
}).outputText;
const module = { exports: {} };
const dependencies = (name) => {
  if (name === './shared')
    return {
      useApp: () => ({
        api: async (...args) => {
          state.calls.push(args);
          if (state.error) throw Error(state.error);
          if (state.defer) return new Promise((resolve) => (state.resolve = resolve));
          return { message: 'Potwierdzono.' };
        },
        session: async () => state.sessions++,
      }),
      Heading: ({ title, children }) =>
        React.createElement('section', null, React.createElement('h1', null, title), children),
      Notice: ({ children }) => React.createElement('div', null, children),
    };
  if (name === 'next/navigation')
    return { useSearchParams: () => new URLSearchParams(dom.window.location.search) };
  if (name === 'next/link')
    return ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children);
  return require(name);
};
new Function('require', 'module', 'exports', compiled)(dependencies, module, module.exports);
const { EmailConfirmation } = module.exports;
async function start(kind = 'email', overrides = {}) {
  state = { calls: [], sessions: 0, ...overrides };
  dom.window.history.replaceState(
    null,
    '',
    '/potwierdz-email?token=' + (state.token ?? 'a'.repeat(64)),
  );
  root = createRoot(document.getElementById('test'));
  await act(async () =>
    root.render(
      React.createElement(React.StrictMode, null, React.createElement(EmailConfirmation, { kind })),
    ),
  );
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});
after(() => {
  dom.window.close();
  for (const key of globals)
    previous[key] ? Object.defineProperty(globalThis, key, previous[key]) : delete globalThis[key];
});
for (const [kind, endpoint] of [
  ['email', '/auth/verify-email'],
  ['newsletter', '/newsletter/confirm'],
  ['unsubscribe', '/newsletter/unsubscribe'],
])
  test(kind + ': opening link is read-only; confirmation posts once and hides token', async () => {
    await start(kind);
    assert.equal(state.calls.length, 0);
    await act(async () => document.querySelector('button').click());
    assert.deepEqual(state.calls, [[endpoint, 'POST', { token: 'a'.repeat(64) }]]);
    assert.equal(dom.window.location.search, '');
    assert.equal(document.querySelector('button'), null);
    assert.equal(state.sessions, kind === 'email' ? 1 : 0);
  });
test('invalid link cannot submit', async () => {
  await start('email', { token: 'not-valid' });
  assert.equal(document.querySelector('button').disabled, true);
  await act(async () => document.querySelector('button').click());
  assert.equal(state.calls.length, 0);
});
test('network failure keeps a retry action and token', async () => {
  await start('newsletter', { error: 'Spróbuj ponownie.' });
  await act(async () => document.querySelector('button').click());
  assert.match(document.body.textContent, /Spróbuj ponownie/);
  assert.equal(document.querySelector('button').disabled, false);
  assert.notEqual(dom.window.location.search, '');
  state.error = null;
  await act(async () => document.querySelector('button').click());
  assert.equal(state.calls.length, 2);
  assert.equal(dom.window.location.search, '');
});
test('pending request prevents duplicate confirmations', async () => {
  await start('email', { defer: true });
  await act(async () => document.querySelector('button').click());
  assert.equal(document.querySelector('button').disabled, true);
  await act(async () => document.querySelector('button').click());
  assert.equal(state.calls.length, 1);
  await act(async () => state.resolve({ message: 'Gotowe.' }));
  assert.equal(document.querySelector('button'), null);
});
