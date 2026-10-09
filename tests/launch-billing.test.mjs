import { resolveMailDocuments } from '../packages/documents/service.mjs';
import { renderMail } from '../packages/mailer/renderer.mjs';
import { loadMailerConfig } from '../packages/mailer/config.mjs';
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
let server, traveler, other, owner, foreign, operator;
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
const vehicle = (name = 'Kamper Testowy', overrides = {}) => ({
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
  ...overrides,
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
    ['billing-admin@example.test', 'admin', null],
  ])
    await db.query(
      'INSERT INTO users(email,name,password_hash,role,company_id) VALUES($1,$2,$3,$4,$5)',
      [email, 'Osoba Testowa', hash, role, company],
    );
  [traveler, other, owner, foreign, operator] = await Promise.all(
    [
      'billing-traveler@example.test',
      'billing-other@example.test',
      'billing-owner@example.test',
      'billing-foreign@example.test',
      'billing-admin@example.test',
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
test('concurrent draft creation allocates exactly one free vehicle; unfunded publication rolls back', async () => {
  const responses = await Promise.all(
    ['Pierwszy', 'Drugi'].map((n) =>
      request(owner, '/owner/vehicles', 'POST', vehicle(n, { status: 'draft' })),
    ),
  );
  for (const r of responses) assert.equal(r.status, 201, JSON.stringify(r.data));
  [first, second] = responses
    .map((r) => r.data)
    .sort((a, b) => Number(b.publication.exempt) - Number(a.publication.exempt));
  assert.equal(first.publication.exempt, true);
  assert.equal(second.publication.exempt, false);
  assert.equal(
    (await request(owner, '/owner/vehicles/' + first.id, 'PATCH', { status: 'published' })).status,
    200,
  );
  assert.equal((await request(null, '/vehicles/' + second.id)).status, 404);
  assert.equal(
    (await request(owner, '/owner/vehicles/' + second.id, 'PATCH', { status: 'published' })).status,
    409,
  );
  const refused = await request(owner, '/owner/vehicles', 'POST', vehicle('Bez Creditsów'));
  assert.equal(refused.status, 409);
  assert.equal((await db.query('SELECT count(*)::int n FROM vehicles')).rows[0].n, 2);
  assert.equal((await request(traveler, '/owner/billing')).status, 403);
  const own = await request(foreign, '/owner/billing');
  assert.equal(own.data.nextPublicationCredits, 0);
  assert.equal(own.data.wallet.balance, 0);
  assert.deepEqual(own.data.ledger, []);
});
test('creation retries do not duplicate vehicles and clients cannot provide billing fields', async () => {
  const key = crypto.randomUUID(),
    body = vehicle('Trzeci', { status: 'draft' });
  const results = await Promise.all([
    request(owner, '/owner/vehicles', 'POST', body, key),
    request(owner, '/owner/vehicles', 'POST', body, key),
  ]);
  for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual(results[0].data, results[1].data);
  third = results[0].data;
  assert.equal(third.publication.exempt, false);
  assert.equal(
    (await request(owner, '/owner/vehicles', 'POST', { ...vehicle(), amountMinor: 0 })).status,
    400,
  );
  assert.equal((await request(owner, '/owner/vehicles', 'POST', vehicle('Inne'), key)).status, 409);
  assert.equal((await db.query('SELECT count(*)::int n FROM vehicle_publications')).rows[0].n, 3);
});
test('shared wallet buys 50 Credits for 10000 PLN once; failures and tampering never credit it', async () => {
  const path = '/owner/credits/buy-test';
  assert.equal((await request(traveler, path, 'POST', { credits: 50 })).status, 403);
  for (const credits of [0, -1, 1.5, 100001, '50', true])
    assert.equal((await request(owner, path, 'POST', { credits })).status, 400);
  assert.equal(
    (
      await request(owner, path, 'POST', {
        credits: 50,
        amountMinor: 1,
        companyId: 'foreign-company',
      })
    ).status,
    400,
  );
  assert.equal(
    (await request(owner, path, 'POST', { credits: 50, scenario: 'failure' })).status,
    400,
  );
  assert.equal((await request(owner, '/owner/billing')).data.wallet.balance, 0);
  const key = crypto.randomUUID();
  const results = await Promise.all([
    request(owner, path, 'POST', { credits: 50 }, key),
    request(owner, path, 'POST', { credits: 50 }, key),
  ]);
  for (const r of results) {
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.amount_minor, 1000000);
    assert.equal(r.data.credits, 50);
  }
  assert.deepEqual(results[0].data, results[1].data);
  assert.equal((await request(owner, path, 'POST', { credits: 51 }, key)).status, 409);
  assert.equal((await request(foreign, '/owner/billing')).data.wallet.balance, 0);
  assert.equal(
    (await request(foreign, '/owner/vehicles/' + second.id, 'PATCH', { status: 'published' }))
      .status,
    403,
  );
  assert.equal(
    (
      await request(owner, '/owner/vehicles/' + second.id + '/listing-fee/pay-test', 'POST', {
        scenario: 'success',
      })
    ).status,
    410,
  );
  for (const id of [second.id, third.id]) {
    const r = await request(owner, '/owner/vehicles/' + id, 'PATCH', { status: 'published' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(
      (await request(owner, '/owner/vehicles/' + id, 'PATCH', { status: 'published' })).status,
      200,
    );
  }
  assert.equal((await request(owner, '/owner/billing')).data.wallet.balance, 48);
  const period = (await request(owner, '/owner/billing')).data.publications.find(
    (p) => p.vehicle_id === second.id,
  ).valid_until;
  for (const status of ['hidden', 'published'])
    assert.equal(
      (await request(owner, '/owner/vehicles/' + second.id, 'PATCH', { status })).status,
      200,
    );
  const billing = (await request(owner, '/owner/billing')).data;
  assert.equal(billing.wallet.balance, 48);
  assert.equal(billing.publications.find((p) => p.vehicle_id === second.id).valid_until, period);
  assert.equal(billing.ledger.filter((e) => e.kind === 'purchase_test').length, 1);
});
const instructions =
  'Zaliczka: 30% ceny najmu, płatna w ciągu 7 dni od potwierdzenia. Pozostała kwota: przed odbiorem. Dane przelewu: TESTOWY ODBIORCA. W tytule podaj numer rezerwacji. Kaucja: przy odbiorze. <script>treść testowa</script>';
test('confirmation requires rental instructions; company defaults remain private, scoped and survive other settings changes', async () => {
  const held = await hold(first.id, 10);
  await request(traveler, '/bookings/' + held.id + '/submit', 'POST', travelerInput);
  assert.equal(
    (await request(owner, '/bookings/' + held.id + '/decision', 'POST', { accept: true })).status,
    400,
  );
  const pending = (await request(traveler, '/bookings/' + held.id)).data;
  assert.equal(pending.status, 'pending');
  assert.equal(pending.payment_instructions, '');
  assert.equal((await request(traveler, '/bookings/' + held.id + '/documents')).data.length, 0);
  assert.equal(
    (await request(owner, '/bookings/' + held.id + '/decision', 'POST', { accept: false })).status,
    201,
  );
  assert.equal(
    (
      await request(traveler, '/owner/payment-instructions', 'PATCH', {
        paymentInstructions: instructions,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(owner, '/owner/payment-instructions', 'PATCH', {
        paymentInstructions: instructions,
        companyId: 'foreign-company',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(owner, '/owner/payment-instructions', 'PATCH', {
        paymentInstructions: 'krótko',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(owner, '/owner/payment-instructions', 'PATCH', {
        paymentInstructions: instructions,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(foreign, '/owner/payment-instructions', 'PATCH', {
        paymentInstructions: 'Inna firma: odrębny sposób rozliczenia wynajmu.',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(owner, '/owner/settings', 'PATCH', {
        minDays: 2,
        buffer: 1,
        prep: 0,
        open: '09:00',
        close: '17:00',
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(owner, '/owner/dashboard')).data.company.settings.paymentInstructions,
    instructions,
  );
  const publicVehicle = (await request(null, '/vehicles/' + first.id)).data;
  assert.ok(!Object.hasOwn(publicVehicle.settings, 'paymentInstructions'));
  assert.ok(!(await request(null, '/catalog')).data.some((v) => v.settings?.paymentInstructions));
  const quote = (
    await request(traveler, '/quotes', 'POST', {
      vehicleId: first.id,
      start: day(15),
      end: day(18),
      guests: 2,
      extras: {},
    })
  ).data;
  assert.ok(!Object.hasOwn(quote.companySettings, 'paymentInstructions'));
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
    assert.equal(r.data.status, 'pending');
    assert.equal(r.data.reservation_status, 'pending');
    assert.equal(r.data.payment_status, 'external');
    assert.equal(r.data.paid_minor, 0);
    assert.equal(r.data.payments.length, 0);
  }
  assert.deepEqual(results[0].data, results[1].data);
  assert.equal((await request(traveler, path + '/balance-test', 'POST')).status, 403);
  assert.equal((await request(traveler, path + '/documents')).data.length, 0);
  assert.equal(
    (
      await request(owner, path + '/handovers', 'POST', {
        kind: 'pickup',
        mileage: 12000,
        fuel: 'Pełny',
        notes: '',
        checks: { equipment: true, condition: true, fuel: true },
      })
    ).status,
    409,
  );
  assert.equal((await request(traveler, path + '/decision', 'POST', { accept: true })).status, 403);
  assert.equal((await request(operator, path + '/decision', 'POST', { accept: true })).status, 403);
  assert.equal((await request(foreign, path + '/decision', 'POST', { accept: true })).status, 403);
  const acceptedBooking = await request(owner, path + '/decision', 'POST', { accept: true });
  assert.equal(acceptedBooking.status, 201, JSON.stringify(acceptedBooking.data));
  assert.equal(acceptedBooking.data.status, 'confirmed');
  assert.equal(acceptedBooking.data.reservation_status, 'confirmed');
  assert.equal((await request(owner, path + '/decision', 'POST', { accept: false })).status, 409);
  const docs = await request(traveler, path + '/documents');
  assert.equal(docs.status, 200);
  assert.equal(docs.data.length, 1);
  const b = acceptedBooking.data;
  const model = bookingDocumentSnapshot(b);
  assert.equal(model.plan, 'direct');
  assert.equal(model.paymentStatus, 'external');
  const events = (
    await db.query('SELECT payload FROM jobs WHERE event_key=$1', ['booking.confirmed:' + held.id])
  ).rows;
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.template, '13-potwierdzenie-i-platnosc');
  assert.equal(events[0].payload.variables.traveler_name, travelerInput.name);
  assert.equal(events[0].payload.variables.booking_number, b.reference);
  assert.equal(events[0].payload.variables.payment_instructions, instructions);
  assert.equal(b.payment_instructions, instructions);
  const attachments = await resolveMailDocuments(db, events[0].payload.documentRefs, {
    recipient_user_id: traveler.user.id,
  });
  const rendered = renderMail(
    events[0].payload,
    loadMailerConfig({ APP_URL: 'http://localhost:3100' }),
    { name: 'Inne imię konta' },
    new Date(),
    attachments,
  );
  assert.match(rendered.subject, /instrukcja płatności/);
  assert.match(rendered.text, new RegExp(travelerInput.name));
  assert.match(rendered.text, /Zaliczka: 30%/);
  assert.match(rendered.html, /&lt;script&gt;/);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.doesNotMatch(rendered.text, /Zapłacono:|Pozostało do zapłaty:|Termin dopłaty:/);

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
  assert.equal(cancelled.data.reservation_status, 'cancelled');
  assert.equal(cancelled.data.payment_status, 'external');
  assert.equal(cancelled.data.payments.length, 0);
});
test('request bookings need owner approval, and expired holds cannot be submitted', async () => {
  assert.equal(
    (await request(owner, '/owner/vehicles/' + second.id, 'PATCH', { instant: true })).status,
    200,
  );
  assert.equal((await request(null, '/vehicles/' + second.id)).data.instant, false);
  // Even old inventory and already-saved quotes cannot bypass owner approval.
  await db.query('UPDATE vehicles SET instant=true WHERE id=$1', [second.id]);
  const held = await hold(second.id, 60);
  assert.equal(held.snapshot.vehicle.instant, false);
  await db.query(
    `UPDATE bookings SET snapshot=jsonb_set(snapshot,'{vehicle,instant}','true') WHERE id=$1`,
    [held.id],
  );
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
  assert.equal(
    (await request(traveler, '/bookings/' + expired.id)).data.reservation_status,
    'cancelled',
  );
});
test('first vehicle is free for each company independently', async () => {
  const created = await request(foreign, '/owner/vehicles', 'POST', vehicle('Inna firma pierwszy'));
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.publication.exempt, true);
  assert.equal(created.data.publication.months, 0);
  assert.equal((await request(owner, '/owner/billing')).data.nextPublicationCredits, 1);
});

test('owner rejection and traveler cancellation release dates without payments or confirmation documents', async () => {
  for (const [offset, operation, actor, terminal] of [
    [90, 'decision', owner, 'rejected'],
    [100, 'cancel', traveler, 'cancelled'],
  ]) {
    const held = await hold(first.id, offset);
    const path = '/bookings/' + held.id;
    assert.equal(
      (await request(traveler, path + '/submit', 'POST', travelerInput)).data.status,
      'pending',
    );
    const blocked = await request(traveler, '/quotes', 'POST', {
      vehicleId: first.id,
      start: day(offset),
      end: day(offset + 3),
      guests: 2,
      extras: {},
    });
    assert.equal(blocked.status, 409);
    const result = await request(
      actor,
      path + '/' + operation,
      'POST',
      operation === 'decision' ? { accept: false } : undefined,
    );
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.equal(result.data.reservation_status, terminal);
    assert.equal(result.data.payments.length, 0);
    assert.equal((await request(traveler, path + '/documents')).data.length, 0);
    assert.equal((await request(owner, path + '/decision', 'POST', { accept: true })).status, 409);
    assert.equal(
      (
        await request(traveler, '/quotes', 'POST', {
          vehicleId: first.id,
          start: day(offset),
          end: day(offset + 3),
          guests: 2,
          extras: {},
        })
      ).status,
      201,
    );
  }
});

test('opposing owner decisions commit exactly one outcome and one outcome notification', async () => {
  const held = await hold(first.id, 120);
  const path = '/bookings/' + held.id;
  await request(traveler, path + '/submit', 'POST', travelerInput);
  const results = await Promise.all(
    [true, false].map((accept) => request(owner, path + '/decision', 'POST', { accept })),
  );
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  const booking = (await request(traveler, path)).data;
  assert.ok(['confirmed', 'rejected'].includes(booking.reservation_status));
  assert.equal(booking.payments.length, 0);
  const outcomes = (
    await db.query(
      "SELECT count(*)::int n FROM audit WHERE resource=$1 AND action IN('booking.accepted','booking.rejected')",
      [held.id],
    )
  ).rows[0].n;
  assert.equal(outcomes, 1);
  const notifications = (
    await db.query('SELECT count(*)::int n FROM jobs WHERE event_key=ANY($1::text[])', [
      ['booking.confirmed:' + held.id, 'booking.rejected:' + held.id],
    ])
  ).rows[0].n;
  assert.equal(notifications, 1);
});

test('expired paid publication fails closed across discovery and new bookings while existing bookings remain serviceable', async () => {
  const created = await request(
    owner,
    '/owner/vehicles',
    'POST',
    vehicle('Wygasła oferta', { city: 'Tylko Wygaśnięcie' }),
  );
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.id;
  const quote = await request(traveler, '/quotes', 'POST', {
    vehicleId: id,
    start: day(150),
    end: day(154),
    guests: 2,
    extras: {},
  });
  assert.equal(quote.status, 201);
  assert.equal((await request(traveler, '/favorites/' + id, 'POST')).status, 201);
  await db.query(
    "UPDATE vehicle_publications SET anchor_at=now()-interval '2 months',months=1,valid_until=now()-interval '1 month' WHERE vehicle_id=$1",
    [id],
  );
  assert.equal((await request(null, '/vehicles/' + id)).status, 404);
  assert.ok(!(await request(null, '/catalog')).data.some((v) => v.id === id));
  assert.ok(!(await request(null, '/locations')).data.some((v) => v.city === 'Tylko Wygaśnięcie'));
  assert.ok(!(await request(null, '/seo/inventory')).data.vehicles.some((v) => v.id === id));
  assert.ok(!(await request(traveler, '/favorites')).data.some((v) => v.id === id));
  assert.equal(
    (
      await request(traveler, '/quotes', 'POST', {
        vehicleId: id,
        start: day(150),
        end: day(154),
        guests: 2,
        extras: {},
      })
    ).status,
    404,
  );
  assert.equal((await request(traveler, '/holds', 'POST', { quoteId: quote.data.id })).status, 404);
  assert.equal(
    (
      await request(traveler, '/vehicles/' + id + '/questions', 'POST', {
        text: 'Czy pojazd jest dostępny?',
      })
    ).status,
    404,
  );
  assert.equal(
    (await request(traveler, '/messages', 'POST', { vehicleId: id, text: 'Nowa rozmowa' })).status,
    404,
  );
  // Credit expiry cannot break an already confirmed rental's amendment workflow.
  const booking = (
    await db.query("SELECT id FROM bookings WHERE vehicle_id=$1 AND status='confirmed' LIMIT 1", [
      second.id,
    ])
  ).rows[0];
  await db.query("UPDATE vehicles SET status='hidden' WHERE id=$1", [second.id]);
  const amendment = await request(traveler, '/bookings/' + booking.id + '/amendments', 'POST', {
    start: day(170),
    end: day(174),
    note: 'Zmiana po ukryciu oferty',
  });
  assert.equal(amendment.status, 201, JSON.stringify(amendment.data));
  const decided = await request(owner, '/amendments/' + amendment.data.id + '/decision', 'POST', {
    accept: true,
  });
  assert.equal(decided.status, 201, JSON.stringify(decided.data));
  assert.equal(decided.data.payment_status, 'external');
});

test('per-booking instruction overrides the company default; queue failure rolls back confirmation, instruction and PDF', async () => {
  const held = await hold(first.id, 220);
  await request(traveler, '/bookings/' + held.id + '/submit', 'POST', travelerInput);
  const path = '/bookings/' + held.id;
  const ownerDetail = (await request(owner, path)).data;
  assert.equal(ownerDetail.paymentInstructionsDefault, instructions);
  assert.ok(!Object.hasOwn((await request(traveler, path)).data, 'paymentInstructionsDefault'));
  const custom =
    'Instrukcja indywidualna: wynajem opłać w dwóch ratach. Dane przelewu ustalone z wypożyczalnią. Kaucja przy odbiorze.';
  await db.query(
    `CREATE FUNCTION reject_direct_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_key='booking.confirmed:${held.id}' THEN RAISE EXCEPTION 'TEST_CONFIRMATION_MAIL_FAILURE'; END IF; RETURN NEW; END $$`,
  );
  await db.query(
    'CREATE TRIGGER fail_direct_confirmation BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION reject_direct_confirmation()',
  );
  try {
    assert.equal(
      (
        await request(owner, path + '/decision', 'POST', {
          accept: true,
          paymentInstructions: custom,
        })
      ).status,
      500,
    );
    const rolledBack = (await request(traveler, path)).data;
    assert.equal(rolledBack.status, 'pending');
    assert.equal(rolledBack.payment_instructions, '');
    assert.equal((await request(traveler, path + '/documents')).data.length, 0);
  } finally {
    await db.query('DROP TRIGGER fail_direct_confirmation ON jobs');
    await db.query('DROP FUNCTION reject_direct_confirmation()');
  }
  const result = await request(owner, path + '/decision', 'POST', {
    accept: true,
    paymentInstructions: custom,
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.payment_instructions, custom);
  assert.equal(
    (await request(owner, '/owner/dashboard')).data.company.settings.paymentInstructions,
    instructions,
  );
  const event = (
    await db.query('SELECT * FROM jobs WHERE event_key=$1', ['booking.confirmed:' + held.id])
  ).rows;
  assert.equal(event.length, 1);
  assert.equal(event[0].payload.variables.payment_instructions, custom);
  assert.equal(
    (
      await request(owner, path + '/decision', 'POST', {
        accept: true,
        paymentInstructions: 'Następna, zmieniona instrukcja płatności.',
      })
    ).status,
    409,
  );
  assert.equal((await request(traveler, path)).data.payment_instructions, custom);
});
