import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });
process.env.TRAVELER_PAYMENT_MODE = 'local_test';
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/vanly_test')
  throw new Error('Booking tests require isolated vanly_test.');
const schema = 'booking_refactor_' + crypto.randomBytes(8).toString('hex');
const admin = new pg.Pool({ connectionString: url, max: 1 });
const scoped = new URL(url);
scoped.searchParams.set('options', '-c search_path=' + schema + ',public');
process.env.DATABASE_URL = scoped.toString();
process.env.LOCAL_PAYMENTS = 'true';
process.env.MAIL_PROVIDER = 'local';
process.env.MAIL_SES_ENABLED = 'false';
process.env.APP_URL = 'http://localhost:3100';
const require = createRequire(import.meta.url);
const { pool } = require('../apps/api/dist/db.js');
const { expireHoldsWithNotifications } = await import('../scripts/worker/reminders/producer.mjs');
const { BookingRepository } = require('../apps/api/dist/booking/booking.repository.js');
const { InventoryRepository } = require('../apps/api/dist/booking/inventory.repository.js');
const { PricingRepository } = require('../apps/api/dist/booking/pricing.repository.js');
const { PaymentRepository } = require('../apps/api/dist/booking/payment.repository.js');
const { AmendmentRepository } = require('../apps/api/dist/booking/amendment.repository.js');
const { HandoverRepository } = require('../apps/api/dist/booking/handover.repository.js');
const { BookingAccessPolicy } = require('../apps/api/dist/booking/access-policy.js');
const { IdempotencyService } = require('../apps/api/dist/booking/idempotency.service.js');
const { AvailabilityService } = require('../apps/api/dist/booking/availability.service.js');
const { PricingService } = require('../apps/api/dist/booking/pricing.service.js');
const { BookingService } = require('../apps/api/dist/booking/booking.service.js');
const { BookingPaymentService } = require('../apps/api/dist/booking/payment.service.js');
const { BookingLifecycleService } = require('../apps/api/dist/booking/lifecycle.service.js');
const { BookingAmendmentService } = require('../apps/api/dist/booking/amendment.service.js');
const { BookingHandoverService } = require('../apps/api/dist/booking/handover.service.js');
const repository = new BookingRepository();
const access = new BookingAccessPolicy(repository);
const idempotency = new IdempotencyService();
const pricing = new PricingService(
  new PricingRepository(),
  new AvailabilityService(new InventoryRepository()),
);
const bookings = new BookingService(repository, access, pricing, idempotency);
const payments = new BookingPaymentService(new PaymentRepository(), access, idempotency);
const lifecycle = new BookingLifecycleService(repository, access);
const amendments = new BookingAmendmentService(
  new AmendmentRepository(),
  repository,
  access,
  pricing,
);
const handovers = new BookingHandoverService(new HandoverRepository(), repository, access);
let traveler, owner, otherOwner;
const future = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const input = (start = 30, end = 36) => ({
  vehicleId: 'booking-test-van',
  start: future(start),
  end: future(end),
  guests: 2,
  extras: {},
  plan: 'deposit',
});
const protocol = {
  kind: 'pickup',
  mileage: 12000,
  fuel: 'Pełny',
  notes: 'Stan bez uwag',
  checks: { equipment: true, condition: true, fuel: true },
};
const count = async (table, where = '', values = []) =>
  (await pool.query(`SELECT count(*)::int n FROM ${table} ${where}`, values)).rows[0].n;

before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const name of (await fs.readdir('db/migrations')).sort())
    if (name.endsWith('.sql')) await pool.query(await fs.readFile('db/migrations/' + name, 'utf8'));
});
beforeEach(async () => {
  await pool.query('TRUNCATE companies,users RESTART IDENTITY CASCADE');
  await pool.query(`INSERT INTO companies(id,name,city,verified,settings) VALUES
    ('booking-test-company','Wypożyczalnia Testowa','Gdańsk',true,'{"minDays":2,"prep":18000,"buffer":1}'),
    ('other-test-company','Inna Wypożyczalnia','Łódź',true,'{}')`);
  const rows = (
    await pool.query(`INSERT INTO users(email,name,password_hash,role,company_id) VALUES
    ('booking-traveler@example.com','Anna Kowalska','fixture','traveler',NULL),
    ('booking-owner@example.com','Właściciel','fixture','owner','booking-test-company'),
    ('other-owner@example.com','Inny właściciel','fixture','owner','other-test-company') RETURNING *`)
  ).rows;
  [traveler, owner, otherOwner] = rows;
  await pool.query(`INSERT INTO vehicles(id,company_id,name,type,asset,city,street,house_number,seats,sleeps,daily,deposit,instant,status)
    VALUES('booking-test-van','booking-test-company','Adria Twin 600','camper','van.svg','Gdańsk','Turystyczna','12',4,4,52000,400000,true,'published')`);
});
after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});
async function submitted() {
  const quote = await bookings.quote(traveler, input());
  const hold = await bookings.hold(traveler, quote.id, crypto.randomUUID());
  const travelerInput = {
    name: traveler.name,
    email: traveler.email,
    note: '',
    accept: true,
    scenario: 'success',
  };
  return payments.pay(traveler, hold.id, travelerInput, crypto.randomUUID());
}
async function confirmed() {
  const booking = await submitted();
  return lifecycle.decide(owner, booking.id, true);
}
async function rejectOutbox(prefix) {
  await pool.query(`CREATE FUNCTION fail_selected_mail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event_key LIKE '${prefix}%' THEN RAISE EXCEPTION 'Injected mail failure'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER reject_outbox BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION fail_selected_mail();`);
}
async function restoreOutbox() {
  await pool.query('DROP TRIGGER reject_outbox ON jobs; DROP FUNCTION fail_selected_mail();');
}

