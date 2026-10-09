import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMailerConfig } from '../packages/mailer/config.mjs';
import { renderMail } from '../packages/mailer/renderer.mjs';
import { createSesProvider } from '../packages/mailer/providers/ses.mjs';
import { MailerService, retryDelay } from '../packages/mailer/service.mjs';
import { normalizeFeedback, addressHash } from '../packages/mailer/feedback/normalize.mjs';
import { createSqsFeedbackAdapter } from '../packages/mailer/feedback/sqs.mjs';
import { FeedbackService } from '../packages/mailer/feedback/service.mjs';

const local = loadMailerConfig({});
const sesEnv = {
  MAIL_PROVIDER: 'ses',
  MAIL_SES_ENABLED: 'true',
  APP_URL: 'https://vanly.example',
  MAIL_FROM: 'powiadomienia@vanly.example',
  MAIL_REPLY_TO: 'pomoc@vanly.example',
  MAIL_SES_START_AFTER: '2026-10-07T00:00:00Z',
  MAIL_SENDER_LEGAL_NAME: 'Operator demonstracyjny',
  MAIL_SENDER_LEGAL_ADDRESS: 'Adres demonstracyjny',
  MAIL_SENDER_REGISTRATION_DETAILS: 'Dane demonstracyjne',
};
const job = () => ({
  id: '41',
  recipient_user_id: 'user-1',
  email: 'anna@example.com',
  name: 'Anna Kowalska',
  attempts: 1,
  lease_token: 'lease',
  payload: {
    userId: 'user-1',
    subject: 'Rezerwacja VANLY',
    body: 'Termin: 15–22 października\nCena: 3150 zł',
  },
});

test('SES requires deliberate enable, valid sender, public HTTPS and cutover', () => {
  assert.equal(local.provider, 'local');
  assert.throws(
    () => loadMailerConfig({ ...sesEnv, MAIL_SES_ENABLED: 'false' }),
    /SES_EXPLICIT_ENABLE_REQUIRED/,
  );
  assert.throws(
    () => loadMailerConfig({ ...sesEnv, APP_URL: 'http://vanly.example' }),
    /PUBLIC_HTTPS/,
  );
  assert.throws(
    () => loadMailerConfig({ ...sesEnv, APP_URL: 'https://localhost' }),
    /PUBLIC_HTTPS/,
  );
  assert.throws(
    () => loadMailerConfig({ ...sesEnv, MAIL_FROM: 'x@vanly.example\r\nBcc: x@y.com' }),
    /INVALID_MAIL_FROM/,
  );
  assert.throws(() => loadMailerConfig({ ...sesEnv, MAIL_SES_START_AFTER: '' }), /CUTOVER/);
  assert.equal(loadMailerConfig(sesEnv).region, 'eu-central-1');
});

test('renderer escapes all text and preserves multiline body and legacy local content', () => {
  const payload = {
    subject: 'VANLY <status>',
    body: '<script>danger</script>\nCena: 3150 zł',
    variables: { first_name: 'Anna <img src=x>', action_url: '/konto?tab=rezerwacje' },
  };
  const message = renderMail(payload, local);
  assert.ok(message.html.includes('&lt;script&gt;danger&lt;/script&gt;<br>Cena: 3150 zł'));
  assert.ok(message.html.includes('Anna &lt;img src=x&gt;'));
  assert.ok(!message.html.includes('<script>'));
  assert.equal(message.legacyBody, payload.body);
  assert.ok(message.text.includes(payload.body));
  assert.throws(
    () => renderMail({ ...payload, variables: { action_url: 'javascript:alert(1)' } }, local),
    /UNTRUSTED_ACTION_URL/,
  );
  assert.throws(
    () => renderMail({ ...payload, variables: { action_url: 'https://attacker.example' } }, local),
    /UNTRUSTED_ACTION_URL/,
  );
  assert.throws(
    () => renderMail({ ...payload, subject: 'Injected\nBcc: x@example.com' }, local),
    /INVALID_EMAIL_SUBJECT/,
  );
});

