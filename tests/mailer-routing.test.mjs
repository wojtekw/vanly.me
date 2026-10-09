import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadMailerConfig } from '../packages/mailer/config.mjs';
import { MailerError } from '../packages/mailer/errors.mjs';
import { routeMailDelivery } from '../packages/mailer/delivery-routing.mjs';
import { renderMail } from '../packages/mailer/renderer.mjs';
import { MailerService } from '../packages/mailer/service.mjs';

const testEnv = {
  MAIL_DEPLOYMENT_ENVIRONMENT: 'local',
  MAIL_TEST_MODE: 'true',
  MAIL_TEST_RECIPIENT: 'wydmuch@gmail.com',
  MAIL_FROM: 'portal@vanly.me',
  MAIL_FROM_NO_REPLY: 'no-reply@vanly.me',
  MAIL_FROM_PORTAL: 'portal@vanly.me',
  MAIL_REPLY_TO: 'info@wydmuch.xyz',
  APP_URL: 'https://vanly.me.local',
};
const sesEnv = {
  ...testEnv,
  MAIL_PROVIDER: 'ses',
  AWS_PROFILE: 'vanly-mailer-local-test',
  MAIL_SES_ENABLED: 'true',
  MAIL_SES_START_AFTER: '2026-10-07T00:00:00Z',
  MAIL_SENDER_LEGAL_NAME: 'Operator demonstracyjny',
  MAIL_SENDER_LEGAL_ADDRESS: 'Adres demonstracyjny',
  MAIL_SENDER_REGISTRATION_DETAILS: 'Dane demonstracyjne',
};
const job = (payload = {}) => ({
  id: '41',
  recipient_user_id: 'original-user',
  email: 'original@example.com',
  name: 'Anna Kowalska',
  attempts: 1,
  lease_token: 'original-lease',
  payload: { userId: 'original-user', subject: 'Rezerwacja VANLY', body: 'Cena: 3150 zł', ...payload },
});
const document = (kind = 'summary') => {
  const data = Buffer.from('%PDF-1.7\nexample document\n%%EOF');
  return {
    documentId: '55555555-5555-4555-8555-555555555555',
    fileName: 'VANLY-VL-8A4C2D7E91-podsumowanie-v1.pdf',
    contentType: 'application/pdf', data,
    sha256: crypto.createHash('sha256').update(data).digest('hex'), kind, version: 1,
    bookingReference: 'VL-8A4C2D7E91', bookingStatus: 'confirmed',
    ...(kind === 'amendment' ? { amendmentId: '66666666-6666-4666-8666-666666666666' } : {}),
  };
};

test('test routing is opt-in and requires an explicit local environment and one valid recipient', () => {
  const defaults = loadMailerConfig({});
  assert.equal(defaults.deploymentEnvironment, 'production');
  assert.equal(defaults.testMode, false);
  assert.equal(defaults.testRecipient, undefined);
  assert.equal(loadMailerConfig(testEnv).testRecipient, 'wydmuch@gmail.com');
  for (const [override, code] of [
    [{ MAIL_DEPLOYMENT_ENVIRONMENT: undefined }, 'MAIL_TEST_MODE_REQUIRES_LOCAL_ENVIRONMENT'],
    [{ MAIL_DEPLOYMENT_ENVIRONMENT: 'production' }, 'MAIL_TEST_MODE_REQUIRES_LOCAL_ENVIRONMENT'],
    [{ MAIL_DEPLOYMENT_ENVIRONMENT: 'staging' }, 'INVALID_MAIL_DEPLOYMENT_ENVIRONMENT'],
    [{ MAIL_TEST_MODE: 'TRUE' }, 'INVALID_MAIL_TEST_MODE'],
    [{ MAIL_TEST_MODE: 'false' }, 'MAIL_TEST_RECIPIENT_REQUIRES_TEST_MODE'],
    [{ MAIL_TEST_RECIPIENT: '' }, 'INVALID_MAIL_TEST_RECIPIENT'],
    [{ MAIL_TEST_RECIPIENT: 'one@example.com,two@example.com' }, 'INVALID_MAIL_TEST_RECIPIENT'],
    [{ MAIL_TEST_RECIPIENT: 'x@example.com\r\nBcc: other@example.com' }, 'INVALID_MAIL_TEST_RECIPIENT'],
  ]) {
    assert.throws(() => loadMailerConfig({ ...testEnv, ...override }), (error) => error.code === code);
  }
  assert.throws(() => new MailerService(null, { config: { ...defaults, testMode: true,
    testRecipient: 'wydmuch@gmail.com' } }), /MAIL_TEST_MODE_REQUIRES_LOCAL_ENVIRONMENT/);
  const ses = loadMailerConfig(sesEnv);
  assert.throws(() => new MailerService(null, { config: { ...ses, awsProfile: undefined } }), /MAIL_TEST_SES_PROFILE_REQUIRED/);
  assert.throws(() => new MailerService(null, { config: { ...ses, awsProfile: 'profile\nother' } }), /INVALID_MAIL_TEST_SES_PROFILE/);
});