test('payment retry leaves one pending booking; owner confirmation creates one summary and confirmation event', async () => {
  const quote = await bookings.quote(traveler, input());
  const hold = await bookings.hold(traveler, quote.id, crypto.randomUUID());
  const key = crypto.randomUUID();
  const data = {
    name: traveler.name,
    email: traveler.email,
    note: '',
    accept: true,
    scenario: 'success',
  };
  const [first, second] = await Promise.all([
    payments.pay(traveler, hold.id, data, key),
    payments.pay(traveler, hold.id, data, key),
  ]);
  assert.equal(first.status, 'pending');
  assert.deepEqual(second, JSON.parse(JSON.stringify(first)));
  assert.equal(await count('payments'), 1);
  assert.equal(await count('booking_documents'), 0);
  assert.equal(await count('jobs', 'WHERE event_key=$1', ['booking.request_submitted:' + hold.id]), 1);
  await lifecycle.decide(owner, hold.id, true);
  assert.equal(await count('booking_documents', "WHERE kind='summary'"), 1);
  const job = (
    await pool.query('SELECT * FROM jobs WHERE event_key=$1', ['booking.confirmed:' + hold.id])
  ).rows[0];
  assert.equal(job.recipient_user_id, traveler.id);
  const pdf = (
    await pool.query('SELECT * FROM booking_documents WHERE id=$1', [
      job.payload.documentRefs[0].documentId,
    ])
  ).rows[0];
  assert.ok(pdf.content.subarray(0, 5).equals(Buffer.from('%PDF-')));
  assert.equal(pdf.sha256, crypto.createHash('sha256').update(pdf.content).digest('hex'));
  assert.equal(first.deposit_minor, 400000);
  assert.equal(first.total_minor, 6 * 52000 + 18000);
});

test('a hold refuses changed deposit even when rent is unchanged', async () => {
  for (const change of ['deposit=500000']) {
    const quote = await bookings.quote(traveler, input());
    await pool.query(`UPDATE vehicles SET ${change} WHERE id='booking-test-van'`);
    await assert.rejects(bookings.hold(traveler, quote.id, crypto.randomUUID()),
      error => error.getStatus() === 409);
    assert.equal(await count('bookings'), 0);
    assert.equal(await count('allocations'), 0);
    assert.equal(await count('idempotency'), 0);
    await pool.query("UPDATE vehicles SET deposit=400000,instant=true WHERE id='booking-test-van'");
  }
});

test('crossing the seven-day payment deadline requires a fresh quote before a hold', async (t) => {
  const quote = await bookings.quote(traveler, input(7, 13));
  assert.equal(quote.plan, 'deposit');
  assert.ok(quote.dueNowMinor < quote.totalMinor);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 86400000 });
  await assert.rejects(bookings.hold(traveler, quote.id, crypto.randomUUID()),
    error => error.getStatus() === 409);
  assert.equal(await count('bookings'), 0);
  assert.equal(await count('allocations'), 0);
});

test('oversized integer prices are rejected at quote time before an unusable booking can be created', async () => {
  await pool.query(`INSERT INTO stock_items(company_id,id,name,quantity,price,unit) VALUES
    ('booking-test-company','large-extra-1','Drogi dodatek 1',20,1000000,'day'),
    ('booking-test-company','large-extra-2','Drogi dodatek 2',20,1000000,'day')`);
  await pool.query(`INSERT INTO stock_item_vehicles(company_id,item_id,vehicle_id) VALUES
    ('booking-test-company','large-extra-1','booking-test-van'),
    ('booking-test-company','large-extra-2','booking-test-van')`);
  await assert.rejects(bookings.quote(traveler, {
    ...input(30, 90), extras: { 'large-extra-1': 20, 'large-extra-2': 20 },
  }), error => error.getStatus() === 400);
  assert.equal(await count('quotes'), 0);
  assert.equal(await count('bookings'), 0);
  assert.equal(await count('allocations'), 0);
});

