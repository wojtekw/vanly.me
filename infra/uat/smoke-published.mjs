// Exercise the dedicated UAT through HTTPS, including its access gateway.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const mode = process.argv[2];
assert.ok(['origin', 'public'].includes(mode));
const privatePath = new URL(
  'file://' +
    (
      process.env.VANLY_UAT_PRIVATE_DIR || new URL('../../.local/uat/', import.meta.url).pathname
    ).replace(/\/?$/, '/'),
);
const basic = JSON.parse(await fs.readFile(new URL('basic-auth.json', privatePath), 'utf8'));
const accounts = JSON.parse(
  await fs.readFile(
    process.env.VANLY_UAT_ACCOUNTS ||
      '/Users/wojtek/.local/share/vanly-portal/.local/accounts.json',
    'utf8',
  ),
);
const originSecret = (await fs.readFile(new URL('origin-secret', privatePath), 'utf8')).trim();
const authorization =
  'Basic ' + Buffer.from(`${basic.username}:${basic.password}`).toString('base64');
const hosts = ['uat.vanly.me', 'owner.uat.vanly.me', 'admin.uat.vanly.me'];
const checks = [];
function url(host, path) {
  return `https://${mode === 'origin' ? 'origin.uat.vanly.me' : host}${path}`;
}
function headers(host, authenticated = true) {
  return {
    ...(mode === 'origin' ? { 'x-vanly-origin': originSecret, 'x-vanly-viewer-host': host } : {}),
    ...(authenticated ? { authorization } : {}),
  };
}
async function request(
  session,
  path,
  method = 'GET',
  body,
  key = crypto.randomUUID(),
  host = hosts[0],
) {
  const r = await fetch(url(host, '/api/v1' + path), {
    method,
    headers: {
      ...headers(host),
      origin: `https://${host}`,
      'idempotency-key': key,
      ...(session ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  return { status: r.status, data, cookie: r.headers.get('set-cookie') };
}
function session(result) {
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.match(result.cookie, /^__Host-vanly_session=/);
  assert.match(result.cookie, /Secure/);
  assert.match(result.cookie, /HttpOnly/);
  return { cookie: result.cookie.split(';')[0], csrf: result.data.csrf, user: result.data.user };
}
async function login(email, host = hosts[0]) {
  const account = accounts.find((x) => x.email === email);
  assert.ok(account);
  return session(
    await request(
      null,
      '/auth/login',
      'POST',
      { email: account.email, password: account.password },
      undefined,
      host,
    ),
  );
}
const day = (offset) => {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};
for (const host of hosts) {
  for (const path of ['/', '/api/v1/health', '/api/v1/mail']) {
    const r = await fetch(url(host, path), { headers: headers(host, false) });
    assert.equal(r.status, 401, `${host}${path}`);
    assert.match(r.headers.get('www-authenticate'), /Basic/);
  }
  const wrong = await fetch(url(host, '/'), {
    headers: {
      ...headers(host, false),
      authorization: 'Basic ' + Buffer.from('vanly:incorrect').toString('base64'),
    },
  });
  assert.equal(wrong.status, 401);
  const page = await fetch(url(host, '/'), { headers: headers(host) });
  assert.equal(page.status, 200, host);
  assert.match(page.headers.get('cache-control'), /no-store/);
  assert.match(page.headers.get('x-robots-tag'), /noindex/);
  const html = await page.text();
  assert.match(html, /<!doctype html>/i);
  const asset = html.match(/(?:src|href)="([^"\s]+\.(?:js|css)(?:\?[^"\s]*)?)"/);
  if (asset) {
    const path = new URL(asset[1], `https://${host}`).pathname;
    assert.equal((await fetch(url(host, path), { headers: headers(host, false) })).status, 401);
    assert.equal((await fetch(url(host, path), { headers: headers(host) })).status, 200);
  }
  assert.equal((await request(null, '/health', 'GET', undefined, undefined, host)).data.ok, true);
}
assert.equal(
  (await fetch('https://origin.uat.vanly.me/api/v1/health', { headers: { authorization } })).status,
  403,
);
checks.push(
  'three HTTPS hosts: Basic Auth, wrong password, API/assets, no-store/noindex, blocked direct origin',
);
if (mode === 'origin') {
  console.log(JSON.stringify({ ok: true, mode, checks }));
  process.exit(0);
}
const owner = await login('baltic@vanly.local');
const admin = await login('operator@vanly.local');
const ownerPanel = await login('baltic@vanly.local', hosts[1]);
const adminPanel = await login('operator@vanly.local', hosts[2]);
assert.equal(
  (await request(ownerPanel, '/owner/dashboard', 'GET', undefined, undefined, hosts[1])).status,
  200,
);
assert.equal(
  (await request(adminPanel, '/admin/dashboard', 'GET', undefined, undefined, hosts[2])).status,
  200,
);
const traveler = session(
  await request(null, '/auth/register', 'POST', {
    email: `uat-public-${crypto.randomUUID()}@example.test`,
    name: 'Tester publicznego UAT',
    password: crypto.randomBytes(24).toString('hex'),
  }),
);
assert.equal((await request(traveler, '/auth/me')).data.user.id, traveler.user.id);
assert.equal((await request(traveler, '/admin/dashboard')).status, 403);
checks.push('registration, secure sessions, owner/admin logins and role boundaries');
let quote;
for (const offset of [330, 350, 370, 390]) {
  const result = await request(traveler, '/quotes', 'POST', {
    vehicleId: 'coast',
    start: day(offset),
    end: day(offset + 7),
    guests: 2,
    extras: {},
    plan: 'deposit',
  });
  if (result.status === 201) {
    quote = result.data;
    break;
  }
  assert.equal(result.status, 409, JSON.stringify(result.data));
}
assert.ok(quote);
let booking = await request(traveler, '/holds', 'POST', { quoteId: quote.id });
assert.equal(booking.status, 201, JSON.stringify(booking.data));
const id = booking.data.id;
const paymentKey = crypto.randomUUID();
const payment = {
  name: traveler.user.name,
  email: traveler.user.email,
  note: 'Test publicznego UAT',
  accept: true,
};
booking = await request(traveler, `/bookings/${id}/submit`, 'POST', payment, paymentKey);
assert.equal(booking.status, 201, JSON.stringify(booking.data));
const duplicate = await request(traveler, `/bookings/${id}/submit`, 'POST', payment, paymentKey);
assert.equal(duplicate.status, 201);
assert.equal(duplicate.data.paid_minor, booking.data.paid_minor);
if (booking.data.status === 'pending')
  booking = await request(owner, `/bookings/${id}/decision`, 'POST', { accept: true });
assert.equal(booking.data.status, 'confirmed');
const documents = await request(traveler, `/bookings/${id}/documents`);
assert.equal(documents.status, 200);
assert.ok(documents.data.length);
const pdfPath = `/api/v1/bookings/${id}/documents/${documents.data[0].documentId}`;
assert.equal(
  (await fetch(url(hosts[0], pdfPath), { headers: { cookie: traveler.cookie } })).status,
  401,
);
const pdf = await fetch(url(hosts[0], pdfPath), {
  headers: { ...headers(hosts[0]), cookie: traveler.cookie },
});
assert.equal(pdf.status, 200);
assert.match(pdf.headers.get('content-type'), /application\/pdf/);
assert.equal(
  Buffer.from(await pdf.arrayBuffer())
    .subarray(0, 5)
    .toString(),
  '%PDF-',
);
assert.equal(quote.dueNowMinor, 0);
assert.equal(booking.data.payment_status, 'external');
assert.equal(booking.data.paid_minor, 0);
assert.equal(booking.data.payments.length, 0);
checks.push(
  'quote, hold, reservation without payment, idempotency, confirmation and protected PDF',
);
assert.equal(
  (
    await request(traveler, '/messages', 'POST', {
      vehicleId: 'coast',
      text: 'Wiadomość z publicznego testu UAT',
    })
  ).status,
  201,
);
const messages = await request(owner, `/messages?vehicle=coast&traveler=${traveler.user.id}`);
assert.equal(messages.status, 200);
assert.ok(messages.data.length);
assert.equal((await request(traveler, `/bookings/${id}/balance-test`, 'POST')).status, 403);
booking = await request(traveler, `/bookings/${id}/cancel`, 'POST');
assert.equal(booking.status, 201);
assert.equal(booking.data.payment_status, 'external');
assert.equal((await request(admin, `/bookings/${id}/refund-test`, 'POST')).status, 409);
checks.push('messages, blocked traveler payments, cancellation without platform refund');
let delivered = false;
for (let attempt = 0; attempt < 30; attempt++) {
  const mail = await request(traveler, '/mail');
  assert.equal(mail.status, 200);
  if (mail.data.length) {
    delivered = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
assert.ok(delivered, 'Worker did not deliver into private test inbox');
checks.push('worker and private client test inbox');
// Dedicated test company checks the first/second/third vehicle boundary on the deployed API.
const renter = session(
  await request(null, '/auth/register', 'POST', {
    email: `uat-billing-${crypto.randomUUID()}@example.test`,
    name: 'Wypożyczalnia Testowa UAT',
    password: crypto.randomBytes(24).toString('hex'),
  }),
);
const onboard = await request(renter, '/company-onboarding', 'POST', {
  name: 'UAT TEST — opłaty za flotę',
});
assert.equal(onboard.status, 201);
const companyId = onboard.data.id;
assert.equal(
  (
    await request(admin, `/admin/companies/${companyId}/verify`, 'POST', {
      verified: true,
      reason: 'Test UAT nowego modelu opłat',
    })
  ).status,
  201,
);
const vehicle = (name) => ({
  name,
  type: 'campervan',
  city: 'Gdańsk',
  seats: 4,
  sleeps: 4,
  daily: 50000,
  prep: 0,
  deposit: 300000,
  min_days: 2,
  auto: false,
  pets: false,
  instant: true,
  km: 200,
  description: 'Dedykowany pojazd testowy UAT do kontroli opłat.',
  tagline: 'TEST UAT',
  features: [],
  asset: 'campervan.webp',
  status: 'published',
});
const created = [];
for (const name of ['UAT TEST — pierwszy', 'UAT TEST — drugi', 'UAT TEST — trzeci']) {
  const key = crypto.randomUUID(),
    body = vehicle(name);
  const r = await request(renter, '/owner/vehicles', 'POST', body, key);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  created.push(r.data);
  const again = await request(renter, '/owner/vehicles', 'POST', body, key);
  assert.equal(again.status, 201);
  assert.equal(again.data.id, r.data.id);
}
assert.deepEqual(
  created.map((v) => v.listingFee.amount_minor),
  [0, 20000, 20000],
);
assert.equal(created[0].status, 'published');
assert.equal(created[1].status, 'draft');
const feePath = `/owner/vehicles/${created[1].id}/listing-fee/pay-test`;
assert.equal((await request(owner, feePath, 'POST', { scenario: 'success' })).status, 403);
assert.equal((await request(renter, feePath, 'POST', { scenario: 'failure' })).status, 400);
assert.equal(
  (await request(renter, `/owner/vehicles/${created[1].id}`, 'PATCH', { status: 'published' }))
    .status,
  403,
);
const key = crypto.randomUUID();
const paid = await request(renter, feePath, 'POST', { scenario: 'success' }, key);
assert.equal(paid.status, 201);
assert.equal(paid.data.amount_minor, 20000);
assert.equal(paid.data.status, 'paid_test');
const replay = await request(renter, feePath, 'POST', { scenario: 'success' }, key);
assert.equal(replay.status, 201);
assert.deepEqual(replay.data, paid.data);
assert.equal(
  (await request(renter, `/owner/vehicles/${created[1].id}`, 'PATCH', { status: 'published' }))
    .status,
  200,
);
assert.equal((await request(renter, '/owner/billing')).data.fees.length, 3);
// Keep test history for review, hiding its offers from the public catalogue.
for (const v of created)
  assert.equal(
    (await request(renter, `/owner/vehicles/${v.id}`, 'PATCH', { status: 'hidden' })).status,
    200,
  );
checks.push(
  'first vehicle free, second/third 200 PLN, creation/payment retries, failure, company isolation and publication gate',
);
const result = {
  ok: true,
  mode,
  checks,
  booking_id: id,
  test_user_id: traveler.user.id,
  billing_company_id: companyId,
  billing_vehicle_ids: created.map((v) => v.id),
};
await fs.writeFile(new URL('public-smoke.json', privatePath), JSON.stringify(result, null, 2), {
  mode: 0o600,
});
console.log(JSON.stringify(result));