test('only explicit local SES test delivery permits local links; SES enable, cutover and legal guards remain', () => {
  for (const url of ['https://vanly.me.local', 'http://localhost:3100', 'http://127.0.0.1:3100']) {
    const config = loadMailerConfig({ ...sesEnv, APP_URL: url,
      APP_ADDITIONAL_ORIGINS: 'https://heyvans.com.local,http://localhost:8182' });
    assert.equal(config.appUrl, url);
    assert.ok(config.allowedAppOrigins.includes('https://heyvans.com.local'));
  }
  const production = { ...sesEnv, MAIL_TEST_MODE: 'false', MAIL_TEST_RECIPIENT: '' };
  assert.throws(() => loadMailerConfig(production), /SES_PUBLIC_HTTPS_APP_URL_REQUIRED/);
  assert.throws(() => loadMailerConfig({ ...production, APP_URL: 'https://vanly.me',
    APP_ADDITIONAL_ORIGINS: 'https://heyvans.com.local' }), /SES_PUBLIC_HTTPS_ALLOWED_ORIGINS_REQUIRED/);
  assert.throws(() => loadMailerConfig({ ...sesEnv, MAIL_SES_ENABLED: 'false' }), /SES_EXPLICIT_ENABLE_REQUIRED/);
  assert.throws(() => loadMailerConfig({ ...sesEnv, AWS_PROFILE: '' }), /MAIL_TEST_SES_PROFILE_REQUIRED/);
  assert.throws(() => loadMailerConfig({ ...sesEnv, AWS_PROFILE: 'profile\nother' }), /INVALID_MAIL_TEST_SES_PROFILE/);
  assert.equal(loadMailerConfig(sesEnv).awsProfile, 'vanly-mailer-local-test');
  assert.throws(() => loadMailerConfig({ ...sesEnv, MAIL_SES_START_AFTER: '' }), /SES_CUTOVER_DATE_REQUIRED/);
  assert.throws(() => loadMailerConfig({ ...sesEnv, MAIL_SENDER_LEGAL_ADDRESS: '' }), /REQUIRED_MAIL_SENDER_LEGAL_ADDRESS/);
  assert.throws(() => loadMailerConfig({ ...sesEnv, APP_URL: 'https://user:pass@vanly.me.local' }), /INVALID_APP_URL/);
  assert.throws(() => loadMailerConfig({ ...sesEnv, APP_ADDITIONAL_ORIGINS: 'javascript:alert(1)' }), /INVALID_MAIL_ALLOWED_ORIGIN/);
});

test('routing changes only immutable delivery copies and adds the prefix once', () => {
  const config = loadMailerConfig(testEnv);
  const original = Object.freeze(job());
  const message = Object.freeze(renderMail(original.payload, config, original, new Date(), [document()]));
  const routed = routeMailDelivery(config, message, original);
  assert.equal(routed.job.email, 'wydmuch@gmail.com');
  assert.equal(routed.job.recipient_user_id, original.recipient_user_id);
  assert.equal(routed.job.payload, original.payload);
  assert.equal(routed.message.subject, 'VANLY-TEST: Rezerwacja VANLY');
  assert.equal(routed.message.attachments, message.attachments);
  assert.equal(routed.message.html, message.html);
  assert.equal(routed.message.text, message.text);
  assert.equal(original.email, 'original@example.com');
  assert.equal(message.subject, 'Rezerwacja VANLY');
  assert.equal(routeMailDelivery(config, routed.message, routed.job).message.subject, routed.message.subject);
  assert.ok(Object.isFrozen(routed.message) && Object.isFrozen(routed.job));
  const production = loadMailerConfig({});
  const unchanged = routeMailDelivery(production, message, original);
  assert.equal(unchanged.message, message);
  assert.equal(unchanged.job, original);
});

