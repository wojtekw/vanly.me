import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import * as portalRoutes from '../packages/ui/portal-routes.mjs';

// Real account components in an offline DOM. Auth and navigation are boundaries,
// not live requests; these tests never create users or modify a database.
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
  'FormData',
  'navigator',
  'IS_REACT_ACT_ENVIRONMENT',
];
const previousGlobals = Object.fromEntries(
  globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
for (const key of globalKeys) {
  Object.defineProperty(globalThis, key, {
    value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key],
    configurable: true,
    writable: true,
  });
}
const React = webRequire('react');
const { createRoot } = webRequire('react-dom/client');
const { act } = React;
let root,
  state,
  renderKey = 0;
const companyPath = '/dla-firm/rejestracja';
const bookingPath = '/rezerwacja/00000000-0000-4000-8000-000000000000';
const traveler = {
  id: 'test-traveler',
  role: 'traveler',
  name: 'Test user',
  email: 'user@example.test',
  profile: {},
};
const credentials = {
  name: 'Test user',
  email: 'user@example.test',
  password: 'test-password-123',
};

const context = () => ({
  user: state.user,
  brand: { id: 'vanly', name: 'Vanly' },
  authAudience: state.authAudience,
  authReturnTo: state.authReturnTo,
  api: async (path, method, body, requestId) => {
    state.requests.push({ path, method, body, ...(requestId ? { requestId } : {}) });
    if (state.defer)
      return new Promise((resolve, reject) => state.pending.push({ resolve, reject }));
    return state.responses[path] || { ok: true, message: state.forgotMessage };
  },
  act: async (fn) => {
    try {
      return await fn();
    } catch (error) {
      state.errors.push(error.message);
      return undefined;
    }
  },
  session: async () => {
    state.sessions++;
    return state.sessionUser;
  },
  navigate: (path) => state.destinations.push(path),
  notify: (message) => state.notices.push(message),
});
const componentRequire = (name, importer) => {
  if (name.endsWith('/portal-routes.mjs')) return portalRoutes;
  if (name.endsWith('/shared'))
    return {
      useApp: context,
      useData: (path) => ({
        data: state.data[path] ?? [],
        error: state.dataErrors[path] ?? null,
        reload: () => state.reloads++,
      }),
      Field: ({ label, children }) => React.createElement('label', null, label, children),
      CheckField: ({ label, ...props }) =>
        React.createElement(
          'label',
          null,
          React.createElement('input', { type: 'checkbox', ...props }),
          label,
        ),
      Notice: ({ children }) => React.createElement('div', { className: 'test-notice' }, children),
      Heading: ({ title }) => React.createElement('h1', null, title),
      DataState: ({ children }) => React.createElement(React.Fragment, null, children),
      Empty: ({ title, children }) => React.createElement('div', null, title, children),
      Badge: ({ status }) => React.createElement('span', null, status),
      ReservationBadge: ({ status }) => {
        const statuses = loadComponent(fileURLToPath(new URL('../packages/ui/lib/reservation-status.ts', import.meta.url)));
        return React.createElement('span', null, statuses.reservationLabels[statuses.reservationStatus(status)]);
      },
      Bill: () => null,
      asset: (name) => '/assets/' + name,
      money: (minor) =>
        new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(minor / 100),
      date: (value) => value,
      isoDay: () => '2026-10-07',
    };
  if (name === 'next/link')
    return ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children);
  if (name === 'next/navigation')
    return { useSearchParams: () => new URLSearchParams(state.next ? { next: state.next } : {}) };
  if (name.endsWith('/lib/request-id')) return { createRequestId: () => 'test-request' };
  if (name === './BookingHandovers' || name.endsWith('/components/BookingHandovers'))
    return { BookingHandovers: () => null };
  if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
  if (name.startsWith('.')) {
    const resolved = path.resolve(path.dirname(importer), name);
    const filename = [resolved, resolved + '.tsx', resolved + '.ts'].find((item) =>
      fs.existsSync(item),
    );
    if (filename) return loadComponent(filename);
  }
  return webRequire(name);
};
const modules = new Map();
function loadComponent(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  new Function('require', 'module', 'exports', compiled)(
    (name) => componentRequire(name, filename),
    module,
    module.exports,
  );
  return module.exports;
}
const { Login, Account, Checkout, Booking } = loadComponent(
  fileURLToPath(new URL('../packages/ui/components/Account.tsx', import.meta.url)),
);
const { Operator } = loadComponent(
  fileURLToPath(new URL('../packages/ui/components/backoffice/Operator.tsx', import.meta.url)),
);

