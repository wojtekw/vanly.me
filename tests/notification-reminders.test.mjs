import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import pg from 'pg';
import dotenv from 'dotenv';
import {
  loadNotificationConfig,
  localDay,
  calendarDate,
} from '../scripts/worker/reminders/config.mjs';
import {
  ReminderProducer,
  expireHoldsWithNotifications,
} from '../scripts/worker/reminders/producer.mjs';
import { NewsletterProducer } from '../scripts/worker/reminders/newsletter.mjs';
import { validateNotificationGuard } from '../scripts/worker/reminders/guard.mjs';
import { maintainPortal } from '../scripts/worker/maintenance.mjs';
import { MailerService, loadMailerConfig } from '../packages/mailer/index.mjs';

dotenv.config({ path: '.env.local', quiet: true });
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/vanly_test')
  throw new Error('Notification tests require isolated vanly_test.');
const schema = 'notifications_test_' + crypto.randomBytes(8).toString('hex');
const admin = new pg.Pool({ connectionString: url, max: 1 });
const pool = new pg.Pool({
  connectionString: url,
  max: 8,
  options: `-c search_path=${schema},public`,
});
const require = createRequire(import.meta.url);
const {
  requestEmailVerification,
  verifyEmail,
} = require('../apps/api/dist/accounts/email-verification.js');
const {
  updateNewsletterPreference,
  confirmNewsletter,
  unsubscribeNewsletter,
} = require('../apps/api/dist/newsletter/subscriptions.js');
process.env.APP_URL = 'http://localhost:3100';
const today = localDay(new Date());
const now = new Date(today + 'T12:00:00Z');
const day = (delta) =>
  new Date(Date.parse(today + 'T12:00:00Z') + delta * 86400_000).toISOString().slice(0, 10);
const config = loadNotificationConfig({
  MAIL_REMINDERS_ENABLED: 'true',
  MAIL_REMINDERS_SEND_HOUR: '0',
  NOTIFICATION_START_AFTER: today + 'T00:00:00Z',
});
let traveler, owner;
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const file of [
    '001_core.sql',
    '007_message_conversations.sql',
    '009_mailer.sql',
    '010_mail_feedback.sql',
    '013_booking_documents.sql',
    '014_notification_automation.sql',
  ])
    await pool.query(await fs.readFile('db/migrations/' + file, 'utf8'));
});
beforeEach(async () => {
  await pool.query(
    'TRUNCATE companies,users,jobs,local_mail,mail_deliveries,mail_feedback,mail_suppressions,notification_events,newsletter_campaigns CASCADE',
  );
  await pool.query(
    "INSERT INTO companies(id,name,city,lat,lng,verified) VALUES('company','Bałtyk Campers','Gdańsk',54,18,true)",
  );
  await pool.query(
    "INSERT INTO vehicles(id,company_id,name,type,asset,city,lat,lng,seats,sleeps,daily,deposit,status) VALUES('van','company','Adria Twin','campervan','van.webp','Gdańsk',54,18,4,4,52000,400000,'published')",
  );
  traveler = (
    await pool.query(
      "INSERT INTO users(email,name,password_hash) VALUES('traveler@example.com','Anna Kowalska','unused') RETURNING *",
    )
  ).rows[0];
  owner = (
    await pool.query(
      "INSERT INTO users(email,name,password_hash,role,company_id) VALUES('owner@example.com','Marek Nowak','unused','owner','company') RETURNING *",
    )
  ).rows[0];
});
after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});
async function tx(fn) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}
async function booking({
  status = 'confirmed',
  start = day(14),
  end = day(21),
  due = day(7),
  paid = 123000,
  total = 410000,
  created = now,
} = {}) {
  return (
    await pool.query(
      `INSERT INTO bookings(user_id,company_id,vehicle_id,start_date,end_date,guests,status,total_minor,paid_minor,payment_status,deposit_minor,snapshot,created_at)
    VALUES($1,'company','van',$2,$3,2,$4,$5,$6,$7,400000,$8,$9) RETURNING *`,
      [
        traveler.id,
        start,
        end,
        status,
        total,
        paid,
        paid === total ? 'paid' : paid ? 'partial' : 'unpaid',
        JSON.stringify({ balanceDue: due }),
        created,
      ],
    )
  ).rows[0];
}
const queued = async () => (await pool.query('SELECT * FROM jobs ORDER BY id')).rows;
const producer = (mailProvider = config.mailProvider) =>
  new ReminderProducer(pool, { config: { ...config, mailProvider }, now: () => now });

