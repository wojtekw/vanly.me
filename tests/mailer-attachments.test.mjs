import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createSesProvider } from '../packages/mailer/providers/ses.mjs';
import { renderMail } from '../packages/mailer/renderer.mjs';
import { loadMailerConfig } from '../packages/mailer/config.mjs';
import { MailerService } from '../packages/mailer/service.mjs';
import { validateAttachments, validateEncodedMessageSize, MAX_ENCODED_MAIL_BYTES } from '../packages/mailer/attachments.mjs';
const config = loadMailerConfig({});
const attachment = (kind = 'summary', size) => {
  const data = size ? Buffer.alloc(size) : Buffer.from('%PDF-1.7\nexample document\n%%EOF');
  if (size) data.write('%PDF-1.7');
  return { documentId: '55555555-5555-4555-8555-555555555555', fileName: 'VANLY-VL-8A4C2D7E91-podsumowanie-v1.pdf',
    contentType: 'application/pdf', data, sha256: crypto.createHash('sha256').update(data).digest('hex'), kind, version: 1,
    bookingReference: 'VL-8A4C2D7E91', bookingStatus: 'confirmed', amendmentId: kind === 'amendment' ? '66666666-6666-4666-8666-666666666666' : undefined };
};
const generic = () => ({ subject: 'Rezerwacja', body: 'PDF w załączniku' });

test('SES uses binary PDF Attachments with explicit BASE64 MIME encoding and exact original bytes', async () => {
  const doc = attachment();
  const message = renderMail(generic(), config, {}, new Date(), [doc]);
  let request;
  const provider = createSesProvider(config, { async send(command) { request = command.input; return { MessageId: 'ses-attachment' }; } });
  assert.deepEqual(await provider.send(message, { id: 1, email: 'anna@example.com' }), { messageId: 'ses-attachment', status: 'accepted' });
  const sent = request.Content.Simple.Attachments[0];
  assert.equal(sent.ContentTransferEncoding, 'BASE64'); assert.equal(sent.ContentDisposition, 'ATTACHMENT');
  assert.equal(sent.ContentType, 'application/pdf'); assert.equal(sent.FileName, doc.fileName);
  assert.deepEqual(sent.RawContent, doc.data); assert.ok(Buffer.isBuffer(sent.RawContent));
  assert.ok(request.Content.Simple.Body.Html.Data.includes('PDF w załączniku'));
});

test('unsafe filename, checksum, content type, and MIME expanded size fail before AWS', async () => {
  assert.throws(() => validateAttachments([{ ...attachment(), fileName: 'a.pdf\r\nBcc: x@a' }]), /ATTACHMENT_INVALID/);
  assert.throws(() => validateAttachments([{ ...attachment(), sha256: '0'.repeat(64) }]), /ATTACHMENT_INVALID/);
  assert.throws(() => validateAttachments([{ ...attachment(), contentType: 'text/html' }]), /ATTACHMENT_INVALID/);
  const docs = [attachment('summary', 4 * 1024 * 1024), { ...attachment('amendment', 4 * 1024 * 1024), documentId: '66666666-6666-4666-8666-666666666666' }];
  assert.throws(() => renderMail(generic(), config, {}, new Date(), docs), /ENCODED_MESSAGE_TOO_LARGE/);
  let calls = 0;
  const provider = createSesProvider(config, { async send() { calls++; } });
  await assert.rejects(provider.send({ subject: 'x', html: 'x', text: 'x', attachments: docs }, { id: 1, email: 'anna@example.com' }), /ENCODED_MESSAGE_TOO_LARGE/);
  assert.equal(calls, 0);
  assert.ok(validateEncodedMessageSize({ subject: 'x', html: 'x', text: 'x', attachments: [attachment()] }) < MAX_ENCODED_MAIL_BYTES);
});

test('confirmation and accepted amendment templates require the correct actual document kind', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../packages/mailer/templates/manifest.json', import.meta.url), 'utf8'));
  for (const [template, kind] of [['04-rezerwacja-potwierdzona', 'summary'], ['06-zmiana-dat-z-doplata', 'amendment']]) {
    assert.throws(() => renderMail({ template }, config), /ATTACHMENTS_REQUIRED/);
    assert.throws(() => renderMail({ template }, config, {}, new Date(), [attachment(kind === 'summary' ? 'pickup' : 'summary')]), /ATTACHMENTS_REQUIRED/);
    // Once the required attachment is present, missing business variables are rejected next.
    assert.throws(() => renderMail({ template }, config, {}, new Date(), [attachment(kind)]), /MISSING_TEMPLATE_VALUE/);
    const variables = Object.fromEntries(manifest.templates.find((item) => item.id === template).placeholders.map((key) =>
      [key, key.endsWith('_url') ? '/konto' : key === 'booking_number' ? 'VL-8A4C2D7E91' : 'Przykładowa zapisana wartość']));
    const message = renderMail({ template, variables }, config, {}, new Date(), [attachment(kind)]);
    assert.ok(message.html.includes(attachment().fileName));
    assert.ok(!message.text.includes('zapisane warunki dołączamy'));
    assert.throws(() => renderMail({ template, variables: { ...variables, booking_number: 'VL-OTHER' } }, config, {}, new Date(), [attachment(kind)]), /DOCUMENT_BOOKING_MISMATCH/);
    if (kind === 'summary') assert.throws(() => renderMail({ template, variables }, config, {}, new Date(), [{ ...attachment(kind), bookingStatus: 'pending' }]), /DOCUMENT_STATUS_MISMATCH/);
  }
});