async function render() {
  await act(async () =>
    root.render(
      React.createElement(
        React.StrictMode,
        null,
        state.view === 'operator'
          ? React.createElement(Operator, { key: renderKey, tab: 'tresci' })
          : state.view === 'checkout'
            ? React.createElement(Checkout, { key: renderKey, id: 'booking-1' })
            : state.view === 'booking'
              ? React.createElement(Booking, {
                  key: renderKey,
                  id: 'booking-1',
                  mode: state.mode || 'traveler',
                })
              : state.account
                ? React.createElement(Account, {
                    key: renderKey,
                    tab: state.accountTab || 'podroze',
                  })
                : React.createElement(Login, { key: renderKey, register: state.register }),
      ),
    ),
  );
}
async function start(overrides = {}) {
  state = {
    register: true,
    next: undefined,
    user: null,
    authAudience: undefined,
    sessionUser: traveler,
    requests: [],
    destinations: [],
    errors: [],
    pending: [],
    sessions: 0,
    defer: false,
    account: false,
    notices: [],
    data: {},
    dataErrors: {},
    responses: {},
    reloads: 0,
    forgotMessage: 'Jeśli konto istnieje, wyślemy wiadomość z linkiem do ustawienia nowego hasła.',
    ...overrides,
  };
  renderKey++;
  root = createRoot(document.getElementById('test'));
  await render();
}
async function choosePurpose(purpose) {
  const radio = document.querySelector(`input[name="accountPurpose"][value="${purpose}"]`);
  assert.ok(radio, 'Account purpose choice must be available');
  await act(async () => radio.click());
  assert.equal(radio.checked, true);
}
function authSwitch() {
  const path = state.register ? '/logowanie' : '/rejestracja';
  const link = [...document.querySelectorAll('a')].find((item) =>
    item.getAttribute('href').startsWith(path + '?'),
  );
  assert.ok(link, 'The alternative auth flow needs its continuation link');
  return new URL(link.getAttribute('href'), dom.window.location.origin);
}
function fillCredentials() {
  for (const [name, value] of Object.entries(credentials)) {
    const input = document.querySelector(`form input[name="${name}"]`);
    if (input) input.value = value;
  }
}
function dispatchSubmit() {
  const form = document.querySelector('form');
  assert.ok(form, 'Expected an auth form');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
async function submit() {
  fillCredentials();
  await act(async () => dispatchSubmit());
}
function assertAuthPayload(request, register = true) {
  assert.equal(request.path, register ? '/auth/register' : '/auth/login');
  assert.equal(request.method, 'POST');
  assert.deepEqual(
    request.body,
    register ? credentials : { email: credentials.email, password: credentials.password },
  );
  assert.equal('role' in request.body, false);
  assert.equal('accountPurpose' in request.body, false);
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

test('company signup starts as rental and continues to company details with an ordinary traveler account', async () => {
  await start({ next: companyPath });
  assert.equal(document.querySelector('input[value="rental"]').checked, true);
  assert.ok(document.querySelector('.signup-progress [aria-current="step"]'));
  assert.match(document.querySelector('.auth-form h2').textContent, /konto wypożyczalni/);
  assert.equal(
    document.querySelector('form fieldset'),
    null,
    'Purpose is not submitted as an auth credential',
  );
  assert.equal(authSwitch().searchParams.get('next'), companyPath);
  await submit();
  assert.equal(state.requests.length, 1);
  assertAuthPayload(state.requests[0]);
  assert.equal(state.sessions, 1);
  assert.deepEqual(state.destinations, [companyPath]);
});

test('choosing rental from generic registration preserves the company destination through the login link', async () => {
  await start();
  assert.equal(document.querySelector('input[value="traveler"]').checked, true);
  await choosePurpose('rental');
  const alternative = authSwitch();
  assert.equal(alternative.searchParams.get('next'), companyPath);
  state.next = alternative.searchParams.get('next');
  state.register = false;
  await render();
  assert.match(document.querySelector('.auth-form h2').textContent, /konta wypożyczalni/);
  assert.equal(authSwitch().searchParams.get('next'), companyPath);
  await submit();
  assertAuthPayload(state.requests[0], false);
  assert.deepEqual(state.destinations, [companyPath]);
});

test('generic rental registration continues to company details rather than the traveler dashboard', async () => {
  await start();
  await choosePurpose('rental');
  await submit();
  assertAuthPayload(state.requests[0]);
  assert.deepEqual(state.destinations, [companyPath]);
});

test('traveler registration preserves a booking destination after changing purposes', async () => {
  await start({ next: bookingPath });
  await choosePurpose('rental');
  assert.equal(authSwitch().searchParams.get('next'), companyPath);
  await choosePurpose('traveler');
  assert.equal(authSwitch().searchParams.get('next'), bookingPath);
  await submit();
  assertAuthPayload(state.requests[0]);
  assert.deepEqual(state.destinations, [bookingPath]);
});

test('choosing traveler in a company context clears the company destination', async () => {
  await start({ next: companyPath });
  await choosePurpose('traveler');
  assert.equal(authSwitch().searchParams.get('next'), '/konto');
  assert.equal(document.querySelector('.signup-progress'), null);
  await submit();
  assertAuthPayload(state.requests[0]);
  assert.deepEqual(state.destinations, ['/konto']);
});

test('an existing traveler continues company onboarding without another registration form', async () => {
  await start({ next: companyPath, user: traveler });
  assert.equal(document.querySelector('form'), null);
  assert.equal(document.querySelector('.registration-purpose'), null);
  const continuation = document.querySelector('.test-notice a[href="' + companyPath + '"]');
  assert.ok(continuation);
  assert.match(continuation.textContent, /Dokończ rejestrację wypożyczalni/);
  assert.deepEqual(state.requests, []);
});

test('the traveler dashboard explains the account type and can add a rental to the same account', async () => {
  await start({ account: true, user: traveler });
  const summary = document.querySelector('.account-type-summary');
  assert.match(summary.textContent, /Konto podróżującego/);
  assert.ok(summary.querySelector('a[href="' + companyPath + '"]'));
  assert.deepEqual(state.requests, []);
});

test('the owner portal login explains its audience and routes an owner to the company panel', async () => {
  await start({
    register: false,
    authAudience: 'owner',
    sessionUser: { ...traveler, role: 'owner' },
  });
  assert.match(
    document.querySelector('.auth-form h2').textContent,
    /Zaloguj się do konta wypożyczalni/,
  );
  assert.match(
    document.querySelector('.account-purpose').textContent,
    /tego samego adresu e-mail i hasła/,
  );
  await submit();
  assertAuthPayload(state.requests[0], false);
  assert.deepEqual(state.destinations, ['/company']);
});

test('auth ignores external and malformed next destinations', async () => {
  for (const next of [
    'https://example.invalid',
    '//example.invalid',
    '/\\example.invalid',
    '/konto\n',
    '/konto\u0000',
  ]) {
    await start({ register: false, next });
    assert.equal(authSwitch().searchParams.get('next'), '/konto');
    await submit();
    assertAuthPayload(state.requests[0], false);
    assert.deepEqual(state.destinations, ['/konto']);
    await act(async () => root.unmount());
    root = undefined;
  }
});

test('owner login preserves a deep panel destination and its query', async () => {
  await start({
    register: false,
    authAudience: 'owner',
    authReturnTo: '/company/messages?conversation=booking-1#thread',
    sessionUser: { ...traveler, role: 'owner' },
  });
  await submit();
  assert.deepEqual(state.destinations, ['/company/messages?conversation=booking-1#thread']);
});

test('login canonicalizes legacy company links without changing a vehicle identifier', async () => {
  await start({
    register: false,
    next: '/firma/pojazd/kalendarz?edit=1#photos',
    sessionUser: { ...traveler, role: 'owner' },
  });
  await submit();
  assert.deepEqual(state.destinations, ['/company/vehicle/kalendarz?edit=1#photos']);
});

test('duplicate submit sends one request and a failed request can be retried', async () => {
  await start({ next: companyPath, defer: true });
  fillCredentials();
  await act(async () => {
    dispatchSubmit();
    dispatchSubmit();
  });
  assert.equal(state.requests.length, 1);
  assert.equal(document.querySelector('form button').disabled, true);
  assert.equal(document.querySelector('.registration-purpose').disabled, true);
  await act(async () => state.pending[0].reject(new Error('Test auth failure')));
  assert.deepEqual(state.errors, ['Test auth failure']);
  assert.equal(document.querySelector('form button').disabled, false);
  assert.equal(document.querySelector('.registration-purpose').disabled, false);
  assert.equal(state.sessions, 0);
  assert.deepEqual(state.destinations, []);
  await act(async () => {
    dispatchSubmit();
    dispatchSubmit();
  });
  assert.equal(state.requests.length, 2);
  await act(async () => state.pending[1].resolve({ ok: true }));
  assertAuthPayload(state.requests[1]);
  assert.equal(state.sessions, 1);
  assert.deepEqual(state.destinations, [companyPath]);
  assert.equal(document.querySelector('form button').disabled, false);
});

test('password recovery displays the API message instead of a hardcoded local-only notice', async () => {
  await start({ register: false });
  await act(async () => document.querySelector('.auth-forgot').click());
  await submit();
  assert.equal(state.requests.length, 1);
  assert.deepEqual(state.requests[0], {
    path: '/auth/forgot',
    method: 'POST',
    body: { email: credentials.email },
  });
  assert.deepEqual(state.notices, [state.forgotMessage]);
  assert.equal(state.sessions, 0);
  assert.deepEqual(state.destinations, []);
  assert.match(document.querySelector('.auth-forgot').textContent, /Nie pamiętam hasła/);
});

test('profile does not treat the legacy marketing flag as confirmed consent', async () => {
  await start({
    account: true,
    accountTab: 'profil',
    user: { ...traveler, profile: { marketing: true } },
    data: { '/newsletter/status': { status: 'unsubscribed' } },
  });
  assert.equal(document.querySelector('input[name="marketing"]').checked, false);
  assert.match(document.body.textContent, /poprosimy o potwierdzenie w osobnej wiadomości/);
  assert.ok(
    [...document.querySelectorAll('button')].some(
      (button) => button.textContent === 'Wyślij nowy link potwierdzenia',
    ),
  );
});

test('pending double opt-in remains selected on profile save and never claims confirmation', async () => {
  await start({
    account: true,
    accountTab: 'profil',
    user: { ...traveler, profile: { marketing: false } },
    data: { '/newsletter/status': { status: 'pending' } },
    responses: { '/auth/profile': { profile: { marketing: false, newsletterStatus: 'pending' } } },
  });
  assert.equal(document.querySelector('input[name="marketing"]').checked, true);
  assert.match(document.body.textContent, /Inspiracje czekają na potwierdzenie/);
  await act(async () => dispatchSubmit());
  assert.equal(state.requests[0].path, '/auth/profile');
  assert.equal(state.requests[0].body.marketing, true);
  assert.equal(state.sessions, 1);
  assert.equal(state.reloads, 1);
  assert.equal(document.querySelector('input[name="marketing"]').checked, true);
});

test('email verification resend is a separate action and displays the API outcome', async () => {
  const message = 'Jeśli adres wymaga potwierdzenia, otrzymasz nowy link.';
  await start({
    account: true,
    accountTab: 'profil',
    user: traveler,
    data: { '/newsletter/status': { status: 'unsubscribed' } },
    responses: { '/auth/resend-verification': { ok: true, message } },
  });
  const resend = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === 'Wyślij nowy link potwierdzenia',
  );
  await act(async () => resend.click());
  assert.deepEqual(state.requests, [
    { path: '/auth/resend-verification', method: 'POST', body: {} },
  ]);
  assert.deepEqual(state.notices, [message]);
  assert.equal(state.sessions, 0);
  await act(async () => root.unmount());
  root = undefined;
  await start({
    account: true,
    accountTab: 'profil',
    user: { ...traveler, email_verified_at: '2026-10-07T12:00:00Z' },
    data: { '/newsletter/status': { status: 'confirmed' } },
  });
  assert.match(document.body.textContent, /Adres e-mail jest potwierdzony/);
  assert.ok(
    ![...document.querySelectorAll('button')].some(
      (button) => button.textContent === 'Wyślij nowy link potwierdzenia',
    ),
  );
});

test('newsletter status errors do not silently overwrite an existing preference', async () => {
  await start({
    account: true,
    accountTab: 'profil',
    user: traveler,
    data: { '/newsletter/status': null },
    dataErrors: { '/newsletter/status': 'Nie można odczytać preferencji.' },
  });
  assert.equal(document.querySelector('input[name="marketing"]').disabled, true);
  assert.equal(
    [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Zapisz profil',
    ).disabled,
    true,
  );
  assert.match(document.body.textContent, /Nie można odczytać preferencji/);
});

function exampleBooking(status = 'held') {
  return {
    id: 'booking-1',
    reference: 'VL-8A4C2D7E91',
    status,
    user_id: traveler.id,
    vehicle_name: 'Adria Twin 600 SPB',
    company_name: 'Bałtyk Campers',
    city: 'Gdańsk',
    street: 'Żeglarska',
    house_number: '12',
    asset: 'campervan.webp',
    guests: 2,
    start_date: '2026-11-15',
    end_date: '2026-11-22',
    hold_until: new Date(Date.now() + 15 * 60000).toISOString(),
    payment_status: 'partial',
    deposit_status: 'scheduled',
    total_minor: 410000,
    paid_minor: 123000,
    deposit_minor: 400000,
    traveler: { name: traveler.name, note: '' },
    payments: [],
    amendments: [],
    handovers: [],
    snapshot: { vehicle: { instant: true }, dueNowMinor: 123000, extras: [] },
  };
}

test('checkout submits contact without payment using a stable reservation request id', async () => {
  await start({
    view: 'checkout',
    user: traveler,
    data: { '/bookings/booking-1': exampleBooking() },
  });
  assert.match(document.body.textContent, /bez wpłaty w VANLY/);
  assert.match(document.body.textContent, /Niepotwierdzona/);
  assert.doesNotMatch(document.body.textContent, /potwierdzona od razu/);
  assert.equal(document.querySelector('select[name="scenario"]'), null);
  document.querySelector('input[name="accept"]').checked = true;
  document.querySelector('textarea[name="note"]').value = 'Odbiór około 10:00.';
  await act(async () => dispatchSubmit());
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].path, '/bookings/booking-1/submit');
  assert.deepEqual(state.requests[0].body, {
    name: traveler.name,
    email: traveler.email,
    note: 'Odbiór około 10:00.',
    accept: true,
  });
  assert.equal(state.requests[0].requestId, 'test-request');
  assert.deepEqual(state.destinations, ['/konto/rezerwacja/booking-1']);
});