test('named reset injects recipient/global fields and requires every manifest variable', () => {
  const payload = {
    template: '02-reset-hasla',
    body: 'Link legacy',
    variables: {
      action_url: '/konto?reset=example-token',
      reset_expires_at: '7 października 2026, 14:30',
      app_url: 'https://attacker.example',
    },
  };
  const message = renderMail(payload, local, { name: 'Anna Kowalska' });
  assert.equal(message.subject, 'VANLY — ustaw nowe hasło');
  assert.ok(message.html.includes('Cześć Anna,'));
  assert.ok(!message.html.includes('attacker.example'));
  assert.equal(message.legacyBody, 'Link legacy');
  assert.throws(
    () => renderMail({ ...payload, variables: { action_url: '/konto' } }, local),
    /MISSING_TEMPLATE_VALUE/,
  );
  assert.throws(() => renderMail({ template: '12-newsletter' }, local), /MARKETING_REQUIRES/);
  assert.throws(
    () => renderMail({ template: '04-rezerwacja-potwierdzona' }, local),
    /ATTACHMENTS_REQUIRED/,
  );
  assert.throws(() => renderMail({ template: '../secrets' }, local), /UNKNOWN_MAIL_TEMPLATE/);
});

test('alternate trusted portal origins work for reset while foreign origins stay blocked', () => {
  const config = loadMailerConfig({
    APP_URL: 'https://vanly.me.local',
    APP_ORIGIN: 'https://vanly.me.local',
    APP_ADDITIONAL_ORIGINS: 'https://heyvans.com.local,https://camperfolks.com.local',
  });
  const payload = {
    template: '02-reset-hasla',
    body: 'Bezpieczny link',
    variables: {
      action_url: 'https://heyvans.com.local/reset?token=example',
      reset_expires_at: '7 października, 14:30',
    },
  };
  const message = renderMail(payload, config, { name: 'Anna' });
  assert.ok(message.html.includes('href="https://heyvans.com.local/reset?token=example"'));
  assert.ok(message.text.includes('Serwis: https://vanly.me.local'));
  assert.throws(
    () =>
      renderMail(
        {
          ...payload,
          variables: { ...payload.variables, action_url: 'https://attacker.example/reset' },
        },
        config,
      ),
    /UNTRUSTED_ACTION_URL/,
  );
  assert.throws(
    () => loadMailerConfig({ ...sesEnv, APP_ADDITIONAL_ORIGINS: 'http://other.example' }),
    /PUBLIC_HTTPS_ALLOWED_ORIGINS_REQUIRED/,
  );
});

test('SES uses multipart content, explicit From/Reply-To, safe tags and accepted ID', async () => {
  const config = loadMailerConfig(sesEnv);
  let captured;
  const client = {
    async send(command, options) {
      captured = { input: command.input, options };
      return { MessageId: 'ses-123' };
    },
  };
  const provider = createSesProvider(config, client);
  const result = await provider.send(renderMail(job().payload, config, job()), job());
  assert.deepEqual(result, { messageId: 'ses-123', status: 'accepted' });
  assert.deepEqual(captured.input.Destination.ToAddresses, ['anna@example.com']);
  assert.equal(captured.input.FromEmailAddress, config.from);
  assert.deepEqual(captured.input.ReplyToAddresses, [config.replyTo]);
  assert.ok(captured.input.Content.Simple.Body.Html.Data.includes('VANLY'));
  assert.ok(captured.input.Content.Simple.Body.Text.Data.includes('3150 zł'));
  assert.ok(!JSON.stringify(captured.input.EmailTags).includes('anna@'));
  assert.ok(captured.options.abortSignal instanceof AbortSignal);
});

