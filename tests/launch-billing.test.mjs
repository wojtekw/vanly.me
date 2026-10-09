import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';
import { bookingDocumentSnapshot } from '../packages/documents/model.mjs';
import { validateNotificationGuard } from '../scripts/worker/reminders/guard.mjs';

dotenv.config({ path: '.env.local', quiet: true });
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/vanly_test')
  throw Error('Only isolated vanly_test is permitted');
const schema = 'launch_billing_' + crypto.randomBytes(8).toString('hex');
const scoped = new URL(url);
scoped.searchParams.set('options', '-c search_path=' + schema + ',public');
const admin = new pg.Pool({ connectionString: url });
const db = new pg.Pool({ connectionString: scoped.toString() });
const port = Number(process.env.BILLING_TEST_API_PORT || 4105);
let server, traveler, other, owner, foreign;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const travelerInput = {
  name: 'Podróżnik Testowy',
  email: 'billing-traveler@example.test',
  note: '',
  accept: true,
};
async function request(actor, path, method = 'GET', body, key = crypto.randomUUID()) {
  const response = await fetch('http://127.0.0.1:' + port + '/api/v1' + path, {
    method,
    headers: {
      origin: 'http://localhost:3100',
      'content-type': 'application/json',
      'idempotency-key': key,
      ...(actor ? { cookie: actor.cookie, 'x-csrf-token': actor.csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get('set-cookie'),
  };
}
async function login(email, password) {
  const r = await request(null, '/auth/login', 'POST', { email, password });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { cookie: r.cookie.split(';')[0], csrf: r.data.csrf, user: r.data.user };
}
const vehicle = (name = 'Kamper Testowy') => ({
  name,
  type: 'campervan',
  city: 'Gdańsk',
  lat: null,
  lng: null,
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
  description: 'Pojazd do testów opłaty za dodanie do floty.',
  tagline: 'Test',
  features: [],
  asset: 'campervan.webp',
  status: 'published',
});
async function hold(vehicleId, offset = 30) {
  const q = await request(traveler, '/quotes', 'POST', {
    vehicleId,
    start: day(offset),
    end: day(offset + 3),
    guests: 2,
    extras: {},
    plan: 'full',
  });
  assert.equal(q.status, 201, JSON.stringify(q.data));
  assert.equal(q.data.dueNowMinor, 0);
  assert.equal(q.data.platformFeeMinor, 0);
  assert.equal(q.data.settlementMode, 'direct');
  assert.equal(q.data.balanceDue, null);
  const h = await request(traveler, '/holds', 'POST', { quoteId: q.data.id });
  assert.equal(h.status, 201, JSON.stringify(h.data));
  return h.data;
}
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  const env = {
    ...process.env,
    DATABASE_URL: scoped.toString(),
    API_PORT: String(port),
    APP_ORIGIN: 'http://localhost:3100',
    APP_URL: 'http://localhost:3100',
    TRAVELER_PAYMENT_MODE: 'direct',
    LOCAL_PAYMENTS: 'true',
    MAIL_PROVIDER: 'local',
    MAIL_SES_ENABLED: 'false',
    MAIL_REMINDERS_ENABLED: 'true',
    MAIL_REMINDERS_START_AFTER: '2020-01-01T00:00:00Z',
    UPLOAD_DIR: process.cwd() + '/.local/billing-test-uploads',
  };
  execFileSync(process.execPath, ['scripts/migrate.mjs'], { env, stdio: 'pipe' });
  server = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await request(null, '/health')).data.ok) break;
    } catch {}
    if (i === 99) throw Error(log);
    await new Promise((r) => setTimeout(r, 100));
  }
  const password = crypto.randomBytes(16).toString('hex');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
  await db.query(
    "INSERT INTO companies(id,name,city,verified,settings) VALUES('launch-company','Nowa Firma','Gdańsk',true,'{\"minDays\":2,\"buffer\":1,\"prep\":0}'),('foreign-company','Inna Firma','Łódź',true,'{}')",
  );
  for (const [email, role, company] of [
    ['billing-traveler@example.test', 'traveler', null],
    ['billing-other@example.test', 'traveler', null],
    ['billing-owner@example.test', 'owner', 'launch-company'],
    ['billing-foreign@example.test', 'owner', 'foreign-company'],
  ])
    await db.query(
      'INSERT INTO users(email,name,password_hash,role,company_id) VALUES($1,$2,$3,$4,$5)',
      [email, 'Osoba Testowa', hash, role, company],
    );
  [traveler, other, owner, foreign] = await Promise.all(
    [
      'billing-traveler@example.test',
      'billing-other@example.test',
      'billing-owner@example.test',
      'billing-foreign@example.test',
    ].map((e) => login(e, password)),
  );
});
after(async () => {
  if (server && server.exitCode === null)
    await new Promise((resolve) => {
      server.once('exit', resolve);
      server.kill();
    });
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});
let first, second, third;
test('concurrent vehicle creation yields one free slot and exactly one 200 PLN charge', async () => {
  const responses = await Promise.all(
    ['Pierwszy', 'Drugi'].map((n) => request(owner, '/owner/vehicles', 'POST', vehicle(n))),
  );
  for (const r of responses) assert.equal(r.status, 201, JSON.stringify(r.data));
  const fees = responses
    .map((r) => r.data)
    .sort((a, b) => a.listingFee.amount_minor - b.listingFee.amount_minor);
  [first, second] = fees;
  assert.equal(first.listingFee.amount_minor, 0);
  assert.equal(first.status, 'published');
  assert.equal(second.listingFee.amount_minor, 20000);
  assert.equal(second.status, 'draft');
  assert.equal((await request(null, '/vehicles/' + second.id)).status, 404);
  assert.equal(
    (await request(owner, '/owner/vehicles/' + second.id, 'PATCH', { status: 'published' })).status,
    403,
  );
  assert.equal((await request(traveler, '/owner/billing')).status, 403);
  const own = await request(foreign, '/owner/billing');
  assert.equal(own.data.nextFeeMinor, 0);
  assert.equal(own.data.fees.length, 0);
});
test('creation retries do not duplicate vehicles or fees and client cannot alter price', async () => {
  const key = crypto.randomUUID(),
    body = vehicle('Trzeci');
  const results = await Promise.all([
    request(owner, '/owner/vehicles', 'POST', body, key),
    request(owner, '/owner/vehicles', 'POST', body, key),
  ]);
  for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual(results[0].data, results[1].data);
  third = results[0].data;
  assert.equal(third.listingFee.amount_minor, 20000);
  assert.equal(
    (await request(owner, '/owner/vehicles', 'POST', { ...vehicle(), amountMinor: 0 })).status,
    400,
  );
  assert.equal((await request(owner, '/owner/vehicles', 'POST', vehicle('Inne'), key)).status, 409);
  const count = (await db.query('SELECT count(*)::int n FROM vehicle_listing_fees')).rows[0].n;
  assert.equal(count, 3);
});
test('failed/foreign/tampered listing payments cannot activate a vehicle; successful retries settle once', async () => {
  const path = '/owner/vehicles/' + second.id + '/listing-fee/pay-test';
  assert.equal((await request(foreign, path, 'POST', { scenario: 'success' })).status, 403);
  assert.equal((await request(traveler, path, 'POST', { scenario: 'success' })).status, 403);
  assert.equal(
    (await request(owner, path, 'POST', { scenario: 'success', amountMinor: 1 })).status,
    400,
  );
  assert.equal((await request(owner, path, 'POST', { scenario: 'failure' })).status, 400);
  assert.equal(
    (await request(owner, '/owner/vehicles/' + second.id, 'PATCH', { status: 'published' })).status,
    403,
  );
  const key = crypto.randomUUID();
  const results = await Promise.all([
    request(owner, path, 'POST', { scenario: 'success' }, key),
    request(owner, path, 'POST', { scenario: 'success' }, key),
  ]);
  for (const r of results) {
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.status, 'paid_test');
    assert.equal(r.data.amount_minor, 20000);
  }
  assert.deepEqual(results[0].data, results[1].data);
  assert.equal(
    (await request(owner, path, 'POST', { scenario: 'success' })).data.paid_at,
    results[0].data.paid_at,
  );
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM audit WHERE action='listing.payment_test'"))
      .rows[0].n,
    1,
  );
  assert.equal(
    (await request(owner, '/owner/vehicles/' + second.id, 'PATCH', { status: 'published' })).status,
    200,
  );
  assert.equal(
    (await request(owner, '/owner/vehicles/' + second.id, 'PATCH', { status: 'hidden' })).status,
    200,
  );
  assert.equal(
    (await request(owner, '/owner/vehicles/' + second.id, 'PATCH', { status: 'published' })).status,
    200,
  );
  assert.equal(
    (await request(owner, '/owner/billing')).data.fees.filter((f) => f.vehicle_id === second.id)
      .length,
    1,
  );
});
test('traveler submits without payment, repeats safely, receives PDF and no balance reminders', async () => {
  const held = await hold(first.id);
  const path = '/bookings/' + held.id;
  assert.equal((await request(other, path + '/submit', 'POST', travelerInput)).status, 403);
  assert.equal(
    (await request(traveler, path + '/submit', 'POST', { ...travelerInput, totalMinor: 0 })).status,
    400,
  );
  assert.equal(
    (await request(traveler, path + '/pay-test', 'POST', { ...travelerInput, scenario: 'success' }))
      .status,
    403,
  );
  const key = crypto.randomUUID();
  const results = await Promise.all([
    request(traveler, path + '/submit', 'POST', travelerInput, key),
    request(traveler, path + '/submit', 'POST', travelerInput, key),
  ]);
  for (const r of results) {
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.status, 'confirmed');
    assert.equal(r.data.payment_status, 'external');
    assert.equal(r.data.paid_minor, 0);
    assert.equal(r.data.payments.length, 0);
  }
  assert.deepEqual(results[0].data, results[1].data);
  assert.equal((await request(traveler, path + '/balance-test', 'POST')).status, 403);
  const docs = await request(traveler, path + '/documents');
  assert.equal(docs.status, 200);
  assert.equal(docs.data.length, 1);
  const b = results[0].data;
  const model = bookingDocumentSnapshot(b);
  assert.equal(model.plan, 'direct');
  assert.equal(model.paymentStatus, 'external');
  const events = (
    await db.query('SELECT payload FROM jobs WHERE event_key=$1', ['booking.confirmed:' + held.id])
  ).rows;
  assert.equal(events.length, 1);
  assert.match(JSON.stringify(events), /bezpośrednio z wypożyczalnią/);
  assert.doesNotMatch(JSON.stringify(events), /Termin dopłaty/);
  assert.equal(
    await validateNotificationGuard(db, {
      recipient_user_id: traveler.user.id,
      payload: {
        notificationGuard: {
          kind: 'balance',
          bookingId: held.id,
          dueDate: day(7),
          days: 7,
          totalMinor: b.total_minor,
          paidMinor: 0,
        },
      },
    }),
    false,
  );
  const amendment = await request(traveler, path + '/amendments', 'POST', {
    start: day(32),
    end: day(36),
    note: 'Zmiana terminu',
  });
  assert.equal(amendment.status, 201, JSON.stringify(amendment.data));
  const accepted = await request(owner, '/amendments/' + amendment.data.id + '/decision', 'POST', {
    accept: true,
  });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  assert.equal(accepted.data.payment_status, 'external');
  assert.equal(accepted.data.snapshot.dueNowMinor, 0);
  const cancelled = await request(traveler, path + '/cancel', 'POST');
  assert.equal(cancelled.status, 201);
  assert.equal(cancelled.data.payment_status, 'external');
  assert.equal(cancelled.data.payments.length, 0);
});
test('request bookings need owner approval, and expired holds cannot be submitted', async () => {
  assert.equal(
    (await request(owner, '/owner/vehicles/' + second.id, 'PATCH', { instant: false })).status,
    200,
  );
  const held = await hold(second.id, 60);
  const submitted = await request(
    traveler,
    '/bookings/' + held.id + '/submit',
    'POST',
    travelerInput,
  );
  assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
  assert.equal(submitted.data.status, 'pending');
  assert.equal(submitted.data.payments.length, 0);
  assert.equal(
    (await request(foreign, '/bookings/' + held.id + '/decision', 'POST', { accept: true })).status,
    403,
  );
  assert.equal(
    (await request(owner, '/bookings/' + held.id + '/decision', 'POST', { accept: true })).data
      .status,
    'confirmed',
  );
  const expired = await hold(first.id, 70);
  await db.query("UPDATE bookings SET hold_until=now()-interval '1 second' WHERE id=$1", [
    expired.id,
  ]);
  assert.equal(
    (await request(traveler, '/bookings/' + expired.id + '/submit', 'POST', travelerInput)).status,
    409,
  );
});
test('first vehicle is free for each company independently', async () => {
  const created = await request(foreign, '/owner/vehicles', 'POST', vehicle('Inna firma pierwszy'));
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.listingFee.amount_minor, 0);
  assert.equal(created.data.listingFee.status, 'waived');
  assert.equal((await request(owner, '/owner/billing')).data.nextFeeMinor, 20000);
});