test('extracted booking owner action preserves decision, request id and refresh', async () => {
  await start({
    view: 'booking',
    mode: 'owner',
    user: { ...traveler, role: 'owner' },
    data: { '/bookings/booking-1': exampleBooking('pending') },
  });
  const accept = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === 'Potwierdź rezerwację',
  );
  await act(async () => accept.click());
  assert.deepEqual(state.requests, [
    {
      path: '/bookings/booking-1/decision',
      method: 'POST',
      body: { accept: true },
      requestId: 'test-request',
    },
  ]);
  assert.equal(state.reloads, 1);
  assert.ok(!document.body.textContent.includes('Dopłać testowo'));
});

test('local inbox exposes PDF attachments through the authenticated document route', async () => {
  await start({
    account: true,
    accountTab: 'skrzynka',
    user: traveler,
    data: {
      '/mail': [
        {
          id: 1,
          subject: 'Podsumowanie',
          body: 'Treść wiadomości',
          created_at: '2026-10-07T12:00:00Z',
          attachments: [
            { bookingId: 'booking one', documentId: 'document/one', fileName: 'VANLY-summary.pdf' },
          ],
        },
      ],
    },
  });
  const link = document.querySelector('a[download]');
  assert.equal(
    link.getAttribute('href'),
    '/api/v1/bookings/booking%20one/documents/document%2Fone',
  );
  assert.equal(link.getAttribute('download'), 'VANLY-summary.pdf');
  assert.match(link.textContent, /Pobierz PDF/);
});