test('sender purposes use configured no-reply and portal addresses with the correct Reply-To policy', async () => {
  const config = loadMailerConfig({ ...sesEnv, MAIL_FROM: 'portal@vanly.me',
    MAIL_FROM_NO_REPLY: 'no-reply@vanly.me', MAIL_FROM_PORTAL: 'portal@vanly.me',
    MAIL_REPLY_TO: 'portal@vanly.me' });
  const requests = [];
  const provider = createSesProvider(config, { async send(command) {
    requests.push(command.input); return { MessageId: 'sender-' + requests.length };
  } });
  for (const senderKind of ['no-reply', 'portal', undefined]) {
    const message = renderMail({ ...job().payload, senderKind, from: 'forged@example.com', replyTo: 'forged@example.com' }, config);
    await provider.send(message, job());
  }
  assert.equal(requests[0].FromEmailAddress, 'no-reply@vanly.me');
  assert.equal(requests[0].ReplyToAddresses, undefined);
  for (const request of requests.slice(1)) {
    assert.equal(request.FromEmailAddress, 'portal@vanly.me');
    assert.deepEqual(request.ReplyToAddresses, ['portal@vanly.me']);
  }
  assert.throws(() => renderMail({ ...job().payload, senderKind: 'custom' }, config), /INVALID_MAIL_SENDER_KIND/);
});

test('SES timeout remains unknown while throttling retries; raw messages are discarded', async () => {
  const config = loadMailerConfig(sesEnv);
  for (const [error, outcome, code] of [
    [
      Object.assign(new Error('secret token=abcdef'), { name: 'TimeoutError' }),
      'unknown',
      'SES_ACCEPTANCE_UNKNOWN',
    ],
    [
      Object.assign(new Error('recipient address'), { name: 'TooManyRequestsException' }),
      'retry',
      'SES_THROTTLED',
    ],
    [
      Object.assign(new Error('secret data'), { $metadata: { httpStatusCode: 400 } }),
      'dead',
      'SES_REQUEST_REJECTED',
    ],
  ]) {
    const provider = createSesProvider(config, {
      async send() {
        throw error;
      },
    });
    await assert.rejects(
      provider.send(renderMail(job().payload, config), job()),
      (failure) =>
        failure.outcome === outcome && failure.code === code && !failure.message.includes('secret'),
    );
  }
});

test('delivery service bounds retries and never switches SES to local', async () => {
  const config = loadMailerConfig(sesEnv);
  const finishes = [];
  let calls = 0;
  const queue = {
    async finish(_job, outcome) {
      finishes.push(outcome);
    },
  };
  const provider = {
    name: 'ses',
    async send() {
      calls++;
      throw Object.assign(new Error('sensitive request'), { name: 'TooManyRequestsException' });
    },
  };
  const service = new MailerService(null, {
    config,
    queue,
    provider,
    random: () => 0,
    suppression: {
      async isSuppressed() {
        return false;
      },
    },
  });
  assert.equal(await service.process(job()), 'retry');
  assert.deepEqual(finishes[0], { status: 'retry', code: 'SES_THROTTLED', delaySeconds: 30 });
  assert.equal(await service.process({ ...job(), attempts: 5 }), 'dead');
  assert.equal(calls, 2);
  assert.equal(
    retryDelay(10, config, () => 0),
    3600,
  );
});

test('expired messages never call provider; DB error after acceptance never resends', async () => {
  let sent = 0;
  const finishes = [];
  const provider = {
    name: 'local',
    async send() {
      sent++;
      return { status: 'local', messageId: 'local:7' };
    },
  };
  const queue = {
    async finish(_job, outcome) {
      finishes.push(outcome);
    },
  };
  const service = new MailerService(null, { config: local, queue, provider });
  assert.equal(
    await service.process({
      ...job(),
      payload: { ...job().payload, expiresAt: '2020-01-01T00:00:00Z' },
    }),
    'dead',
  );
  assert.equal(sent, 0);
  assert.equal(finishes[0].code, 'MAIL_EXPIRED');
  queue.finish = async () => {
    throw new Error('database disconnected');
  };
  await assert.rejects(service.process(job()), /database disconnected/);
  assert.equal(sent, 1);
});