test('rejecting a request-mode booking closes its pending amendment and releases availability', async () => {
  await pool.query("UPDATE vehicles SET instant=false WHERE id='booking-test-van'");
  const booking = await submitted();
  assert.equal(booking.status, 'pending');
  const amendment = await amendments.request(traveler, booking.id, {
    start: future(32), end: future(39), note: 'Propozycja przed decyzją firmy',
  });
  const rejected = await lifecycle.decide(owner, booking.id, false);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.payment_status, 'refund_pending');
  assert.equal(rejected.amendments.find(row => row.id === amendment.id).status, 'rejected');
  assert.equal(await count('allocations', 'WHERE active'), 0);
});

test('cancelling an expired hold preserves its terminal status without another event', async () => {
  const quote = await bookings.quote(traveler, input());
  const booking = await bookings.hold(traveler, quote.id, crypto.randomUUID());
  await pool.query("UPDATE bookings SET hold_until=now()-interval '1 second' WHERE id=$1", [booking.id]);
  assert.equal((await bookings.detail(traveler, booking.id)).status, 'expired');
  assert.equal((await lifecycle.cancel(traveler, booking.id)).status, 'expired');
  assert.equal((await lifecycle.cancel(traveler, booking.id)).status, 'expired');
  assert.equal(await count('audit', "WHERE action='booking.cancelled'"), 0);
  assert.equal(await count('jobs', "WHERE event_key LIKE 'booking.cancelled:%'"), 0);
  assert.equal(await count('allocations', 'WHERE active'), 0);
});

test('handover confirmation rolls back state, PDF and audit when the outbox fails', async () => {
  const booking = await confirmed();
  const pickup = await handovers.create(owner, booking.id, protocol);
  await rejectOutbox('handover.confirmed');
  try {
    await assert.rejects(handovers.confirm(traveler, pickup.id), /Injected mail failure/);
  } finally {
    await restoreOutbox();
  }
  assert.equal(
    (await pool.query('SELECT confirmed FROM handovers WHERE id=$1', [pickup.id])).rows[0]
      .confirmed,
    false,
  );
  assert.equal(await count('audit', "WHERE action='handover.confirmed'"), 0);
  assert.equal(await count('booking_documents', "WHERE kind='pickup'"), 1);
  assert.equal(await count('jobs', "WHERE event_key LIKE 'handover.confirmed%'"), 0);
  await handovers.confirm(traveler, pickup.id);
  await handovers.confirm(traveler, pickup.id);
  assert.equal(await count('audit', "WHERE action='handover.confirmed'"), 1);
  assert.equal(await count('booking_documents', "WHERE kind='pickup'"), 2);
  assert.equal(await count('jobs', "WHERE event_key LIKE 'handover.confirmed%'"), 2);
});

test('amendment acceptance and its document/outbox roll back together and retain the original pickup', async () => {
  const booking = await confirmed();
  const amendment = await amendments.request(traveler, booking.id, {
    start: future(32),
    end: future(39),
    note: 'Więcej czasu na podróż',
  });
  await pool.query(
    "UPDATE vehicles SET city='Łódź',street='Nowa',house_number='5',deposit=900000 WHERE id=$1",
    [booking.vehicle_id],
  );
  await rejectOutbox('amendment.accepted');
  try {
    await assert.rejects(amendments.decide(owner, amendment.id, true), /Injected mail failure/);
  } finally {
    await restoreOutbox();
  }
  const unchanged = await bookings.detail(traveler, booking.id);
  assert.equal(unchanged.start_date, booking.start_date);
  assert.equal(unchanged.amendments[0].status, 'pending');
  assert.equal(await count('booking_documents', "WHERE kind='amendment'"), 0);
  const changed = await amendments.decide(owner, amendment.id, true);
  assert.equal(changed.start_date, future(32));
  assert.equal(changed.city, 'Gdańsk');
  assert.equal(changed.street, 'Turystyczna');
  assert.equal(changed.deposit_minor, 400000);
  assert.equal(changed.snapshot.depositMinor, 400000);
  assert.equal(changed.amendments[0].previous.snapshot.vehicle.street, 'Turystyczna');
  assert.equal(await count('booking_documents', "WHERE kind='amendment'"), 1);
  assert.equal(
    await count('jobs', 'WHERE event_key=$1', ['amendment.accepted:' + amendment.id]),
    1,
  );
});

