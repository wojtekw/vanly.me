import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUatTestMailProvider } from './test-mail-provider.mjs';
const config = { provider: 'ses', testMode: true, deploymentEnvironment: 'local',
  awsProfile: 'vanly-mailer-test', testRecipient: 'uat-operator@example.test' };
const job = { id: '1', recipient_user_id: 'tester-1', email: config.testRecipient };
const message = { subject: 'VANLY-TEST: wiadomość' };

test('SES testing retains a private inbox copy and the SES acceptance outcome', async () => {
  const calls = [];
  const provider = createUatTestMailProvider(null, config, {
    local: { send: async (mail, recipient) => calls.push(['local', recipient.recipient_user_id, mail.subject]) },
    ses: { send: async (mail, recipient) => { calls.push(['ses', recipient.email]); return { status: 'accepted', messageId: 'ses-test' }; } },
  });
  assert.deepEqual(await provider.send(message, job), { status: 'accepted', messageId: 'ses-test' });
  assert.deepEqual(calls, [['local', 'tester-1', message.subject], ['ses', config.testRecipient]]);
});
test('UAT wrapper refuses production mode and an unredirected recipient', async () => {
  assert.throws(() => createUatTestMailProvider(null, { ...config, testMode: false, testRecipient: undefined }),
    { code: 'UAT_TEST_MAIL_CONFIGURATION_REQUIRED' });
  let sent = false;
  const provider = createUatTestMailProvider(null, config, {
    local: { send: async () => { sent = true; } }, ses: { send: async () => { sent = true; } },
  });
  await assert.rejects(provider.send(message, { ...job, email: 'client@example.test' }),
    { code: 'UAT_TEST_MAIL_RECIPIENT_MISMATCH' });
  assert.equal(sent, false);
});
test('inbox failure prevents external send and remains retryable', async () => {
  let sent = false;
  const provider = createUatTestMailProvider(null, config, {
    local: { send: async () => { throw Error('storage unavailable'); } },
    ses: { send: async () => { sent = true; } },
  });
  await assert.rejects(provider.send(message, job), { code: 'LOCAL_MAIL_STORAGE_FAILED', outcome: 'retry' });
  assert.equal(sent, false);
});
test('SES failure is not reported as delivered', async () => {
  const failure = Error('SES unavailable');
  const provider = createUatTestMailProvider(null, config, {
    local: { send: async () => ({ status: 'local' }) }, ses: { send: async () => { throw failure; } },
  });
  await assert.rejects(provider.send(message, job), error => error === failure);
});
