import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

// Component tests only: a local DOM and fake Maps SDK, with no browser or Google requests.
const webRequire = createRequire(new URL('../apps/frontoffice/package.json', import.meta.url));
const ts = webRequire('typescript');
const dom = new JSDOM('<!doctype html><html><body><div id="test"></div></body></html>');
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event'])
  globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = webRequire('react');
const { createRoot } = webRequire('react-dom/client');
const { act } = React;
let root, state;
const poland = { south: 49, west: 14.1, north: 54.9, east: 24.2 };
const sdk = {
  importLibrary: async () => ({}),
  Map: class {
    constructor() {
      state.maps++;
      state.map = this;
    }
    fitBounds(bounds) {
      state.fits.push(bounds);
    }
    getBounds() {
      return { toJSON: () => state.viewport };
    }
    setCenter() {
      state.recentered++;
    }
    setZoom() {
      state.recentered++;
    }
  },
  LatLngBounds: class {
    extend() {}
  },
  marker: {
    PinElement: function () {
      return document.createElement('span');
    },
    AdvancedMarkerElement: function () {
      return document.createElement('span');
    },
  },
  event: { clearInstanceListeners() {} },
};
dom.window.customElements.define(
  'gmp-place-search',
  class extends HTMLElement {
    connectedCallback() {
      const request = this.querySelector('gmp-place-text-search-request');
      state.queries.push({
        text: request.textQuery,
        bounds: request.locationRestriction,
        max: request.getAttribute('max-result-count'),
        kind: request.getAttribute('included-type'),
      });
      this.places = [{ id: 'test-camp', location: { lat: 52, lng: 20 } }];
      queueMicrotask(() => {
        if (this.isConnected) this.dispatchEvent(new Event('gmp-load'));
      });
    }
  },
);
const api = async (_path, _method, body) => {
  state.operations.push(body.operation);
  if (state.fail === body.operation) throw Error('Limit map został osiągnięty.');
  return { browserKey: 'fake-key', mapId: 'fake-map' };
};
const source = fs.readFileSync(
  new URL('../apps/frontoffice/components/Camps.tsx', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;
const module = { exports: {} };
const brandModule = { exports: {} };
new Function('exports', 'process', ts.transpileModule(
  fs.readFileSync(new URL('../apps/frontoffice/lib/brand.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText)(brandModule.exports, process);
const require = (name) => {
  if (name === '../lib/brand') return brandModule.exports;
  if (name === './shared')
    return {
      useApp: () => ({ api, ready: state.ready }),
      useData: () => ({ data: state.config }),
      Heading: ({ title }) => React.createElement('h1', null, title),
      Notice: ({ children }) => React.createElement('div', null, children),
    };
  if (name === '../lib/google-maps') return { loadGoogleMaps: async () => sdk };
  if (name === 'next/link')
    return ({ children, href }) => React.createElement('a', { href }, children);
  if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
  return webRequire(name);
};
new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
const { Camps } = module.exports;
const tick = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
async function render() {
  await act(async () =>
    root.render(React.createElement(React.StrictMode, null, React.createElement(Camps))),
  );
  await tick();
}
async function start(overrides = {}) {
  state = {
    ready: true,
    config: { enabled: true, available: true },
    operations: [],
    queries: [],
    fits: [],
    maps: 0,
    recentered: 0,
    viewport: poland,
    ...overrides,
  };
  root = createRoot(document.getElementById('test'));
  await render();
}
async function click(text) {
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === text,
  );
  assert.ok(button, 'Missing button: ' + text);
  assert.equal(button.disabled, false);
  await act(async () => button.click());
  await tick();
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
});

test('Poland loads once without a click, after session readiness, even with effect replay', async () => {
  await start({ ready: false });
  assert.deepEqual(state.operations, []);
  state.ready = true;
  await render();
  assert.deepEqual(state.operations, ['map', 'search']);
  assert.equal(state.maps, 1);
  assert.deepEqual(state.queries[0], {
    text: 'Kempingi Polska',
    bounds: poland,
    max: '20',
    kind: 'campground',
  });
  assert.deepEqual(state.fits, [poland]);
  assert.equal(state.recentered, 0, 'One result must not replace the initial country overview');
  await render();
  assert.deepEqual(state.operations, ['map', 'search']);
});

test('region shortcut searches immediately; map-area search stays within the chosen view', async () => {
  await start();
  await click('Kaszuby');
  assert.equal(state.queries.at(-1).text, 'Kempingi Kaszuby');
  assert.equal(state.queries.at(-1).bounds, undefined);
  assert.equal(state.maps, 1, 'Reuse the map instead of billing another map load');
  const moved = { south: 53.7, west: 17.5, north: 54.7, east: 18.7 };
  state.viewport = moved;
  await render();
  assert.equal(state.queries.length, 2, 'Moving the view must not query automatically');
  const fitsBefore = state.fits.length,
    recenteredBefore = state.recentered;
  await click('Szukaj w tym obszarze');
  assert.deepEqual(state.queries.at(-1).bounds, moved);
  assert.equal(state.queries.at(-1).text, 'Kempingi');
  assert.equal(state.fits.length, fitsBefore);
  assert.equal(state.recentered, recenteredBefore);
  await click('Cała Polska');
  assert.deepEqual(state.fits.at(-1), poland);
  assert.equal(state.operations.filter((op) => op === 'map').length, 1);
});

test('disabled or exhausted integration does not initialize Maps', async () => {
  await start({ config: { enabled: true, available: false } });
  assert.deepEqual(state.operations, []);
  assert.equal(state.maps, 0);
  assert.match(document.body.textContent, /Mapa zrobiła przerwę/);
  state.config = { enabled: false, available: false };
  await render();
  assert.deepEqual(state.operations, []);
});

test('a rejected initial permission shows an error without an automatic retry loop', async () => {
  await start({ fail: 'map' });
  assert.deepEqual(state.operations, ['map']);
  assert.equal(state.maps, 0);
  assert.match(document.body.textContent, /Limit map został osiągnięty/);
  await render();
  assert.deepEqual(state.operations, ['map']);
});