const feedbackEnv = {
  ...sesEnv,
  MAIL_SES_CONFIGURATION_SET: 'vanly-events',
  MAIL_FEEDBACK_ENABLED: 'true',
  MAIL_FEEDBACK_QUEUE_URL: 'https://sqs.eu-central-1.amazonaws.com/123456789012/vanly-feedback',
  MAIL_FEEDBACK_SNS_TOPIC_ARN: 'arn:aws:sns:eu-central-1:123456789012:vanly-feedback',
};
const feedbackConfig = loadMailerConfig(feedbackEnv);
const snsMessage = (event = {}) => ({
  MessageId: 'sqs-123',
  ReceiptHandle: 'receipt-123',
  Body: JSON.stringify({
    Type: 'Notification',
    TopicArn: feedbackConfig.feedbackTopicArn,
    MessageId: 'sns-123',
    Timestamp: '2026-10-07T12:00:00Z',
    Message: JSON.stringify({
      eventType: 'Delivery',
      mail: { messageId: 'ses-123', tags: { vanly_job: ['41'] } },
      delivery: { timestamp: '2026-10-07T12:00:00Z' },
      ...event,
    }),
  }),
});

test('feedback config permits only opted-in matching AWS region, account, SNS and SQS', () => {
  assert.equal(loadMailerConfig({}).feedbackEnabled, false);
  assert.equal(feedbackConfig.feedbackBatchSize, 10);
  assert.throws(
    () =>
      loadMailerConfig({
        ...feedbackEnv,
        MAIL_FEEDBACK_QUEUE_URL: 'https://attacker.example/123456789012/vanly-feedback',
      }),
    /MISMATCH/,
  );
  assert.throws(
    () =>
      loadMailerConfig({
        ...feedbackEnv,
        MAIL_FEEDBACK_QUEUE_URL:
          'http://sqs.eu-central-1.amazonaws.com/123456789012/vanly-feedback',
      }),
    /MISMATCH/,
  );
  assert.throws(
    () =>
      loadMailerConfig({
        ...feedbackEnv,
        MAIL_FEEDBACK_SNS_TOPIC_ARN: 'arn:aws:sns:eu-west-1:123456789012:vanly-feedback',
      }),
    /MISMATCH/,
  );
  assert.throws(
    () => loadMailerConfig({ ...feedbackEnv, MAIL_SES_CONFIGURATION_SET: '' }),
    /CONFIGURATION_SET_REQUIRED/,
  );
});

test('normalizer supports delivery, both bounce types, complaint, rejection, rendering and delay', () => {
  for (const [event, status] of [
    [{ eventType: 'Delivery' }, 'delivered'],
    [
      {
        eventType: 'Bounce',
        bounce: {
          bounceType: 'Permanent',
          bouncedRecipients: [{ emailAddress: 'Anna@Example.com' }],
        },
      },
      'hard_bounce',
    ],
    [{ eventType: 'Bounce', bounce: { bounceType: 'Transient' } }, 'soft_bounce'],
    [
      {
        eventType: 'Complaint',
        complaint: { complainedRecipients: [{ emailAddress: 'anna@example.com' }] },
      },
      'complaint',
    ],
    [{ eventType: 'Reject' }, 'rejected'],
    [{ eventType: 'Rendering Failure' }, 'rendering_failed'],
    [{ eventType: 'DeliveryDelay' }, 'delayed'],
  ]) {
    const normalized = normalizeFeedback(snsMessage(event), feedbackConfig);
    assert.equal(normalized.status, status);
    assert.equal(normalized.candidateJobId, '41');
    assert.ok(!JSON.stringify(normalized).includes('Anna@Example.com'));
  }
  assert.equal(addressHash('  Anna@Example.COM '), addressHash('anna@example.com'));
});