test('checkout ignores duplicate submissions while the test payment is pending', async () => {
  await start({
    view: 'checkout',
    user: traveler,
    defer: true,
    data: { '/bookings/booking-1': exampleBooking() },
  });
  document.querySelector('input[name="accept"]').checked = true;
  await act(async () => {
    dispatchSubmit();
    dispatchSubmit();
  });
  assert.equal(state.requests.length, 1);
  await act(async () => state.pending[0].reject(Error('Test payment failure')));
  assert.equal(
    document.querySelector('form button[type="submit"], form button.btn.primary').disabled,
    false,
  );
  await act(async () => dispatchSubmit());
  assert.equal(state.requests.length, 2);
  assert.equal(state.requests[0].requestId, state.requests[1].requestId);
  await act(async () => state.pending[1].resolve({ ok: true }));
  assert.deepEqual(state.destinations, ['/konto/rezerwacja/booking-1']);
});

test('booking decision ignores another click until completion and allows retry after failure', async () => {
  await start({
    view: 'booking',
    mode: 'owner',
    user: { ...traveler, role: 'owner' },
    defer: true,
    data: { '/bookings/booking-1': exampleBooking('pending') },
  });
  const accept = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === 'Potwierdź rezerwację',
  );
  await act(async () => {
    accept.click();
    accept.click();
  });
  assert.equal(state.requests.length, 1);
  await act(async () => state.pending[0].reject(Error('Test decision failure')));
  assert.equal(accept.disabled, false);
  await act(async () => accept.click());
  assert.equal(state.requests.length, 2);
  await act(async () => state.pending[1].resolve({ ok: true }));
  assert.equal(state.reloads, 1);
});