test('cutover is required, disabled producers are inert and calendar dates are real', async () => {
  assert.equal(loadNotificationConfig({}).mailProvider, 'local');
  assert.equal(loadNotificationConfig({ MAIL_PROVIDER: 'ses' }).mailProvider, 'ses');
  assert.throws(() => loadNotificationConfig({ MAIL_PROVIDER: 'smtp' }), /INVALID_MAIL_PROVIDER/);
  assert.throws(() => loadNotificationConfig({ MAIL_REMINDERS_ENABLED: 'true' }), /START_AFTER/);
  assert.throws(
    () =>
      loadNotificationConfig({ MAIL_NEWSLETTER_ENABLED: 'true', NOTIFICATION_START_AFTER: 'bad' }),
    /START_AFTER/,
  );
  assert.throws(() => loadNotificationConfig({ MAIL_REMINDERS_ENABLED: 'true', NOTIFICATION_START_AFTER: today + 'T09:00:00' }), /START_AFTER/);
  assert.equal(loadNotificationConfig({ MAIL_REMINDERS_ENABLED: 'true', NOTIFICATION_START_AFTER: today + 'T09:00:00+02:00' }).startAfter, today + 'T07:00:00.000Z');
  assert.equal(calendarDate('2026-02-31'), null);
  assert.equal(calendarDate('2028-02-29'), '2028-02-29');
  await booking();
  const disabled = loadNotificationConfig({});
  assert.deepEqual(await new ReminderProducer(pool, { config: disabled }).tick(), { queued: 0 });
  assert.deepEqual(await new NewsletterProducer(pool, { config: disabled }).tick(), { queued: 0 });
});
test('7/3/1-day balance reminders skip paid, cancelled and pre-cutover bookings and never replay', async () => {
  for (const days of [7, 3, 1]) await booking({ due: day(days) });
  await booking({ paid: 410000, due: day(3) });
  await booking({ status: 'cancelled', due: day(1) });
  await booking({ created: new Date(now.getTime() - 86400_000), due: day(7) });
  assert.equal((await producer().tick()).queued, 3);
  for (const job of await queued())
    assert.equal(await validateNotificationGuard(pool, job, { now }), true);
  const concurrent = await Promise.all([producer().tick(), producer().tick()]);
  assert.equal(
    concurrent.reduce((n, r) => n + r.queued, 0),
    0,
  );
  // Deleting a processed job or reviving a business status cannot reset event history.
  await pool.query('DELETE FROM jobs');
  assert.equal((await producer().tick()).queued, 0);
});
test('last-minute payment, cancellation or amendment prevents delivery of stale balance reminder', async () => {
  const b = await booking();
  await producer().tick();
  const job = (await queued())[0];
  await pool.query('UPDATE bookings SET paid_minor=paid_minor+10000 WHERE id=$1', [b.id]);
  assert.equal(await validateNotificationGuard(pool, job, { now }), false);
  await pool.query("UPDATE bookings SET paid_minor=total_minor,payment_status='paid' WHERE id=$1", [
    b.id,
  ]);
  assert.equal(await validateNotificationGuard(pool, job, { now }), false);
  await pool.query(
    "UPDATE bookings SET paid_minor=123000,payment_status='partial',status='cancelled' WHERE id=$1",
    [b.id],
  );
  assert.equal(await validateNotificationGuard(pool, job, { now }), false);
  await pool.query(
    "UPDATE bookings SET status='confirmed',snapshot=jsonb_build_object('balanceDue',$2::text) WHERE id=$1",
    [b.id, day(3)],
  );
  assert.equal(await validateNotificationGuard(pool, job, { now }), false);
});
test('pickup, return and review reminders use separate states, dates and completed-rental review check', async () => {
  const pickup = await booking({ start: day(1), end: day(8), due: day(-6), paid: 410000 });
  const returning = await booking({
    status: 'in_rental',
    start: day(-6),
    end: day(1),
    paid: 410000,
  });
  const complete = await booking({
    status: 'completed',
    start: day(-9),
    end: day(-2),
    paid: 410000,
  });
  await pool.query(
    "INSERT INTO handovers(booking_id,created_by,kind,mileage,fuel,checks,created_at) VALUES($1,$2,'return',35000,'pełny','{}',$3)",
    [complete.id, owner.id, new Date(now.getTime() - 2 * 86400_000)],
  );
  assert.equal((await producer().tick()).queued, 3);
  const jobs = await queued();
  assert.deepEqual(jobs.map((j) => j.payload.notificationGuard.kind).sort(), [
    'pickup',
    'return',
    'review',
  ]);
  await pool.query(
    "INSERT INTO comments(vehicle_id,author_id,booking_id,type,text,rating) VALUES('van',$1,$2,'review','Bardzo dobry wyjazd',5)",
    [traveler.id, complete.id],
  );
  const review = jobs.find((j) => j.payload.notificationGuard.kind === 'review');
  assert.equal(await validateNotificationGuard(pool, review, { now }), false);
  await pool.query("UPDATE bookings SET status='cancelled' WHERE id=ANY($1::uuid[])", [
    [pickup.id, returning.id],
  ]);
  for (const job of jobs.filter((j) => j !== review))
    assert.equal(await validateNotificationGuard(pool, job, { now }), false);
});
async function message(created = new Date(now.getTime() - 10 * 60000), author = traveler.id) {
  await pool.query(
    "INSERT INTO message_conversations(vehicle_id,traveler_id) VALUES('van',$1) ON CONFLICT DO NOTHING",
    [traveler.id],
  );
  return (
    await pool.query(
      "INSERT INTO messages(vehicle_id,traveler_id,author_id,text,created_at) VALUES('van',$1,$2,'Treść prywatna nie powinna trafić do maila',$3) RETURNING *",
      [traveler.id, author, created],
    )
  ).rows[0];
}
test('unread aggregation honours delay, reader, recipients, cooldown and concurrent workers', async () => {
  await message(new Date(now.getTime() - 2 * 60000));
  assert.equal((await producer().tick()).queued, 0);
  await pool.query('DELETE FROM messages');
  const m = await message();
  const results = await Promise.all([producer().tick(), producer().tick()]);
  assert.equal(
    results.reduce((n, r) => n + r.queued, 0),
    1,
  );
  const job = (await queued())[0];
  assert.equal(job.recipient_user_id, owner.id);
  assert.equal(new URL(job.payload.variables.action_url).pathname, '/company/messages');
  assert.doesNotMatch(job.payload.body, /Treść prywatna/);
  assert.equal(await validateNotificationGuard(pool, job, { now }), true);
  await pool.query(
    "INSERT INTO message_reads(vehicle_id,traveler_id,user_id,read_through) VALUES('van',$1,$2,$3)",
    [traveler.id, owner.id, m.created_at],
  );
  assert.equal(await validateNotificationGuard(pool, job, { now }), false);
  await message(new Date(now.getTime() - 6 * 60000));
  assert.equal((await producer().tick()).queued, 0);
  // New incoming message after cooldown produces exactly one later notification.
  await pool.query('UPDATE notification_events SET created_at=$1', [
    new Date(now.getTime() - 13 * 3600_000),
  ]);
  assert.equal((await producer().tick()).queued, 1);
});
test('SES switch lets a new owner reply bypass a completed local reminder exactly once', async () => {
  await message(new Date(now.getTime() - 20 * 60000), owner.id);
  assert.equal((await producer().tick()).queued, 1);
  const mailer = new MailerService(pool, {
    config: loadMailerConfig({ MAIL_PROVIDER: 'local', APP_URL: 'http://localhost:3100' }),
    notificationGuard: (job) => validateNotificationGuard(pool, job, { now }),
  });
  try {
    assert.equal((await mailer.tick())[0].status, 'local');
  } finally {
    mailer.close();
  }
  // Provider changes never replay the already notified message.
  assert.equal((await producer('ses').tick()).queued, 0);
  const reply = await message(new Date(now.getTime() - 6 * 60000), owner.id);
  assert.equal((await producer().tick()).queued, 0);
  const results = await Promise.all([producer('ses').tick(), producer('ses').tick()]);
  assert.equal(results.reduce((total, result) => total + result.queued, 0), 1);
  const jobs = await queued();
  assert.equal(jobs.length, 2);
  assert.equal(jobs[1].status, 'pending');
  assert.equal(jobs[1].recipient_user_id, traveler.id);
  assert.equal(jobs[1].payload.notificationGuard.messageId, reply.id);
  assert.equal((await producer('ses').tick()).queued, 0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM local_mail')).rows[0].n, 1);
});

for (const scenario of [
  { name: 'an unclaimed job', jobStatus: 'pending', provider: null },
  { name: 'a pending SES job', jobStatus: 'pending', provider: 'ses' },
  { name: 'a processing SES delivery', jobStatus: 'processing', provider: 'ses', delivery: 'processing' },
  { name: 'an accepted SES delivery', jobStatus: 'done', provider: 'ses', delivery: 'accepted' },
  { name: 'an unknown SES outcome', jobStatus: 'unknown', provider: 'ses', delivery: 'unknown' },
  { name: 'a local job without completed delivery evidence', jobStatus: 'done', provider: 'local' },
  { name: 'a local job still processing', jobStatus: 'processing', provider: 'local', delivery: 'local' },
]) {
  test('SES unread cooldown still blocks ' + scenario.name, async () => {
    await message(new Date(now.getTime() - 20 * 60000), owner.id);
    assert.equal((await producer().tick()).queued, 1);
    const job = (await queued())[0];
    await pool.query('UPDATE jobs SET status=$2,provider=$3,attempts=1 WHERE id=$1', [
      job.id, scenario.jobStatus, scenario.provider,
    ]);
    if (scenario.delivery)
      await pool.query(
        'INSERT INTO mail_deliveries(job_id,recipient_user_id,attempt,provider,status) VALUES($1,$2,1,$3,$4)',
        [job.id, traveler.id, scenario.provider, scenario.delivery],
      );
    await message(new Date(now.getTime() - 6 * 60000), owner.id);
    assert.equal((await producer('ses').tick()).queued, 0);
    assert.equal((await queued()).length, 1);
  });
}

test('local completion with any SES attempt preserves the unread cooldown', async () => {
  await message(new Date(now.getTime() - 20 * 60000), owner.id);
  assert.equal((await producer().tick()).queued, 1);
  const job = (await queued())[0];
  await pool.query("UPDATE jobs SET status='done',provider='local',attempts=2 WHERE id=$1", [job.id]);
  await pool.query(
    `INSERT INTO mail_deliveries(job_id,recipient_user_id,attempt,provider,status)
      VALUES($1,$2,1,'ses','unknown'),($1,$2,2,'local','local')`,
    [job.id, traveler.id],
  );
  await message(new Date(now.getTime() - 6 * 60000), owner.id);
  assert.equal((await producer('ses').tick()).queued, 0);
});

test('deleted reminder jobs retain same-message dedup and cannot prove a local cooldown exemption', async () => {
  await message(new Date(now.getTime() - 20 * 60000), owner.id);
  assert.equal((await producer().tick()).queued, 1);
  await pool.query('DELETE FROM jobs');
  await pool.query('UPDATE notification_events SET created_at=$1', [
    new Date(now.getTime() - 13 * 3600_000),
  ]);
  assert.equal((await producer('ses').tick()).queued, 0);
  await pool.query('UPDATE notification_events SET created_at=$1', [now]);
  await message(new Date(now.getTime() - 6 * 60000), owner.id);
  assert.equal((await producer('ses').tick()).queued, 0);
});
test('hold expiry and its notification commit together, old demo holds receive no mail', async () => {
  const fresh = await booking({ status: 'held' });
  const old = await booking({ status: 'held', created: new Date(now.getTime() - 86400_000) });
  await pool.query('UPDATE bookings SET hold_until=$1 WHERE id=ANY($2::uuid[])', [
    new Date(now.getTime() - 60000),
    [fresh.id, old.id],
  ]);
  await pool.query(
    "INSERT INTO allocations(vehicle_id,booking_id,company_id,occupied) VALUES('van',$1,'company',daterange($2,$3,'[)'))",
    [fresh.id, day(14), day(21)],
  );
  assert.deepEqual(await expireHoldsWithNotifications(pool, { config, now }), {
    expired: 2,
    queued: 1,
  });
  assert.equal((await pool.query('SELECT active FROM allocations')).rows[0].active, false);
  assert.match((await queued())[0].payload.body, /nie została potwierdzona/);
  assert.deepEqual(await expireHoldsWithNotifications(pool, { config, now }), {
    expired: 0,
    queued: 0,
  });
});
test('verification links are hashed, expire, invalidate earlier requests and confirm only once', async () => {
  await tx((db) => requestEmailVerification(db, traveler, 'http://localhost:3100'));
  await tx((db) => requestEmailVerification(db, traveler, 'http://localhost:3100'));
  assert.equal((await queued()).length, 1);
  const job = (await queued())[0];
  assert.equal(await validateNotificationGuard(pool, job), true);
  const token = new URL(job.payload.variables.action_url).searchParams.get('token');
  assert.equal(job.payload.senderKind, 'no-reply');
  const stored = (await pool.query('SELECT token_hash FROM email_verification_tokens')).rows[0]
    .token_hash;
  assert.notEqual(token, stored);
  assert.equal(stored, crypto.createHash('sha256').update(token).digest('hex'));
  await tx((db) => verifyEmail(db, token));
  assert.equal(await validateNotificationGuard(pool, job), false);
  assert.ok(
    (await pool.query('SELECT email_verified_at FROM users WHERE id=$1', [traveler.id])).rows[0]
      .email_verified_at,
  );
  await assert.rejects(
    tx((db) => verifyEmail(db, token)),
    /wykorzystany/,
  );
});
test('verification resend invalidates old links, expiry rejects confirmation and enqueue failure rolls back expiry', async () => {
  await tx((db) => requestEmailVerification(db, traveler, 'http://localhost:3100'));
  const oldToken = new URL((await queued())[0].payload.variables.action_url).searchParams.get(
    'token',
  );
  await pool.query("UPDATE email_verification_tokens SET created_at=now()-interval '6 minutes'");
  await tx((db) => requestEmailVerification(db, traveler, 'http://localhost:3100'));
  assert.equal(await validateNotificationGuard(pool, (await queued())[0]), false);
  assert.equal(await validateNotificationGuard(pool, (await queued())[1]), true);
  await assert.rejects(
    tx((db) => verifyEmail(db, oldToken)),
    /wykorzystany/,
  );
  const newToken = new URL((await queued())[1].payload.variables.action_url).searchParams.get(
    'token',
  );
  await pool.query(
    "UPDATE email_verification_tokens SET expires_at=now()-interval '1 second' WHERE used_at IS NULL",
  );
  assert.equal(await validateNotificationGuard(pool, (await queued())[1]), false);
  await assert.rejects(
    tx((db) => verifyEmail(db, newToken)),
    /wygasł/,
  );
  const held = await booking({ status: 'held' });
  await pool.query('UPDATE bookings SET hold_until=$1 WHERE id=$2', [
    new Date(now.getTime() - 60000),
    held.id,
  ]);
  await pool.query(
    `CREATE FUNCTION fail_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'INJECTED_NOTIFICATION_FAILURE'; END $$`,
  );
  await pool.query(
    'CREATE TRIGGER notification_failure BEFORE INSERT ON notification_events FOR EACH ROW EXECUTE FUNCTION fail_notification()',
  );
  try {
    await assert.rejects(
      expireHoldsWithNotifications(pool, { config, now }),
      /INJECTED_NOTIFICATION_FAILURE/,
    );
    assert.equal(
      (await pool.query('SELECT status FROM bookings WHERE id=$1', [held.id])).rows[0].status,
      'held',
    );
  } finally {
    await pool.query('DROP TRIGGER notification_failure ON notification_events');
    await pool.query('DROP FUNCTION fail_notification()');
  }
});
test('legacy marketing booleans do not authorize campaigns; double opt-in and unsubscribe are auditable/idempotent', async () => {
  await pool.query(`UPDATE users SET profile='{"marketing":true}' WHERE id=$1`, [traveler.id]);
  assert.equal(
    (await pool.query('SELECT count(*)::int n FROM newsletter_subscriptions')).rows[0].n,
    0,
  );
  assert.equal(
    await tx((db) => updateNewsletterPreference(db, traveler, true, 'http://localhost:3100')),
    'pending',
  );
  const request = (await queued())[0],
    token = new URL(request.payload.variables.action_url).searchParams.get('token');
  assert.equal(await validateNotificationGuard(pool, request), true);
  assert.equal(
    await tx((db) => updateNewsletterPreference(db, traveler, true, 'http://localhost:3100')),
    'pending',
  );
  assert.equal((await queued()).length, 1);
  await tx((db) => confirmNewsletter(db, token));
  assert.equal(await validateNotificationGuard(pool, request), false);
  await assert.rejects(
    tx((db) => confirmNewsletter(db, token)),
    /wykorzystany/,
  );
  const unsubscribe = crypto.randomBytes(32).toString('hex');
  await pool.query(
    "INSERT INTO newsletter_tokens(token_hash,user_id,kind) VALUES($1,$2,'unsubscribe')",
    [crypto.createHash('sha256').update(unsubscribe).digest('hex'), traveler.id],
  );
  await tx((db) => unsubscribeNewsletter(db, unsubscribe));
  await tx((db) => unsubscribeNewsletter(db, unsubscribe));
  assert.equal(
    (await pool.query('SELECT status FROM newsletter_subscriptions')).rows[0].status,
    'unsubscribed',
  );
});
test('newsletter campaign requires confirmed consent, published article, no suppression and checks withdrawal before delivery', async () => {
  await pool.query(
    "INSERT INTO articles(id,title,kind,summary,body,asset,published) VALUES('pierwszy-wyjazd','Pierwszy wyjazd kamperem','guide','Sprawdź trasę i dokumenty.','[]','van.webp',true)",
  );
  await pool.query(
    "INSERT INTO newsletter_subscriptions(user_id,status,consent_version,confirmed_at,origin) VALUES($1,'confirmed','v1',$2,'http://localhost:3100')",
    [traveler.id, new Date(now.getTime() - 60000)],
  );
  const campaign = (
    await pool.query(
      "INSERT INTO newsletter_campaigns(article_id,subject,status,created_at,approved_at) VALUES('pierwszy-wyjazd','VANLY — pierwszy wyjazd','ready',$1,$1) RETURNING *",
      [now],
    )
  ).rows[0];
  const nc = { ...config, newsletterEnabled: true };
  const n = new NewsletterProducer(pool, { config: nc, now: () => now });
  assert.equal((await n.tick()).queued, 1);
  assert.equal((await n.tick()).queued, 0);
  const job = (await queued())[0];
  assert.equal(job.payload.marketing.campaignId, campaign.id);
  assert.match(job.payload.variables.action_url, /\/artykul\/pierwszy-wyjazd$/);
  assert.equal(await validateNotificationGuard(pool, job, { now }), true);
  const token = new URL(job.payload.marketing.unsubscribeUrl).searchParams.get('token');
  await tx((db) => unsubscribeNewsletter(db, token));
  assert.equal(await validateNotificationGuard(pool, job, { now }), false);
  await pool.query("UPDATE newsletter_subscriptions SET status='confirmed',confirmed_at=$2 WHERE user_id=$1", [traveler.id, new Date(now.getTime() + 60000)]);
  assert.equal(await validateNotificationGuard(pool, job, { now }), false);
  const mailer = new MailerService(pool, {
    config: loadMailerConfig({ APP_URL: 'http://localhost:3100' }),
    notificationGuard: (j) => validateNotificationGuard(pool, j, { now }),
  });
  assert.equal((await mailer.tick())[0].status, 'dead');
  assert.equal((await pool.query('SELECT count(*)::int n FROM local_mail')).rows[0].n, 0);
  mailer.close();
});

test('password reset token guard prevents obsolete, consumed and expired links from being sent', async () => {
  const tokenHash = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO reset_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'30 minutes\')', [tokenHash, traveler.id]);
  const job = { recipient_user_id: traveler.id, payload: { notificationGuard: { kind: 'password-reset', tokenHash } } };
  assert.equal(await validateNotificationGuard(pool, job), true);
  assert.equal(await validateNotificationGuard(pool, { ...job, recipient_user_id: owner.id }), false);
  await pool.query('UPDATE reset_tokens SET used_at=now() WHERE token_hash=$1', [tokenHash]);
  assert.equal(await validateNotificationGuard(pool, job), false);
  await pool.query('UPDATE reset_tokens SET used_at=NULL,expires_at=now()-interval \'1 second\' WHERE token_hash=$1', [tokenHash]);
  assert.equal(await validateNotificationGuard(pool, job), false);
});

test('portal maintenance leaves held expiry to the transactional notification producer', async () => {
  const held = await booking({ status: 'held' });
  await pool.query('UPDATE bookings SET hold_until=$2 WHERE id=$1', [held.id, new Date(now.getTime() - 60000)]);
  await maintainPortal(pool);
  assert.equal((await pool.query('SELECT status FROM bookings WHERE id=$1', [held.id])).rows[0].status, 'held');
  assert.deepEqual(await expireHoldsWithNotifications(pool, { config, now }), { expired: 1, queued: 1 });
});
