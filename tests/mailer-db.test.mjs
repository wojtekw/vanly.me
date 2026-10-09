import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';
import { loadMailerConfig } from '../packages/mailer/config.mjs';
import { MailerService } from '../packages/mailer/service.mjs';
import { MailQueue } from '../packages/mailer/queue.mjs';
import { createLocalProvider } from '../packages/mailer/providers/local.mjs';
import { FeedbackRepository } from '../packages/mailer/feedback/repository.mjs';
import { normalizeFeedback, addressHash } from '../packages/mailer/feedback/normalize.mjs';

dotenv.config({ path: '.env.local', quiet: true });
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/vanly_test')
  throw new Error('Mailer DB tests require isolated vanly_test.');
const schema = `mailer_test_${crypto.randomBytes(8).toString('hex')}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
const pool = new pg.Pool({
  connectionString: url,
  max: 8,
  options: `-c search_path=${schema},public`,
});
const config = loadMailerConfig({ MAIL_RETRY_BASE_SECONDS: '1' });
let userId;
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const file of ['001_core.sql', '009_mailer.sql', '010_mail_feedback.sql', '013_booking_documents.sql'])
    await pool.query(await fs.readFile(`db/migrations/${file}`, 'utf8'));
  userId = (
    await pool.query(
      "INSERT INTO users(email,name,password_hash) VALUES('mailer@example.com','Anna Kowalska','not-a-real-password') RETURNING id",
    )
  ).rows[0].id;
});
beforeEach(async () => {
  await pool.query(
    'TRUNCATE jobs,local_mail,mail_deliveries,mail_feedback,mail_suppressions RESTART IDENTITY CASCADE',
  );
});
after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

async function enqueue(eventKey = crypto.randomUUID(), extra = {}) {
  return (
    await pool.query(
      `INSERT INTO jobs(kind,payload,recipient_user_id,event_key) VALUES('mail',$1,$2,$3)
     ON CONFLICT(recipient_user_id,event_key) WHERE kind='mail' AND event_key IS NOT NULL DO NOTHING RETURNING id`,
      [
        JSON.stringify({
          userId,
          subject: 'VANLY — test',
          body: 'Przykładowa treść\nCena: 3150 zł',
          ...extra,
        }),
        userId,
        eventKey,
      ],
    )
  ).rows[0]?.id;
}

test('concurrent claims are exclusive and recipient/event dedup is atomic', async () => {
  const ids = await Promise.all([
    enqueue('booking:abc:confirmed'),
    enqueue('booking:abc:confirmed'),
  ]);
  assert.equal(ids.filter(Boolean).length, 1);
  const queues = [new MailQueue(pool, config), new MailQueue(pool, config)];
  const claims = await Promise.all(queues.map((queue) => queue.claim()));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM mail_deliveries')).rows[0].n, 1);
});

test('local delivery writes safe HTML/TXT, retains legacy body and scrubs job payload', async () => {
  const id = await enqueue();
  const service = new MailerService(pool, { config });
  assert.equal((await service.tick())[0].status, 'local');
  const mail = (await pool.query('SELECT * FROM local_mail WHERE job_id=$1', [id])).rows[0];
  assert.equal(mail.body, 'Przykładowa treść\nCena: 3150 zł');
  assert.ok(mail.html.includes('Cena: 3150 zł'));
  assert.ok(mail.text_body.includes('Cześć Anna,'));
  const job = (await pool.query('SELECT * FROM jobs WHERE id=$1', [id])).rows[0];
  assert.equal(job.status, 'done');
  assert.equal(job.payload.redacted, true);
  assert.equal(job.payload.body, undefined);
  assert.equal((await service.tick()).length, 0);
});

test('local lost write response can retry without duplicate inbox mail', async () => {
  await enqueue();
  const delegate = createLocalProvider(pool);
  let first = true;
  const provider = {
    name: 'local',
    async send(message, job) {
      const result = await delegate.send(message, job);
      if (first) {
        first = false;
        throw new Error('simulated lost database response');
      }
      return result;
    },
  };
  const service = new MailerService(pool, { config, provider, random: () => 0 });
  assert.equal((await service.tick())[0].status, 'retry');
  await pool.query("UPDATE jobs SET next_run=now()-interval '1 second'");
  assert.equal((await service.tick())[0].status, 'local');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM local_mail')).rows[0].n, 1);
  assert.deepEqual(
    (await pool.query('SELECT status FROM mail_deliveries ORDER BY attempt')).rows.map(
      (row) => row.status,
    ),
    ['retry', 'local'],
  );
});

test('expired SES lease is unknown while local lease safely recovers', async () => {
  const sesId = await enqueue('ses');
  const localId = await enqueue('local');
  const queue = new MailQueue(pool, config);
  const first = await queue.claim();
  const second = await queue.claim();
  await pool.query(
    "UPDATE jobs SET lease_until=now()-interval '1 second',provider=CASE WHEN id=$1 THEN 'ses' ELSE 'local' END",
    [sesId],
  );
  await pool.query("UPDATE mail_deliveries SET provider='ses' WHERE job_id=$1", [sesId]);
  const recovered = await queue.claim();
  assert.equal(recovered.id, localId);
  assert.equal(recovered.attempts, 2);
  assert.equal(
    (await pool.query('SELECT status FROM jobs WHERE id=$1', [sesId])).rows[0].status,
    'unknown',
  );
  await assert.rejects(
    queue.finish(first, { status: 'accepted', messageId: 'late-acceptance' }),
    /MAIL_LEASE_LOST/,
  );
  await assert.rejects(
    queue.finish(second, { status: 'local', messageId: 'stale' }),
    /MAIL_LEASE_LOST/,
  );
});

test('expired or recovered lease prevents a stale worker from starting SES delivery', async () => {
  const sesConfig = { ...config, provider: 'ses', startAfter: '2020-01-01T00:00:00Z' };
  await enqueue();
  const queue = new MailQueue(pool, sesConfig);
  const claimed = await queue.claim();
  let calls = 0;
  const service = new MailerService(pool, { config: sesConfig, queue,
    sesClient: { async send() { calls++; return { MessageId: 'must-not-send' }; } } });
  await pool.query("UPDATE jobs SET lease_until=now()-interval '1 second'");
  await assert.rejects(service.process(claimed), /MAIL_LEASE_LOST/);
  assert.equal(calls, 0);
  assert.equal(await queue.claim(), null);
  assert.equal((await pool.query('SELECT status FROM jobs')).rows[0].status, 'unknown');
  await assert.rejects(service.process(claimed), /MAIL_LEASE_LOST/);
  assert.equal(calls, 0);
});

test('SES mock stores accepted MessageId and sends outside DB claim transaction', async () => {
  const sesConfig = {
    ...config,
    provider: 'ses',
    startAfter: '2020-01-01T00:00:00Z',
    from: 'notify@vanly.example',
    replyTo: 'help@vanly.example',
  };
  await enqueue();
  const service = new MailerService(pool, {
    config: sesConfig,
    sesClient: {
      async send(command) {
        // Another connection can acquire the job row lock while the external call runs.
        const check = await pool.connect();
        try {
          await check.query('BEGIN');
          const locked = await check.query(
            "SELECT id FROM jobs WHERE status='processing' FOR UPDATE NOWAIT",
          );
          assert.equal(locked.rowCount, 1);
          await check.query('COMMIT');
        } finally {
          check.release();
        }
        assert.equal(command.input.Destination.ToAddresses[0], 'mailer@example.com');
        return { MessageId: 'mocked-ses-message' };
      },
    },
  });
  assert.equal((await service.tick())[0].status, 'accepted');
  assert.equal(
    (await pool.query('SELECT provider_message_id FROM mail_deliveries')).rows[0]
      .provider_message_id,
    'mocked-ses-message',
  );
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM local_mail')).rows[0].n, 0);
});

test('SES cutover excludes old local-era pending jobs and expired reset never sends', async () => {
  await enqueue('old-job');
  await pool.query("UPDATE jobs SET created_at=now()-interval '1 day'");
  const cutoff = { ...config, provider: 'ses', startAfter: new Date().toISOString() };
  assert.equal(await new MailQueue(pool, cutoff).claim(), null);
  await pool.query('DELETE FROM jobs');
  await enqueue('expired-reset', { expiresAt: '2020-01-01T00:00:00Z' });
  const service = new MailerService(pool, { config });
  assert.equal((await service.tick())[0].status, 'dead');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM local_mail')).rows[0].n, 0);
});

const feedbackConfig = {
  ...config,
  provider: 'ses',
  feedbackTopicArn: 'arn:aws:sns:eu-central-1:123456789012:vanly-feedback',
};
function feedbackEvent(type, messageId = 'ses-feedback', extra = {}) {
  const uuid = crypto.randomUUID();
  return normalizeFeedback(
    {
      MessageId: uuid,
      Body: JSON.stringify({
        Type: 'Notification',
        TopicArn: feedbackConfig.feedbackTopicArn,
        MessageId: uuid,
        Timestamp: '2026-10-07T12:00:00Z',
        Message: JSON.stringify({
          eventType: type,
          mail: { messageId, tags: { vanly_job: ['1'] } },
          bounce: {
            bounceType: 'Permanent',
            bouncedRecipients: [{ emailAddress: 'mailer@example.com' }],
          },
          complaint: { complainedRecipients: [{ emailAddress: 'mailer@example.com' }] },
          ...extra,
        }),
      }),
    },
    feedbackConfig,
  );
}
async function acceptedMessage(messageId = 'ses-feedback') {
  const id = await enqueue();
  const service = new MailerService(pool, {
    config: { ...config, provider: 'ses', startAfter: '2020-01-01T00:00:00Z' },
    sesClient: {
      async send() {
        return { MessageId: messageId };
      },
    },
  });
  await service.tick();
  return id;
}

test('hard bounce dedup is atomic, hashes recipients and blocks later SES sends', async () => {
  await acceptedMessage();
  const event = feedbackEvent('Bounce');
  const repository = new FeedbackRepository(pool);
  const results = await Promise.all([repository.record(event), repository.record(event)]);
  assert.equal(results.filter((result) => result.duplicate).length, 1);
  const suppression = (await pool.query('SELECT * FROM mail_suppressions')).rows[0];
  assert.equal(suppression.address_hash, addressHash('MAILER@example.com'));
  assert.equal(suppression.reason, 'hard_bounce');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM mail_feedback')).rows[0].n, 1);
  assert.equal(
    (await pool.query('SELECT feedback_status FROM mail_deliveries')).rows[0].feedback_status,
    'hard_bounce',
  );
  await enqueue('second-mail');
  let calls = 0;
  const service = new MailerService(pool, {
    config: { ...config, provider: 'ses', startAfter: '2020-01-01T00:00:00Z' },
    sesClient: {
      async send() {
        calls++;
        return { MessageId: 'forbidden-send' };
      },
    },
  });
  assert.equal((await service.tick())[0].status, 'dead');
  assert.equal(calls, 0);
});

test('out-of-order delivery cannot undo bounce or complaint; complaint cannot downgrade', async () => {
  await acceptedMessage();
  const repository = new FeedbackRepository(pool);
  await repository.record(feedbackEvent('Bounce'));
  await repository.record(
    feedbackEvent('Delivery', undefined, { delivery: { timestamp: '2026-10-07T13:00:00Z' } }),
  );
  assert.equal(
    (await pool.query('SELECT feedback_status FROM mail_deliveries')).rows[0].feedback_status,
    'hard_bounce',
  );
  await repository.record(feedbackEvent('Complaint'));
  await repository.record(feedbackEvent('Bounce'));
  await repository.record(feedbackEvent('DeliveryDelay'));
  assert.equal(
    (await pool.query('SELECT feedback_status FROM mail_deliveries')).rows[0].feedback_status,
    'complaint',
  );
  assert.equal(
    (await pool.query('SELECT reason FROM mail_suppressions')).rows[0].reason,
    'complaint',
  );
});

test('soft bounce and delay update metadata without suppression or automatic resend', async () => {
  await acceptedMessage();
  const repository = new FeedbackRepository(pool);
  await repository.record(feedbackEvent('DeliveryDelay'));
  await repository.record(
    feedbackEvent('Bounce', undefined, { bounce: { bounceType: 'Transient' } }),
  );
  await repository.record(feedbackEvent('Delivery'));
  assert.equal(
    (await pool.query('SELECT feedback_status FROM mail_deliveries')).rows[0].feedback_status,
    'soft_bounce',
  );
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM mail_suppressions')).rows[0].n, 0);
  assert.equal((await pool.query('SELECT status FROM jobs')).rows[0].status, 'done');
});

test('feedback arriving before history acceptance is linked later without modifying queue status', async () => {
  const repository = new FeedbackRepository(pool);
  assert.equal((await repository.record(feedbackEvent('Delivery'))).linked, false);
  await acceptedMessage();
  await repository.reconcileKnown();
  assert.ok((await pool.query('SELECT delivery_id FROM mail_feedback')).rows[0].delivery_id);
  assert.equal(
    (await pool.query('SELECT feedback_status FROM mail_deliveries')).rows[0].feedback_status,
    'delivered',
  );
});

test('unknown acceptance is only reconciled by explicit matching job-tag action', async () => {
  const id = await enqueue();
  const sesConfig = { ...config, provider: 'ses', startAfter: '2020-01-01T00:00:00Z' };
  const queue = new MailQueue(pool, sesConfig);
  const claimed = await queue.claim();
  await queue.finish(claimed, { status: 'unknown', code: 'SES_ACCEPTANCE_UNKNOWN' });
  const repository = new FeedbackRepository(pool);
  await repository.record(feedbackEvent('Delivery'));
  await repository.reconcileKnown();
  assert.equal((await pool.query('SELECT status FROM jobs')).rows[0].status, 'unknown');
  const feedbackId = (await pool.query('SELECT id FROM mail_feedback')).rows[0].id;
  await assert.rejects(repository.reconcileUnknown(feedbackId, '999'), /JOB_TAG_MISMATCH/);
  const result = await repository.reconcileUnknown(feedbackId, id);
  assert.equal(result.providerMessageId, 'ses-feedback');
  assert.equal((await pool.query('SELECT status FROM jobs')).rows[0].status, 'done');
  assert.equal(
    (await pool.query('SELECT feedback_status FROM mail_deliveries')).rows[0].feedback_status,
    'delivered',
  );
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM local_mail')).rows[0].n, 0);
});