test('mailer guard is fail closed and document resolver never exposes an unrelated document', async () => {
  const job = { id: 1, recipient_user_id: 'user-1', email: 'anna@example.com', attempts: 1,
    payload: { ...generic(), userId: 'user-1', notificationGuard: { kind: 'balance', bookingId: 'booking-1' } } };
  let sent = 0, resolution = 0, outcome;
  const queue = { async finish(_, value) { outcome = value; } };
  const provider = { name: 'local', async send() { sent++; return { status: 'local', messageId: '1' }; } };
  assert.equal(await new MailerService(null, { config, queue, provider }).process(job), 'dead');
  assert.equal(outcome.code, 'NOTIFICATION_GUARD_UNAVAILABLE');
  assert.equal(await new MailerService(null, { config, queue, provider, notificationGuard: async () => false }).process(job), 'dead');
  assert.equal(outcome.code, 'NOTIFICATION_NO_LONGER_APPLICABLE');
  assert.equal(await new MailerService(null, { config, queue, provider, notificationGuard: async () => { throw new Error('database'); } }).process(job), 'retry');
  assert.equal(outcome.code, 'NOTIFICATION_GUARD_CHECK_FAILED');
  job.payload.documentRefs = [{ documentId: attachment().documentId }];
  const service = new MailerService(null, { config, queue, provider, notificationGuard: async () => true,
    documentResolver: async () => { resolution++; const error = new Error('DOCUMENT_NOT_FOUND'); error.name = 'DocumentError'; error.code = 'DOCUMENT_NOT_FOUND'; throw error; } });
  assert.equal(await service.process(job), 'dead'); assert.equal(outcome.code, 'DOCUMENT_NOT_FOUND');
  assert.equal(resolution, 1); assert.equal(sent, 0);
});

test('marketing headers require matching newsletter guard and trusted HTTPS unsubscribe links', () => {
  const secure = loadMailerConfig({ APP_URL: 'https://vanly.example' });
  const payload = { ...generic(), notificationGuard: { kind: 'newsletter', campaignId: 'campaign-1' },
    marketing: { campaignId: 'campaign-1', unsubscribeUrl: 'https://vanly.example/newsletter/unsubscribe?t=token',
      oneClickUnsubscribeUrl: 'https://vanly.example/api/v1/newsletter/unsubscribe?t=token' } };
  const message = renderMail(payload, secure);
  assert.deepEqual(message.headers.map((h) => h.Name), ['List-Unsubscribe', 'List-Unsubscribe-Post']);
  assert.ok(message.html.includes(`href="${payload.marketing.unsubscribeUrl}"`));
  assert.ok(message.html.includes('Rezygnuję z inspiracji'));
  assert.throws(() => renderMail({ ...payload, notificationGuard: undefined }, secure), /MARKETING_GUARD_REQUIRED/);
  assert.throws(() => renderMail({ ...payload, marketing: { ...payload.marketing, oneClickUnsubscribeUrl: 'https://attacker.example' } }, secure), /UNTRUSTED_ACTION_URL/);
});

test('state changes during document resolution and expiry during preparation stop delivery', async (t) => {
  const clock = Date.parse('2026-10-07T12:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: clock });
  const job = { id: 1, recipient_user_id: 'user-1', email: 'anna@example.com', attempts: 1,
    payload: { ...generic(), userId: 'user-1', expiresAt: new Date(clock + 1000).toISOString(),
      documentRefs: [{ documentId: attachment().documentId }],
      notificationGuard: { kind: 'balance', bookingId: 'booking-1' } } };
  let applicable = true, sent = 0, outcome;
  const service = new MailerService(null, { config,
    queue: { async finish(_, result) { outcome = result; } },
    provider: { name: 'local', async send() { sent++; } },
    notificationGuard: async () => applicable,
    documentResolver: async () => { applicable = false; return [attachment()]; },
  });
  assert.equal(await service.process(job), 'dead');
  assert.equal(outcome.code, 'NOTIFICATION_NO_LONGER_APPLICABLE');
  service.documentResolver = async () => { applicable = true; t.mock.timers.tick(1001); return [attachment()]; };
  assert.equal(await service.process(job), 'dead');
  assert.equal(outcome.code, 'MAIL_EXPIRED');
  assert.equal(sent, 0);
});