test('saving an unchanged deposit status is a no-op and cannot create repeated mail or audit', async () => {
  const booking = await confirmed();
  await handovers.create(owner, booking.id, protocol);
  await handovers.create(owner, booking.id, { ...protocol, kind: 'return', mileage: 12500 });
  await handovers.deposit(owner, booking.id, {
    status: 'released',
    reason: 'Stan pojazdu bez uwag',
  });
  await handovers.deposit(owner, booking.id, {
    status: 'released',
    reason: 'Stan pojazdu bez uwag',
  });
  assert.equal(await count('audit', "WHERE action='deposit.local_status'"), 1);
  assert.equal(await count('jobs', "WHERE event_key LIKE 'deposit.changed%'"), 1);
  assert.equal((await bookings.detail(traveler, booking.id)).deposit_status, 'released');
  assert.equal((await bookings.detail(traveler, booking.id)).payment_status, 'partial');
});

test('cancellation racing amendment decision finishes without deadlocks or live allocations', async () => {
  const booking = await confirmed();
  const amendment = await amendments.request(traveler, booking.id, {
    start: future(32),
    end: future(39),
    note: '',
  });
  const results = await Promise.allSettled([
    amendments.decide(owner, amendment.id, true),
    lifecycle.cancel(traveler, booking.id),
  ]);
  for (const result of results)
    if (result.status === 'rejected') {
      assert.notEqual(result.reason.code, '40P01');
      assert.equal(result.reason.getStatus(), 409);
    }
  const current = await bookings.detail(traveler, booking.id);
  assert.equal(current.status, 'cancelled');
  assert.equal(await count('allocations', 'WHERE active'), 0);
  assert.ok(['accepted', 'rejected'].includes(current.amendments[0].status));
  assert.equal(current.payment_status, 'refund_pending');
});

test('another company cannot view booking or amend, create protocol or change deposit', async () => {
  const booking = await confirmed();
  const amendment = await amendments.request(traveler, booking.id, {
    start: future(32),
    end: future(39),
    note: '',
  });
  for (const action of [
    () => bookings.detail(otherOwner, booking.id),
    () => amendments.decide(otherOwner, amendment.id, true),
    () => handovers.create(otherOwner, booking.id, protocol),
    () =>
      handovers.deposit(otherOwner, booking.id, { status: 'authorized', reason: 'Zapis testowy' }),
  ])
    await assert.rejects(action(), (error) => error.getStatus() === 403);
  assert.equal((await bookings.detail(traveler, booking.id)).status, 'confirmed');
  assert.equal(await count('handovers'), 0);
});

test('API expiration and worker share one atomic status, allocation release and expiry event', async () => {
  const quote = await bookings.quote(traveler, input());
  const booking = await bookings.hold(traveler, quote.id, crypto.randomUUID());
  await pool.query("UPDATE bookings SET hold_until=now()-interval '1 second' WHERE id=$1", [booking.id]);
  process.env.MAIL_REMINDERS_ENABLED = 'true';
  process.env.NOTIFICATION_START_AFTER = '2000-01-01T00:00:00Z';
  try {
    await rejectOutbox('booking.expired');
    try { await assert.rejects(bookings.list(traveler), /Injected mail failure/); }
    finally { await restoreOutbox(); }
    assert.equal((await pool.query('SELECT status FROM bookings WHERE id=$1', [booking.id])).rows[0].status, 'held');
    assert.equal(await count('allocations', 'WHERE active'), 1);
    assert.equal(await count('notification_events'), 0);
    await Promise.all([bookings.list(traveler), bookings.detail(traveler, booking.id)]);
    assert.equal((await bookings.detail(traveler, booking.id)).status, 'expired');
    assert.equal(await count('allocations', 'WHERE active'), 0);
    assert.equal(await count('jobs', 'WHERE event_key=$1', ['booking.expired:' + booking.id]), 1);
    assert.equal(await count('notification_events', 'WHERE event_key=$1', ['booking.expired:' + booking.id]), 1);
    const worker = await expireHoldsWithNotifications(pool, {
      config: { enabled: true, startAfter: '2000-01-01T00:00:00Z', appUrl: 'http://localhost:3100' },
    });
    assert.equal(worker.expired, 0);
    assert.equal(worker.queued, 0);
    // Quotes call the same expiry function with a transaction's PoolClient.
    const nextQuote = await bookings.quote(traveler, input(45, 51));
    const next = await bookings.hold(traveler, nextQuote.id, crypto.randomUUID());
    await pool.query("UPDATE bookings SET hold_until=now()-interval '1 second' WHERE id=$1", [next.id]);
    await bookings.quote(traveler, input(60, 66));
    assert.equal(await count('jobs', 'WHERE event_key=$1', ['booking.expired:' + next.id]), 1);
    assert.equal(await count('allocations', 'WHERE active'), 0);
  } finally {
    process.env.MAIL_REMINDERS_ENABLED = 'false';
    delete process.env.NOTIFICATION_START_AFTER;
  }
});