test('every active catalog template receives test delivery routing after its original rendering', () => {
  const config = loadMailerConfig(testEnv);
  const manifest = JSON.parse(fs.readFileSync(new URL('../packages/mailer/templates/manifest.json', import.meta.url), 'utf8'));
  for (const template of manifest.templates.filter((item) => !item.marketing)) {
    const variables = Object.fromEntries(template.placeholders.map((key) =>
      [key, key.endsWith('_url') ? '/konto' : key === 'booking_number' ? 'VL-8A4C2D7E91' : 'Zapisana wartość']));
    const original = job({ template: template.id, variables });
    const attachments = (template.required_document_kinds || []).map((kind) => document(kind));
    const rendered = renderMail(original.payload, config, original, new Date(), attachments);
    const routed = routeMailDelivery(config, rendered, original);
    assert.equal(routed.job.email, 'wydmuch@gmail.com', template.id);
    assert.equal(routed.message.subject, 'VANLY-TEST: ' + rendered.subject, template.id);
    assert.equal(routed.message.html, rendered.html, template.id);
    assert.equal(routed.message.attachments, rendered.attachments, template.id);
  }
});

test('SES receives only the test To address, with original PDF, sender policy and queue/user identity retained', async () => {
  const config = loadMailerConfig(sesEnv);
  const requests = [], checkedRecipients = [], originalJobs = [];
  const doc = document();
  const original = job({ senderKind: 'portal', documentRefs: [{ documentId: doc.documentId }],
    notificationGuard: { kind: 'balance', bookingId: 'booking-1' } });
  original.cc = ['cc@example.com']; original.bcc = ['bcc@example.com'];
  const service = new MailerService(null, { config,
    sesClient: { async send(command) { requests.push(command.input); return { MessageId: 'ses-test-' + requests.length }; } },
    queue: { async prepareSend(value) { originalJobs.push(value); },
      async finish(value, outcome) { originalJobs.push(value); assert.equal(outcome.status, 'accepted'); } },
    documentResolver: async (_refs, value) => { originalJobs.push(value); return [doc]; },
    notificationGuard: async (value) => { originalJobs.push(value); return true; },
    suppression: { async isSuppressed(email) { checkedRecipients.push(email); return email === original.email; } },
  });
  assert.equal(await service.process(original), 'accepted');
  assert.ok(originalJobs.every((value) => value === original));
  assert.deepEqual(checkedRecipients, ['wydmuch@gmail.com']);
  assert.deepEqual(requests[0].Destination, { ToAddresses: ['wydmuch@gmail.com'] });
  assert.equal(requests[0].Content.Simple.Subject.Data, 'VANLY-TEST: Rezerwacja VANLY');
  assert.equal(requests[0].FromEmailAddress, 'portal@vanly.me');
  assert.deepEqual(requests[0].ReplyToAddresses, ['info@wydmuch.xyz']);
  assert.deepEqual(requests[0].Content.Simple.Attachments[0].RawContent, doc.data);
  assert.ok(!JSON.stringify(requests[0].Destination).includes('original@'));
  const reset = job({ template: '02-reset-hasla', senderKind: 'no-reply',
    variables: { action_url: '/konto?reset=original-user-token', reset_expires_at: '7 października, 14:30' } });
  assert.equal(await service.process(reset), 'accepted');
  assert.equal(requests[1].FromEmailAddress, 'no-reply@vanly.me');
  assert.equal(requests[1].ReplyToAddresses, undefined);
  assert.equal(requests[1].Content.Simple.Subject.Data, 'VANLY-TEST: VANLY — ustaw nowe hasło');
  assert.ok(requests[1].Content.Simple.Body.Html.Data.includes('original-user-token'));
  assert.deepEqual(requests[1].Destination, { ToAddresses: ['wydmuch@gmail.com'] });
});

test('local provider delivery uses test subject and address while account identity remains unchanged', async () => {
  const config = loadMailerConfig(testEnv);
  const original = job();
  let sent, finished;
  const service = new MailerService(null, { config,
    provider: { name: 'local', async send(message, value) { sent = { message, job: value }; return { status: 'local', messageId: 'local:41' }; } },
    queue: { async finish(value) { finished = value; } },
  });
  assert.equal(await service.process(original), 'local');
  assert.equal(sent.job.email, 'wydmuch@gmail.com');
  assert.equal(sent.message.subject, 'VANLY-TEST: Rezerwacja VANLY');
  assert.equal(sent.job.recipient_user_id, 'original-user');
  assert.equal(finished, original);
});