test('untrusted topic, subscription confirmation, malformed recipients and unknown event are rejected', () => {
  const msg = snsMessage();
  const body = JSON.parse(msg.Body);
  assert.throws(
    () =>
      normalizeFeedback(
        {
          ...msg,
          Body: JSON.stringify({
            ...body,
            TopicArn: 'arn:aws:sns:eu-central-1:123456789012:other',
          }),
        },
        feedbackConfig,
      ),
    /UNTRUSTED/,
  );
  assert.throws(
    () =>
      normalizeFeedback(
        {
          ...msg,
          Body: JSON.stringify({
            ...body,
            Type: 'SubscriptionConfirmation',
            SubscribeURL: 'http://127.0.0.1/admin',
          }),
        },
        feedbackConfig,
      ),
    /UNTRUSTED/,
  );
  assert.throws(
    () => normalizeFeedback(snsMessage({ eventType: 'Open' }), feedbackConfig),
    /UNSUPPORTED/,
  );
  assert.throws(
    () =>
      normalizeFeedback(
        snsMessage({
          eventType: 'Bounce',
          bounce: {
            bounceType: 'Permanent',
            bouncedRecipients: [{ emailAddress: 'bad\naddress' }],
          },
        }),
        feedbackConfig,
      ),
    /INVALID_FEEDBACK_RECIPIENT/,
  );
  assert.throws(
    () => normalizeFeedback({ ...msg, Body: 'not JSON' }, feedbackConfig),
    /INVALID_FEEDBACK_ENVELOPE/,
  );
});

test('SQS adaptor receives bounded batches and deletes only receipts through the configured queue', async () => {
  const calls = [];
  const adapter = createSqsFeedbackAdapter(feedbackConfig, {
    async send(command, options) {
      calls.push({
        name: command.constructor.name,
        input: command.input,
        signal: options.abortSignal,
      });
      return command.constructor.name === 'ReceiveMessageCommand'
        ? { Messages: [snsMessage()] }
        : {};
    },
  });
  const [message] = await adapter.receive();
  await adapter.acknowledge(message);
  assert.equal(calls[0].input.MaxNumberOfMessages, 10);
  assert.equal(calls[0].input.WaitTimeSeconds, 0);
  assert.equal(calls[1].input.QueueUrl, feedbackConfig.feedbackQueueUrl);
  assert.equal(calls[1].input.ReceiptHandle, 'receipt-123');
  assert.ok(calls[0].signal instanceof AbortSignal);
});

test('feedback acknowledges after commit and leaves invalid messages for DLQ', async () => {
  const sequence = [];
  const good = snsMessage();
  const invalid = { ...good, MessageId: 'invalid', Body: 'bad JSON' };
  const service = new FeedbackService(null, feedbackConfig, {
    adapter: {
      async receive() {
        return [good, invalid];
      },
      async acknowledge() {
        sequence.push('ack');
      },
    },
    repository: {
      async record() {
        sequence.push('db-commit');
      },
      async reconcileKnown() {
        sequence.push('reconcile');
      },
    },
  });
  assert.deepEqual(await service.tick(), { received: 2, invalid: 1 });
  assert.deepEqual(sequence, ['db-commit', 'ack', 'reconcile']);
  const failed = new FeedbackService(null, feedbackConfig, {
    adapter: {
      async receive() {
        throw new Error('AWS unavailable');
      },
    },
    repository: {},
  });
  await assert.rejects(failed.tick(), /AWS unavailable/);
});

test('suppression and failed suppression checks prevent SES calls', async () => {
  const config = loadMailerConfig(sesEnv);
  let calls = 0;
  const finished = [];
  const provider = {
    name: 'ses',
    async send() {
      calls++;
    },
  };
  const queue = {
    async finish(_job, result) {
      finished.push(result);
    },
  };
  const blocked = new MailerService(null, {
    config,
    queue,
    provider,
    suppression: {
      async isSuppressed() {
        return true;
      },
    },
  });
  assert.equal(await blocked.process(job()), 'dead');
  assert.equal(finished[0].code, 'MAIL_RECIPIENT_SUPPRESSED');
  const unavailable = new MailerService(null, {
    config,
    queue,
    provider,
    random: () => 0,
    suppression: {
      async isSuppressed() {
        throw new Error('database error');
      },
    },
  });
  assert.equal(await unavailable.process(job()), 'retry');
  assert.equal(finished[1].code, 'MAIL_SUPPRESSION_CHECK_FAILED');
  assert.equal(calls, 0);
});
