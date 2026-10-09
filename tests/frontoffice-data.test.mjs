import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const requireWeb = createRequire(new URL('../apps/frontoffice/package.json', import.meta.url));
const React = requireWeb('react');
const { renderToString } = requireWeb('react-dom/server');
const { hydrateRoot } = requireWeb('react-dom/client');
const ts = requireWeb('typescript');
const Context = React.createContext(null);
const compiled = ts.transpileModule(
  fs.readFileSync(new URL('../apps/frontoffice/components/shared.tsx', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  },
).outputText;
const exported = {};
runInNewContext(compiled, {
  exports: exported,
  URLSearchParams,
  require: (name) =>
    name.endsWith('/packages/ui/components/shared')
      ? { useApp: () => React.useContext(Context) }
      : requireWeb(name),
});

test('SSR data survives hydration and revalidation without accepting stale async responses', async () => {
  const pending = [];
  const api = (path) =>
    new Promise((resolve, reject) => pending.push({ path, resolve, reject }));
  let context = {
    api,
    initialData: { '/catalog?sort=recommended&type=all': [{ id: 'seed' }] },
  };
  let path = '/catalog?type=all&sort=recommended';
  let version = 0;
  let latest;
  function Probe() {
    latest = exported.useData(path, version);
    return React.createElement('p', null, latest.error || (latest.data?.[0]?.id ?? 'loading'));
  }
  const element = () =>
    React.createElement(Context.Provider, { value: context }, React.createElement(Probe));
  const markup = renderToString(element());
  assert.equal(markup, '<p>seed</p>', 'server HTML must contain the public data');

  const dom = new JSDOM('<div id="root">' + markup + '</div>', {
    url: 'https://vanly.me.local',
  });
  const globalKeys = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'];
  const globalsBefore = Object.fromEntries(
    globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let clientRoot;
  const output = () => dom.window.document.querySelector('p').textContent;
  const render = () => React.act(async () => clientRoot.render(element()));
  const resolve = (request, data) => React.act(async () => request.resolve(data));
  try {
    await React.act(async () => {
      clientRoot = hydrateRoot(dom.window.document.querySelector('#root'), element());
    });
    assert.equal(output(), 'seed', 'seed remains visible while the hydration GET is pending');
    assert.equal(pending.length, 1);
    const initialRequest = pending.at(-1);

    path = '/catalog?sort=recommended&type=all';
    await render();
    assert.equal(pending.length, 1, 'equivalent query ordering does not trigger another GET');

    path = '/catalog?type=trailer&sort=recommended';
    await render();
    assert.equal(output(), 'loading', 'changed filters must not show the previous results');
    const filteredRequest = pending.at(-1);
    await resolve(initialRequest, [{ id: 'old-path' }]);
    assert.equal(output(), 'loading', 'late responses from earlier filters are ignored');
    await resolve(filteredRequest, [{ id: 'trailer' }]);
    assert.equal(output(), 'trailer');

    await React.act(async () => latest.reload());
    const olderReload = pending.at(-1);
    assert.equal(output(), 'trailer', 'same-resource reload keeps the current content visible');
    await React.act(async () => latest.reload());
    const newerReload = pending.at(-1);
    await resolve(newerReload, [{ id: 'fresh-reload' }]);
    await resolve(olderReload, [{ id: 'old-reload' }]);
    assert.equal(output(), 'fresh-reload', 'late responses from earlier reloads are ignored');

    await React.act(async () => latest.reload());
    const beforeRefresh = pending.at(-1);
    context = {
      api,
      initialData: {
        '/catalog?sort=recommended&type=trailer': [{ id: 'server-refresh' }],
        '/catalog?sort=recommended&type=all': [{ id: 'server-all' }],
      },
    };
    await render();
    assert.equal(output(), 'server-refresh', 'a new same-path server snapshot replaces old data');
    const afterRefresh = pending.at(-1);
    await resolve(beforeRefresh, [{ id: 'before-server-refresh' }]);
    assert.equal(output(), 'server-refresh', 'requests preceding a server refresh are ignored');
    await resolve(afterRefresh, [{ id: 'api-refresh' }]);
    assert.equal(output(), 'api-refresh', 'refreshed server data is still revalidated by the API');

    path = '/catalog?sort=recommended&type=all';
    await render();
    assert.equal(output(), 'loading', 'changing filters cannot reuse a seed from the same snapshot');
    await resolve(pending.at(-1), [{ id: 'all-current' }]);

    version = 1;
    await render();
    const olderVersion = pending.at(-1);
    version = 2;
    await render();
    const newerVersion = pending.at(-1);
    await resolve(newerVersion, [{ id: 'fresh-version' }]);
    await resolve(olderVersion, [{ id: 'old-version' }]);
    assert.equal(output(), 'fresh-version', 'late responses from older versions are ignored');

    version = 3;
    await render();
    const outdatedFailure = pending.at(-1);
    version = 4;
    await render();
    await resolve(pending.at(-1), [{ id: 'current-version' }]);
    await React.act(async () => outdatedFailure.reject(new Error('Old request failed')));
    assert.equal(output(), 'current-version', 'stale request errors cannot hide current data');
  } finally {
    if (clientRoot) await React.act(async () => clientRoot.unmount());
    dom.window.close();
    for (const key of globalKeys) {
      if (globalsBefore[key]) Object.defineProperty(globalThis, key, globalsBefore[key]);
      else delete globalThis[key];
    }
  }
});