test('operator keeps the edited article open when saving fails, then closes it after a successful retry', async () => {
  await start({
    view: 'operator',
    user: { ...traveler, role: 'admin' },
    defer: true,
    data: {
      '/admin/dashboard': {
        articles: [
          {
            id: 'article-1',
            title: 'Artykuł testowy',
            summary: 'Podsumowanie artykułu testowego',
            kind: 'guide',
            published: false,
            body: [['Śródtytuł', 'Treść artykułu testowego']],
          },
        ],
      },
    },
  });
  await act(async () =>
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent === 'Edytuj artykuł')
      .click(),
  );
  document.querySelector('input[name="title"]').value = 'Zachowany nowy tytuł';
  await act(async () => dispatchSubmit());
  await act(async () => state.pending[0].reject(Error('Test article failure')));
  assert.equal(document.querySelector('input[name="title"]').value, 'Zachowany nowy tytuł');
  assert.equal(state.reloads, 0);
  await act(async () => dispatchSubmit());
  await act(async () => state.pending[1].resolve({ ok: true }));
  assert.equal(document.querySelector('input[name="title"]'), null);
  assert.equal(state.reloads, 1);
});

const thread = (vehicleId, text) => ({
  vehicle_id: vehicleId,
  traveler_id: traveler.id,
  company_name: 'Firma ' + vehicleId,
  traveler_name: traveler.name,
  vehicle_name: 'Pojazd ' + vehicleId,
  text,
  created_at: '2026-10-07T12:00:00Z',
  conversation_status: 'waiting',
});
async function writeMessage(text) {
  const input = document.querySelector('textarea');
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(
      input,
      text,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('changing conversation clears the previous draft and a removed thread is no longer displayed', async () => {
  await start({
    account: true,
    accountTab: 'wiadomosci',
    user: traveler,
    data: { '/messages': [thread('one', 'Pierwsza rozmowa'), thread('two', 'Druga rozmowa')] },
  });
  await act(async () => document.querySelectorAll('.conversation-choice')[0].click());
  await writeMessage('Prywatny szkic do pierwszej firmy');
  await act(async () => document.querySelectorAll('.conversation-choice')[1].click());
  assert.equal(document.querySelector('textarea').value, '');
  state.data['/messages'] = [thread('one', 'Pierwsza rozmowa')];
  await render();
  assert.equal(document.querySelector('.conversation-title'), null);
  assert.equal(document.querySelector('textarea'), null);
});

test('conversation send prevents duplicates, retains failed draft and retries against the selected recipient', async () => {
  await start({
    account: true,
    accountTab: 'wiadomosci',
    user: traveler,
    defer: true,
    data: { '/messages': [thread('one', 'Pierwsza rozmowa'), thread('two', 'Druga rozmowa')] },
  });
  await act(async () => document.querySelectorAll('.conversation-choice')[0].click());
  await writeMessage('Treść wiadomości');
  await act(async () => {
    dispatchSubmit();
    dispatchSubmit();
  });
  assert.equal(state.requests.length, 1);
  assert.deepEqual(state.requests[0].body, { vehicleId: 'one', text: 'Treść wiadomości' });
  assert.equal(document.querySelectorAll('.conversation-choice')[1].disabled, true);
  await act(async () => state.pending[0].reject(Error('Test send failure')));
  assert.equal(document.querySelector('textarea').value, 'Treść wiadomości');
  assert.equal(document.querySelectorAll('.conversation-choice')[1].disabled, false);
  await act(async () => dispatchSubmit());
  await act(async () => state.pending[1].resolve({ ok: true }));
  assert.equal(document.querySelector('textarea').value, '');
  assert.equal(state.reloads, 2);
});


test('pending reservation only exposes confirmation and rejection to the rental company', async () => {
  for (const [role, mode] of [['traveler', 'traveler'], ['admin', 'admin']]) {
    await start({ view: 'booking', mode, user: { ...traveler, role }, data: { '/bookings/booking-1': exampleBooking('pending') } });
    assert.match(document.body.textContent, /Rezerwacja jest niepotwierdzona/);
    const buttons = [...document.querySelectorAll('button')].map((button) => button.textContent);
    assert.ok(!buttons.includes('Potwierdź rezerwację'));
    assert.ok(!buttons.includes('Odrzuć rezerwację'));
    await act(async () => root.unmount());
    root = undefined;
  }
});