test('newsletter routing retains original consent guard and unsubscribe URLs without changing the account', async () => {
  const config = loadMailerConfig(sesEnv);
  const original = job({ notificationGuard: { kind: 'newsletter', campaignId: 'original-campaign' },
    marketing: { campaignId: 'original-campaign', unsubscribeUrl: 'https://vanly.me.local/newsletter/rezygnacja?token=original-user-token',
      oneClickUnsubscribeUrl: 'https://vanly.me.local/api/v1/newsletter/unsubscribe?token=original-user-token' } });
  let guardJob, request;
  const service = new MailerService(null, { config,
    sesClient: { async send(command) { request = command.input; return { MessageId: 'newsletter-test' }; } },
    queue: { async finish() {} }, suppression: { async isSuppressed() { return false; } },
    notificationGuard: async (value) => { guardJob = value; return true; },
  });
  assert.equal(await service.process(original), 'accepted');
  assert.equal(guardJob, original);
  assert.deepEqual(request.Destination, { ToAddresses: ['wydmuch@gmail.com'] });
  assert.equal(request.Content.Simple.Subject.Data, 'VANLY-TEST: Rezerwacja VANLY');
  assert.ok(request.Content.Simple.Headers[0].Value.includes('original-user-token'));
  assert.equal(original.email, 'original@example.com');
});

test('test delivery cannot bypass original recipient, expiry, document, notification or lease checks', async () => {
  const config = loadMailerConfig(testEnv);
  let sends = 0, outcome, finishes = 0;
  const queue = { async finish(_value, result) { outcome = result; finishes++; } };
  const service = new MailerService(null, { config, queue,
    provider: { name: 'local', async send() { sends++; } }, notificationGuard: async () => false,
    documentResolver: async () => { throw Object.assign(new Error('private document'), { name: 'DocumentError', code: 'DOCUMENT_NOT_FOUND' }); },
  });
  for (const [value, code] of [
    [{ ...job(), email: 'invalid' }, 'MAIL_RECIPIENT_UNAVAILABLE'],
    [job({ userId: 'another-user' }), 'MAIL_RECIPIENT_UNAVAILABLE'],
    [job({ expiresAt: '2020-01-01T00:00:00Z' }), 'MAIL_EXPIRED'],
    [job({ documentRefs: [{ documentId: document().documentId }] }), 'DOCUMENT_NOT_FOUND'],
    [job({ notificationGuard: { kind: 'balance', bookingId: 'booking-1' } }), 'NOTIFICATION_NO_LONGER_APPLICABLE'],
  ]) {
    assert.equal(await service.process(value), 'dead');
    assert.equal(outcome.code, code);
  }
  const previousFinishes = finishes;
  queue.prepareSend = async () => { throw new MailerError('MAIL_LEASE_LOST'); };
  await assert.rejects(service.process(job()), /MAIL_LEASE_LOST/);
  assert.equal(finishes, previousFinishes);
  assert.equal(sends, 0);
});

test('suppression of the effective test inbox and failed checks stop SES delivery', async () => {
  const config = loadMailerConfig(sesEnv);
  let sends = 0, result;
  const service = new MailerService(null, { config,
    provider: { name: 'ses', async send() { sends++; } },
    queue: { async finish(_value, outcome) { result = outcome; } },
    suppression: { async isSuppressed(email) { assert.equal(email, 'wydmuch@gmail.com'); return true; } },
  });
  assert.equal(await service.process(job()), 'dead');
  assert.equal(result.code, 'MAIL_RECIPIENT_SUPPRESSED');
  service.suppression.isSuppressed = async () => { throw new Error('database'); };
  assert.equal(await service.process(job()), 'retry');
  assert.equal(result.code, 'MAIL_SUPPRESSION_CHECK_FAILED');
  assert.equal(sends, 0);
});

test('production delivery keeps original address and subject with the same sender policy', async () => {
  const config = loadMailerConfig({ ...sesEnv, MAIL_DEPLOYMENT_ENVIRONMENT: 'production',
    MAIL_TEST_MODE: 'false', MAIL_TEST_RECIPIENT: '', APP_URL: 'https://vanly.me' });
  let request, checked;
  const service = new MailerService(null, { config,
    sesClient: { async send(command) { request = command.input; return { MessageId: 'production' }; } },
    queue: { async finish() {} }, suppression: { async isSuppressed(email) { checked = email; return false; } },
  });
  assert.equal(await service.process(job()), 'accepted');
  assert.equal(checked, 'original@example.com');
  assert.deepEqual(request.Destination, { ToAddresses: ['original@example.com'] });
  assert.equal(request.Content.Simple.Subject.Data, 'Rezerwacja VANLY');
});
