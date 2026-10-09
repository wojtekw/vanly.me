import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { configureMailerLocal } from '../scripts/configure-mailer-local.mjs';
import {
  fingerprint, FINGERPRINT_CONCURRENCY, MANAGED, DEPENDENCIES, ARTIFACTS, PUBLIC_INPUTS, MIGRATIONS,
  hashPaths, sourceOptions, artifactOptions, copyManaged, stageDependencies, validateDependencyLinks,
} from '../scripts/release-fingerprint.mjs';
import {
  verifyContents, verifyRelease, readManifest, backupRuntime, installRelease, restoreRuntime,
} from '../scripts/verify-mailer-release.mjs';

const run = promisify(execFile);
const configureScript = fileURLToPath(new URL('../scripts/configure-mailer-local.mjs', import.meta.url));
const now = new Date('2026-10-07T12:00:00.000Z');

async function fixture(t, content = '') {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vanly-deploy-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const envFile = path.join(root, '.env.local');
  await fs.writeFile(envFile, content, { mode: 0o644 });
  return { root, envFile };
}

async function write(root, relative, content) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

const sesFixture = {
  MAIL_PROVIDER: 'ses',
  MAIL_SES_ENABLED: 'true',
  MAIL_FROM: 'portal@vanly.me',
  MAIL_FROM_NO_REPLY: 'no-reply@vanly.me',
  MAIL_FROM_PORTAL: 'portal@vanly.me',
  MAIL_REPLY_TO: 'support@example.com',
  APP_URL: 'https://vanly.example',
  MAIL_SES_START_AFTER: '2026-10-06T10:00:00Z',
  MAIL_SENDER_LEGAL_NAME: 'Existing operator',
  MAIL_SENDER_LEGAL_ADDRESS: 'Existing address',
  MAIL_SENDER_REGISTRATION_DETAILS: 'Existing registration',
  MAIL_FEEDBACK_ENABLED: 'true',
  MAIL_AWS_REGION: 'eu-central-1',
  MAIL_SES_CONFIGURATION_SET: 'existing-events',
  MAIL_FEEDBACK_QUEUE_URL: 'https://sqs.eu-central-1.amazonaws.com/123456789012/existing-feedback',
  MAIL_FEEDBACK_SNS_TOPIC_ARN: 'arn:aws:sns:eu-central-1:123456789012:existing-feedback',
  MAIL_REMINDERS_ENABLED: 'false',
  MAIL_NEWSLETTER_ENABLED: 'true',
  MAIL_REMINDERS_SEND_HOUR: '14',
  NOTIFICATION_START_AFTER: '2026-10-05T08:00:00Z',
  AWS_ACCESS_KEY_ID: 'fake-access-key-for-test-only',
  AWS_SECRET_ACCESS_KEY: 'fake-private-value # preserved',
  DATABASE_URL: 'postgresql://fixture:fake-only@invalid.example/never-connect',
};
const serialize = (values) => Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';

test('configuration initializes missing values without replacing a working SES configuration', async (t) => {
  const { envFile } = await fixture(t, serialize(sesFixture));
  await configureMailerLocal(envFile, { now });
  const parsed = dotenv.parse(await fs.readFile(envFile, 'utf8'));
  for (const [key, value] of Object.entries(sesFixture)) assert.equal(parsed[key], value, key);
  assert.equal(parsed.MAIL_UNREAD_DELAY_MINUTES, '5');
  assert.equal(parsed.MAIL_UNREAD_COOLDOWN_HOURS, '12');
});

test('local initialization uses the portal/no-reply senders and keeps its original cutover on repeated runs', async (t) => {
  const { root, envFile } = await fixture(t, '# fixture-only private configuration\nAPP_ORIGIN="https://vanly.me.local"\nPRIVATE_TOKEN="fake-token # retained"\n');
  const before = await fs.stat(envFile);
  await configureMailerLocal(envFile, { now });
  const configured = await fs.readFile(envFile, 'utf8');
  const values = dotenv.parse(configured);
  assert.equal(values.MAIL_PROVIDER, 'local');
  assert.equal(values.MAIL_SES_ENABLED, 'false');
  assert.equal(values.MAIL_FEEDBACK_ENABLED, 'false');
  assert.equal(values.MAIL_DEPLOYMENT_ENVIRONMENT, 'local');
  assert.equal(values.MAIL_TEST_MODE, 'false');
  assert.equal(values.MAIL_TEST_RECIPIENT, '');
  assert.equal(values.MAIL_FROM, 'portal@vanly.me');
  assert.equal(values.MAIL_FROM_PORTAL, 'portal@vanly.me');
  assert.equal(values.MAIL_FROM_NO_REPLY, 'no-reply@vanly.me');
  assert.equal(values.MAIL_REPLY_TO, 'info@wydmuch.xyz');
  assert.equal(values.APP_URL, 'https://vanly.me.local');
  assert.equal(values.NOTIFICATION_START_AFTER, now.toISOString());
  assert.equal(values.PRIVATE_TOKEN, 'fake-token # retained');
  assert.ok(configured.includes('# fixture-only private configuration'));
  const after = await fs.stat(envFile);
  assert.equal(after.mode & 0o777, 0o600);
  assert.notEqual(after.ino, before.ino, 'replace the private file atomically');
  assert.deepEqual(await fs.readdir(root), ['.env.local'], 'leave no private temporary copy');
  await configureMailerLocal(envFile, { now: new Date('2026-10-09T12:00:00Z') });
  assert.equal(await fs.readFile(envFile, 'utf8'), configured, 'repeated deploys must keep values and cutover');
});

test('duplicate dotenv assignments retain the last effective value, including exported and private entries', async (t) => {
  const duplicates = [
    'MAIL_FROM="obsolete@example.com"',
    '  export MAIL_FROM = "portal@vanly.me" # effective sender',
    'MAIL_REMINDERS_ENABLED="true"',
    'MAIL_REMINDERS_ENABLED="false"',
    'PRIVATE_TOKEN="obsolete"',
    'export PRIVATE_TOKEN="fake-final-token # retained"',
    'APP_ORIGIN="https://vanly.me.local"',
  ].join('\n') + '\n';
  const { envFile } = await fixture(t, duplicates);
  const effective = dotenv.parse(duplicates);
  await configureMailerLocal(envFile, { now });
  const configured = await fs.readFile(envFile, 'utf8');
  const values = dotenv.parse(configured);
  for (const key of ['MAIL_FROM', 'MAIL_REMINDERS_ENABLED', 'PRIVATE_TOKEN']) {
    assert.equal(values[key], effective[key], key);
    const assignments = configured.split(/\r?\n/).filter((line) => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line));
    assert.equal(assignments.length, 1, `${key} should have one effective assignment`);
  }
});

test('quoted multiline private values retain their value without turning embedded text into assignments', async (t) => {
  const original = 'APP_ORIGIN="https://vanly.me.local"\nPRIVATE_CERT="FAKE_LINE=one\nFAKE_LINE=two"\n';
  const { envFile } = await fixture(t, original);
  const effective = dotenv.parse(original);
  await configureMailerLocal(envFile, { now });
  const values = dotenv.parse(await fs.readFile(envFile, 'utf8'));
  assert.equal(values.PRIVATE_CERT, effective.PRIVATE_CERT);
  assert.equal(values.FAKE_LINE, undefined);
});

test('invalid existing SES configuration is rejected before the private file changes', async (t) => {
  const invalid = serialize({ ...sesFixture, APP_URL: 'http://vanly.example' });
  const { root, envFile } = await fixture(t, invalid);
  await assert.rejects(configureMailerLocal(envFile, { now }), /PUBLIC_HTTPS/);
  assert.equal(await fs.readFile(envFile, 'utf8'), invalid);
  assert.deepEqual(await fs.readdir(root), ['.env.local']);
});

test('explicitly blank values are preserved and an invalid blank SES sender fails before write', async (t) => {
  const content = serialize({ ...sesFixture, MAIL_REPLY_TO: '', PRIVATE_TOKEN: '' });
  const { envFile } = await fixture(t, content);
  await assert.rejects(configureMailerLocal(envFile, { now }), /INVALID_MAIL_REPLY_TO/);
  assert.equal(await fs.readFile(envFile, 'utf8'), content);
});

test('configuration rejects a symlinked private file without changing its target', async (t) => {
  const { root, envFile } = await fixture(t);
  const target = path.join(root, 'private-target');
  const original = serialize(sesFixture);
  await fs.writeFile(target, original, { mode: 0o600 });
  await fs.unlink(envFile);
  await fs.symlink(target, envFile);
  await assert.rejects(configureMailerLocal(envFile, { now }));
  assert.equal(await fs.readFile(target, 'utf8'), original);
  assert.equal((await fs.lstat(envFile)).isSymbolicLink(), true);
});

test('configuration CLI accepts the original file argument and never prints private values', async (t) => {
  const { envFile } = await fixture(t, serialize(sesFixture));
  const { stdout, stderr } = await run(process.execPath, [configureScript, envFile]);
  const output = stdout + stderr;
  for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'DATABASE_URL']) {
    assert.ok(!output.includes(sesFixture[key]), `${key} must remain private`);
  }
  assert.equal(dotenv.parse(await fs.readFile(envFile, 'utf8')).MAIL_PROVIDER, 'ses');
});

test('explicit reply-to changes only that setting while preserving SES, senders and raw private multiline values', async (t) => {
  const multiline = '  export PRIVATE_CERT = "FAKE_LINE=one\nMAIL_REPLY_TO=embedded-private-text\nAWS_SECRET_ACCESS_KEY=embedded-private-text" # private multiline\n';
  const lastPrivate = 'export PRIVATE_TOKEN = "fake-final-token # raw retained" # private comment\n';
  const original = 'MAIL_REPLY_TO="obsolete@example.com"\nPRIVATE_TOKEN="obsolete-private-value"\n' + serialize(sesFixture) + multiline + lastPrivate;
  const { root, envFile } = await fixture(t, original);
  const previous = dotenv.parse(original);
  await configureMailerLocal(envFile, { now, replyTo: 'info@wydmuch.xyz' });
  const configured = await fs.readFile(envFile, 'utf8');
  const parsed = dotenv.parse(configured);
  assert.equal(parsed.MAIL_REPLY_TO, 'info@wydmuch.xyz');
  for (const [key, value] of Object.entries(previous)) {
    if (key !== 'MAIL_REPLY_TO') assert.equal(parsed[key], value, key);
  }
  for (const [key, value] of Object.entries(sesFixture)) {
    if (key !== 'MAIL_REPLY_TO') assert.ok(configured.includes(`${key}=${JSON.stringify(value)}\n`), `${key} raw assignment`);
  }
  assert.ok(configured.includes(multiline));
  assert.ok(configured.includes(lastPrivate));
  assert.ok(!configured.includes('obsolete-private-value'));
  assert.ok(!configured.includes('obsolete@example.com'));
  assert.equal(parsed.MAIL_FROM, 'portal@vanly.me');
  assert.equal(parsed.MAIL_FROM_PORTAL, 'portal@vanly.me');
  assert.equal(parsed.MAIL_FROM_NO_REPLY, 'no-reply@vanly.me');
  assert.equal((await fs.stat(envFile)).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(root), ['.env.local']);
  await configureMailerLocal(envFile, { now });
  assert.equal(await fs.readFile(envFile, 'utf8'), configured, 'later initialization preserves the explicit address');
});

test('explicit reply-to is used when the setting is missing and accepts another mailbox domain', async (t) => {
  const { envFile } = await fixture(t);
  await configureMailerLocal(envFile, { now, replyTo: 'replies@another.example' });
  const parsed = dotenv.parse(await fs.readFile(envFile, 'utf8'));
  assert.equal(parsed.MAIL_REPLY_TO, 'replies@another.example');
  assert.equal(parsed.MAIL_PROVIDER, 'local');
  assert.equal(parsed.MAIL_FROM, 'portal@vanly.me');
  assert.equal(parsed.MAIL_FROM_PORTAL, 'portal@vanly.me');
  assert.equal(parsed.MAIL_FROM_NO_REPLY, 'no-reply@vanly.me');
});

test('invalid or injected reply-to overrides fail before any private file or permission changes', async (t) => {
  for (const replyTo of ['', null, false, 0, 'not-an-address', 'info@wydmuch.xyz\nMAIL_SES_ENABLED=false', 'info@wydmuch.xyz\r\nBcc: attacker@example.com']) {
    const original = serialize(sesFixture);
    const { root, envFile } = await fixture(t, original);
    const before = await fs.stat(envFile);
    await assert.rejects(configureMailerLocal(envFile, { now, replyTo }), /INVALID_MAIL_REPLY_TO/);
    assert.equal(await fs.readFile(envFile, 'utf8'), original);
    const after = await fs.stat(envFile);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mode, before.mode);
    assert.deepEqual(await fs.readdir(root), ['.env.local']);
  }
  const { root, envFile } = await fixture(t, 'PRIVATE_TOKEN="fake-only"\n');
  const original = await fs.readFile(envFile, 'utf8');
  await assert.rejects(configureMailerLocal(envFile, { now, replyTo: '' }), /INVALID_MAIL_REPLY_TO/);
  assert.equal(await fs.readFile(envFile, 'utf8'), original, 'local fallback must not mask an invalid explicit blank');
  assert.deepEqual(await fs.readdir(root), ['.env.local']);
});

test('configuration CLI accepts only a validated reply-to override and keeps private values out of output', async (t) => {
  const { envFile } = await fixture(t, serialize(sesFixture));
  const { stdout, stderr } = await run(process.execPath, [configureScript, envFile, 'info@wydmuch.xyz']);
  const output = stdout + stderr;
  for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'DATABASE_URL']) assert.ok(!output.includes(sesFixture[key]), key);
  const parsed = dotenv.parse(await fs.readFile(envFile, 'utf8'));
  assert.equal(parsed.MAIL_REPLY_TO, 'info@wydmuch.xyz');
  for (const [key, value] of Object.entries(sesFixture)) if (key !== 'MAIL_REPLY_TO') assert.equal(parsed[key], value, key);
  const original = await fs.readFile(envFile, 'utf8');
  await assert.rejects(run(process.execPath, [configureScript, envFile, 'info@wydmuch.xyz\nMAIL_FROM=attacker@example.com']), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stderr.trim(), 'INVALID_MAIL_REPLY_TO');
    assert.ok(!error.stderr.includes('attacker'));
    return true;
  });
  assert.equal(await fs.readFile(envFile, 'utf8'), original);
});

test('explicit local test recipient changes only routing settings and preserves the existing transport and raw private values', async (t) => {
  const { root, envFile } = await fixture(t, serialize({ ...sesFixture, AWS_PROFILE: 'vanly-mailer-local-test' }));
  await configureMailerLocal(envFile, { now });
  const multiline = '  export PRIVATE_CERT = "FAKE_LINE=one\nMAIL_TEST_RECIPIENT=embedded-private-text\nMAIL_TEST_MODE=embedded-private-text" # private multiline\n';
  await fs.appendFile(envFile, multiline);
  const original = await fs.readFile(envFile, 'utf8');
  const before = dotenv.parse(original);
  await configureMailerLocal(envFile, { now, testRecipient: 'wydmuch@gmail.com' });
  const configured = await fs.readFile(envFile, 'utf8');
  const after = dotenv.parse(configured);
  assert.equal(after.MAIL_DEPLOYMENT_ENVIRONMENT, 'local');
  assert.equal(after.MAIL_TEST_MODE, 'true');
  assert.equal(after.MAIL_TEST_RECIPIENT, 'wydmuch@gmail.com');
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  const routingKeys = new Set(['MAIL_DEPLOYMENT_ENVIRONMENT', 'MAIL_TEST_MODE', 'MAIL_TEST_RECIPIENT']);
  for (const [key, value] of Object.entries(before)) {
    if (!routingKeys.has(key)) assert.equal(after[key], value, key);
  }
  assert.ok(configured.includes(multiline), 'do not reserialize the embedded private multiline value');
  for (const [key, value] of Object.entries(sesFixture)) assert.ok(configured.includes(`${key}=${JSON.stringify(value)}\n`), `${key} raw assignment`);
  assert.equal((await fs.stat(envFile)).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(root), ['.env.local']);
  await configureMailerLocal(envFile, { now: new Date('2026-10-09T12:00:00Z') });
  assert.equal(await fs.readFile(envFile, 'utf8'), configured, 'later deploys keep the explicit routing without resetting cutovers');
});

test('local test routing overrides the last effective settings without duplicating or exposing embedded assignments', async (t) => {
  const original = 'MAIL_TEST_RECIPIENT="obsolete@example.com"\nMAIL_TEST_MODE="false"\nMAIL_DEPLOYMENT_ENVIRONMENT="local"\n' + serialize({
    ...sesFixture, AWS_PROFILE: 'vanly-mailer-local-test', MAIL_TEST_MODE: 'true', MAIL_TEST_RECIPIENT: 'previous@example.com',
  });
  const { envFile } = await fixture(t, original);
  await configureMailerLocal(envFile, { now, testRecipient: 'wydmuch@gmail.com', replyTo: 'info@wydmuch.xyz' });
  const configured = await fs.readFile(envFile, 'utf8');
  const parsed = dotenv.parse(configured);
  assert.equal(parsed.MAIL_TEST_RECIPIENT, 'wydmuch@gmail.com');
  assert.equal(parsed.MAIL_TEST_MODE, 'true');
  assert.equal(parsed.MAIL_DEPLOYMENT_ENVIRONMENT, 'local');
  assert.equal(parsed.MAIL_REPLY_TO, 'info@wydmuch.xyz');
  for (const key of ['MAIL_TEST_MODE', 'MAIL_TEST_RECIPIENT', 'MAIL_DEPLOYMENT_ENVIRONMENT']) {
    assert.equal(configured.split(/\r?\n/).filter((line) => line.startsWith(`${key}=`)).length, 1, key);
  }
  assert.ok(!configured.includes('obsolete@example.com'));
  assert.ok(!configured.includes('previous@example.com'));
});

test('invalid or injected local test recipients fail atomically before private values or permissions change', async (t) => {
  for (const testRecipient of ['', null, false, 0, 'not-an-address', 'wydmuch@gmail.com\nMAIL_SES_ENABLED=true', 'wydmuch@gmail.com\r\nBcc: attacker@example.com', 'a@example.com,b@example.com']) {
    const original = serialize(sesFixture);
    const { root, envFile } = await fixture(t, original);
    const before = await fs.stat(envFile);
    await assert.rejects(configureMailerLocal(envFile, { now, testRecipient }), /INVALID_MAIL_TEST_RECIPIENT/);
    assert.equal(await fs.readFile(envFile, 'utf8'), original);
    const after = await fs.stat(envFile);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mode, before.mode);
    assert.deepEqual(await fs.readdir(root), ['.env.local']);
  }
});

test('test recipient override cannot relabel an explicitly production environment and inactive routing cannot have a recipient', async (t) => {
  const production = serialize({ ...sesFixture, MAIL_DEPLOYMENT_ENVIRONMENT: 'production' });
  const { root, envFile } = await fixture(t, production);
  const before = await fs.stat(envFile);
  await assert.rejects(configureMailerLocal(envFile, { now, testRecipient: 'wydmuch@gmail.com' }), /MAIL_TEST_MODE_REQUIRES_LOCAL_ENVIRONMENT/);
  assert.equal(await fs.readFile(envFile, 'utf8'), production);
  assert.equal((await fs.stat(envFile)).ino, before.ino);
  assert.deepEqual(await fs.readdir(root), ['.env.local']);
  await configureMailerLocal(envFile, { now });
  const parsed = dotenv.parse(await fs.readFile(envFile, 'utf8'));
  assert.equal(parsed.MAIL_DEPLOYMENT_ENVIRONMENT, 'production');
  assert.equal(parsed.MAIL_TEST_MODE, 'false');
  assert.equal(parsed.MAIL_TEST_RECIPIENT, '');

  const inactive = serialize({ ...sesFixture, MAIL_TEST_MODE: 'false', MAIL_TEST_RECIPIENT: 'wydmuch@gmail.com' });
  const fixtureInactive = await fixture(t, inactive);
  await assert.rejects(configureMailerLocal(fixtureInactive.envFile, { now }), /MAIL_TEST_RECIPIENT_REQUIRES_TEST_MODE/);
  assert.equal(await fs.readFile(fixtureInactive.envFile, 'utf8'), inactive);
});

test('configuration CLI supports named test routing with or without its original positional reply-to', async (t) => {
  for (const replyArguments of [[], ['info@wydmuch.xyz']]) {
    const { envFile } = await fixture(t, serialize({ ...sesFixture, AWS_PROFILE: 'vanly-mailer-local-test' }));
    const { stdout, stderr } = await run(process.execPath, [configureScript, envFile, ...replyArguments, '--test-recipient', 'wydmuch@gmail.com']);
    const output = stdout + stderr;
    for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'DATABASE_URL']) assert.ok(!output.includes(sesFixture[key]), key);
    const parsed = dotenv.parse(await fs.readFile(envFile, 'utf8'));
    assert.equal(parsed.MAIL_TEST_MODE, 'true');
    assert.equal(parsed.MAIL_TEST_RECIPIENT, 'wydmuch@gmail.com');
    assert.equal(parsed.MAIL_DEPLOYMENT_ENVIRONMENT, 'local');
    assert.equal(parsed.MAIL_REPLY_TO, replyArguments[0] || sesFixture.MAIL_REPLY_TO);
    for (const [key, value] of Object.entries(sesFixture)) if (key !== 'MAIL_REPLY_TO') assert.equal(parsed[key], value, key);
  }
});

test('configuration CLI rejects malformed routing arguments and injected addresses without changing the private file', async (t) => {
  for (const [argumentsList, code] of [
    [['--test-recipient'], 'INVALID_MAIL_CONFIGURATION_ARGUMENTS'],
    [['--test-recipient', 'wydmuch@gmail.com', '--test-recipient', 'another@example.com'], 'INVALID_MAIL_CONFIGURATION_ARGUMENTS'],
    [['--unknown', 'wydmuch@gmail.com'], 'INVALID_MAIL_CONFIGURATION_ARGUMENTS'],
    [['info@wydmuch.xyz', 'unexpected@example.com'], 'INVALID_MAIL_CONFIGURATION_ARGUMENTS'],
    [['--test-recipient', 'wydmuch@gmail.com\nMAIL_FROM=attacker@example.com'], 'INVALID_MAIL_TEST_RECIPIENT'],
  ]) {
    const original = serialize(sesFixture);
    const { root, envFile } = await fixture(t, original);
    await assert.rejects(run(process.execPath, [configureScript, envFile, ...argumentsList]), (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stderr.trim(), code);
      assert.ok(!error.stderr.includes('attacker'));
      return true;
    });
    assert.equal(await fs.readFile(envFile, 'utf8'), original);
    assert.deepEqual(await fs.readdir(root), ['.env.local']);
  }
});

test('explicit test SES profile changes only reviewed SES and routing settings while preserving private values', async (t) => {
  const { root, envFile } = await fixture(t, serialize({
    ...sesFixture, MAIL_PROVIDER: 'local', MAIL_SES_ENABLED: 'false', MAIL_FEEDBACK_ENABLED: 'false',
    APP_URL: 'https://vanly.me.local', MAIL_AWS_REGION: 'eu-west-1', AWS_PROFILE: 'existing-profile',
    MAIL_BATCH_SIZE: '10', MAIL_POLL_MS: '5000',
  }));
  await configureMailerLocal(envFile, { now });
  const multiline = 'export PRIVATE_CERT="FAKE_LINE=one\nAWS_PROFILE=embedded-private-text\nMAIL_SES_ENABLED=embedded-private-text" # raw private certificate\n';
  await fs.appendFile(envFile, multiline);
  const original = await fs.readFile(envFile, 'utf8');
  const before = dotenv.parse(original);
  await configureMailerLocal(envFile, { now, testRecipient: 'wydmuch@gmail.com', testSesProfile: 'vanly-mailer-local-test' });
  const configured = await fs.readFile(envFile, 'utf8');
  const after = dotenv.parse(configured);
  const overrides = {
    MAIL_DEPLOYMENT_ENVIRONMENT: 'local', MAIL_TEST_MODE: 'true', MAIL_TEST_RECIPIENT: 'wydmuch@gmail.com',
    MAIL_PROVIDER: 'ses', MAIL_SES_ENABLED: 'true', MAIL_SES_START_AFTER: now.toISOString(),
    AWS_PROFILE: 'vanly-mailer-local-test', MAIL_AWS_REGION: 'eu-central-1', MAIL_SES_CONFIGURATION_SET: 'vanly-transactional',
    MAIL_BATCH_SIZE: '1', MAIL_POLL_MS: '1000',
  };
  for (const [key, value] of Object.entries(overrides)) assert.equal(after[key], value, key);
  for (const [key, value] of Object.entries(before)) if (!Object.hasOwn(overrides, key)) assert.equal(after[key], value, key);
  assert.ok(configured.includes(multiline));
  for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'DATABASE_URL', 'MAIL_FROM', 'MAIL_FROM_NO_REPLY', 'MAIL_FROM_PORTAL', 'MAIL_REPLY_TO']) {
    assert.ok(configured.includes(`${key}=${JSON.stringify(before[key])}\n`), `${key} raw assignment`);
  }
  assert.equal(after.MAIL_FEEDBACK_ENABLED, 'false');
  assert.equal(after.NOTIFICATION_START_AFTER, before.NOTIFICATION_START_AFTER);
  assert.equal((await fs.stat(envFile)).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(root), ['.env.local']);
});

test('SES opt-in can use already validated local routing and ordinary reruns preserve its cutover and transport', async (t) => {
  const { envFile } = await fixture(t);
  await configureMailerLocal(envFile, { now, testRecipient: 'wydmuch@gmail.com' });
  await configureMailerLocal(envFile, { now, testSesProfile: 'vanly-mailer-local-test' });
  const configured = await fs.readFile(envFile, 'utf8');
  const parsed = dotenv.parse(configured);
  assert.equal(parsed.MAIL_PROVIDER, 'ses');
  assert.equal(parsed.MAIL_SES_START_AFTER, now.toISOString());
  assert.equal(parsed.AWS_PROFILE, 'vanly-mailer-local-test');
  const later = new Date('2026-10-09T12:00:00Z');
  await configureMailerLocal(envFile, { now: later });
  assert.equal(await fs.readFile(envFile, 'utf8'), configured, 'ordinary configuration must not rearm SES');
  await configureMailerLocal(envFile, { now: later, testSesProfile: 'vanly-mailer-local-test' });
  const rearmed = dotenv.parse(await fs.readFile(envFile, 'utf8'));
  assert.equal(rearmed.MAIL_SES_START_AFTER, later.toISOString(), 'explicit SES opt-in uses a fresh intentional cutover');
  assert.equal(rearmed.NOTIFICATION_START_AFTER, parsed.NOTIFICATION_START_AFTER);
});

test('SES opt-in rejects invalid profiles, production, absent test routing and invalid targets atomically', async (t) => {
  const cases = [
    ...['', null, false, 0, 'profile.name', 'profile/name', 'profile name', 'a'.repeat(65), 'test\nMAIL_TEST_MODE=false'].map((testSesProfile) => ({
      values: sesFixture, options: { testRecipient: 'wydmuch@gmail.com', testSesProfile }, code: 'INVALID_MAIL_TEST_SES_PROFILE',
    })),
    { values: { ...sesFixture, MAIL_DEPLOYMENT_ENVIRONMENT: 'production' }, options: { testRecipient: 'wydmuch@gmail.com', testSesProfile: 'test-profile' }, code: 'MAIL_TEST_MODE_REQUIRES_LOCAL_ENVIRONMENT' },
    { values: sesFixture, options: { testSesProfile: 'test-profile' }, code: 'MAIL_TEST_SES_REQUIRES_TEST_ROUTING' },
    { values: { ...sesFixture, MAIL_DEPLOYMENT_ENVIRONMENT: 'local', MAIL_TEST_MODE: 'true', MAIL_TEST_RECIPIENT: '' }, options: { testSesProfile: 'test-profile' }, code: 'INVALID_MAIL_TEST_RECIPIENT' },
    { values: sesFixture, options: { testRecipient: 'target\nBcc: attacker@example.com', testSesProfile: 'test-profile' }, code: 'INVALID_MAIL_TEST_RECIPIENT' },
  ];
  for (const { values, options, code } of cases) {
    const original = serialize(values);
    const { root, envFile } = await fixture(t, original);
    const before = await fs.stat(envFile);
    await assert.rejects(configureMailerLocal(envFile, { now, ...options }), new RegExp(code));
    assert.equal(await fs.readFile(envFile, 'utf8'), original);
    const after = await fs.stat(envFile);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mode, before.mode);
    assert.deepEqual(await fs.readdir(root), ['.env.local']);
  }
});

test('configuration CLI supports explicit SES test profile in either flag order and rejects malformed profile arguments', async (t) => {
  for (const flags of [
    ['--test-recipient', 'wydmuch@gmail.com', '--test-ses-profile', 'vanly-mailer-local-test'],
    ['info@wydmuch.xyz', '--test-ses-profile', 'vanly-mailer-local-test', '--test-recipient', 'wydmuch@gmail.com'],
  ]) {
    const { envFile } = await fixture(t, serialize(sesFixture));
    const { stdout, stderr } = await run(process.execPath, [configureScript, envFile, ...flags]);
    for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'DATABASE_URL']) assert.ok(!(stdout + stderr).includes(sesFixture[key]), key);
    const parsed = dotenv.parse(await fs.readFile(envFile, 'utf8'));
    assert.equal(parsed.AWS_PROFILE, 'vanly-mailer-local-test');
    assert.equal(parsed.MAIL_PROVIDER, 'ses');
    assert.equal(parsed.MAIL_SES_ENABLED, 'true');
    assert.equal(parsed.MAIL_TEST_MODE, 'true');
    assert.equal(parsed.MAIL_TEST_RECIPIENT, 'wydmuch@gmail.com');
    assert.equal(parsed.MAIL_FEEDBACK_ENABLED, 'true', 'existing feedback choice is preserved');
  }
  for (const flags of [
    ['--test-ses-profile'],
    ['--test-ses-profile', 'test-profile', '--test-ses-profile', 'another-profile'],
  ]) {
    const original = serialize(sesFixture);
    const { envFile } = await fixture(t, original);
    await assert.rejects(run(process.execPath, [configureScript, envFile, ...flags]), (error) => {
      assert.equal(error.stderr.trim(), 'INVALID_MAIL_CONFIGURATION_ARGUMENTS');
      return true;
    });
    assert.equal(await fs.readFile(envFile, 'utf8'), original);
  }
});

test('release fingerprints detect changed built output and dependencies instead of excluding them', async (t) => {
  const { root } = await fixture(t);
  for (const relative of ['apps/api/dist/main.js', 'apps/frontoffice/.next/server/page.js', 'node_modules/package/index.js']) {
    await write(root, relative, 'original');
    const before = await fingerprint(root, '.');
    await write(root, relative, 'changed');
    assert.notEqual(await fingerprint(root, '.'), before, relative);
  }
});

test('fingerprints ignore only .DS_Store by default and apply caller skips recursively', async (t) => {
  const { root } = await fixture(t);
  await write(root, 'tree/nested/file.js', 'stable');
  await write(root, 'tree/nested/cache/generated.js', 'first');
  const defaultHash = await fingerprint(root, 'tree');
  await write(root, 'tree/.DS_Store', 'finder metadata');
  await write(root, 'tree/nested/.DS_Store', 'nested metadata');
  assert.equal(await fingerprint(root, 'tree'), defaultHash);
  const options = { skip: new Set(['.DS_Store', 'cache']) };
  const skippedHash = await fingerprint(root, 'tree', options);
  await write(root, 'tree/nested/cache/generated.js', 'changed');
  assert.equal(await fingerprint(root, 'tree', options), skippedHash);
  assert.notEqual(await fingerprint(root, 'tree'), defaultHash);
  await write(root, 'tree/nested/file.js', 'changed source');
  assert.notEqual(await fingerprint(root, 'tree', options), skippedHash);
});

test('fingerprints detect renames, missing entries, and symlink targets without following the links', async (t) => {
  const { root } = await fixture(t);
  await write(root, 'tree/first.js', 'same contents');
  const original = await fingerprint(root, 'tree');
  await fs.rename(path.join(root, 'tree/first.js'), path.join(root, 'tree/second.js'));
  assert.notEqual(await fingerprint(root, 'tree'), original);
  assert.equal(await fingerprint(root, 'does-not-exist'), null);
  await fs.symlink('missing-target-a', path.join(root, 'link'));
  const firstTarget = await fingerprint(root, 'link');
  await fs.unlink(path.join(root, 'link'));
  await fs.symlink('missing-target-b', path.join(root, 'link'));
  assert.notEqual(await fingerprint(root, 'link'), firstTarget);
});

test('fingerprints are independent of directory creation order', async (t) => {
  const { root } = await fixture(t);
  for (const name of ['z.js', 'a.js', 'm.js']) await write(root, `first/${name}`, name);
  for (const name of ['m.js', 'z.js', 'a.js']) await write(root, `second/${name}`, name);
  assert.equal(await fingerprint(root, 'first'), await fingerprint(root, 'second'));
});

async function fakeInstallation(root) {
  for (const entry of MANAGED) {
    if (entry.startsWith('apps/') || entry.startsWith('packages/') || entry === 'scripts/worker') {
      await write(root, `${entry}/src/index.mjs`, `fixture for ${entry}`);
    } else if (entry === 'db/migrations') {
      for (const migration of MIGRATIONS) await write(root, `${entry}/${migration}`, '-- fixture only; never run');
    } else {
      await write(root, entry, entry === 'vanly' ? '#!/bin/sh\nexit 0\n' : `fixture for ${entry}`);
    }
  }
  await fs.chmod(path.join(root, 'vanly'), 0o751);
  await write(root, 'apps/api/dist/main.js', 'compiled API fixture');
  await write(root, 'apps/api/dist/cache/adapter.js', 'compiled cache module');
  for (const app of ['frontoffice', 'camperfolks', 'heyvans']) {
    await write(root, `apps/${app}/.next/BUILD_ID`, 'fixture-build-id');
    await write(root, `apps/${app}/.next/server/page.js`, 'compiled page fixture');
    await write(root, `apps/${app}/.next/server/app/cache/page.js`, 'compiled cache route');
  }
  for (const app of ['owner', 'admin']) await write(root, `apps/${app}/dist/index.html`, '<p>fixture build</p>');
  for (const entry of DEPENDENCIES) await write(root, `${entry}/fixture-package/index.js`, 'dependency fixture');
  for (const entry of PUBLIC_INPUTS) await write(root, `${entry}/logo.svg`, '<svg/>');
  await write(root, '.env.local', 'PRIVATE_TOKEN="fake-only"\nMAIL_PROVIDER="local"\n');
  await fs.chmod(path.join(root, '.env.local'), 0o600);
}

async function fakeRelease(t) {
  const { root } = await fixture(t);
  const source = path.join(root, 'source');
  const runtime = path.join(root, 'runtime');
  const release = path.join(root, 'release');
  for (const directory of [source, runtime, release]) await fakeInstallation(directory);
  const manifest = {
    version: 2, source, runtime, managed: MANAGED, migrations: MIGRATIONS,
    sourceHashes: await hashPaths(source, MANAGED, sourceOptions),
    sourceDependencies: await hashPaths(source, DEPENDENCIES),
    baseSources: await hashPaths(runtime, MANAGED, sourceOptions),
    baseArtifacts: await hashPaths(runtime, ARTIFACTS, artifactOptions),
    baseDependencies: await hashPaths(runtime, DEPENDENCIES),
    basePublic: await hashPaths(runtime, PUBLIC_INPUTS),
    baseEnv: await fingerprint(runtime, '.env.local'),
    releaseSources: await hashPaths(release, MANAGED, sourceOptions),
    releaseArtifacts: await hashPaths(release, ARTIFACTS, artifactOptions),
    releaseDependencies: await hashPaths(release, DEPENDENCIES),
    releaseEnv: await fingerprint(release, '.env.local'),
  };
  const saveManifest = () => fs.writeFile(path.join(release, 'mailer-release.json'), JSON.stringify(manifest));
  await saveManifest();
  return { root, source, runtime, release, manifest, saveManifest, options: { source, runtime, requirePrefix: false } };
}

test('verifier accepts a complete temporary release and rejects source/configuration/migration drift', async (t) => {
  const state = await fakeRelease(t);
  assert.deepEqual(await verifyRelease(state.release, state.options), state.manifest);
  for (const relative of ['apps/heyvans/src/index.mjs', 'apps/frontoffice/proxy.ts', 'pnpm-workspace.yaml', `db/migrations/${MIGRATIONS[0]}`]) {
    const file = path.join(state.source, relative);
    const previous = await fs.readFile(file).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    await write(state.source, relative, 'source changed after build');
    await assert.rejects(verifyRelease(state.release, state.options), /RELEASE_FINGERPRINT_MISMATCH/, relative);
    if (previous === null) await fs.unlink(file);
    else await fs.writeFile(file, previous);
  }
});

test('verifier detects release build output and dependency changes, including same-size bytes', async (t) => {
  const state = await fakeRelease(t);
  for (const [directory, relative] of [
    [state.release, 'apps/api/dist/main.js'],
    [state.release, 'apps/api/dist/cache/adapter.js'],
    [state.release, 'apps/frontoffice/.next/server/page.js'],
    [state.release, 'apps/frontoffice/.next/server/app/cache/page.js'],
    [state.release, 'apps/admin/dist/index.html'],
    [state.release, 'node_modules/fixture-package/index.js'],
    [state.source, 'apps/api/node_modules/fixture-package/index.js'],
    [state.runtime, 'apps/api/node_modules/fixture-package/index.js'],
    [state.runtime, 'apps/heyvans/public/logo.svg'],
  ]) {
    const file = path.join(directory, relative);
    const previous = await fs.readFile(file);
    const stat = await fs.stat(file);
    await fs.writeFile(file, Buffer.alloc(previous.length, 'x'));
    await fs.utimes(file, stat.atime, stat.mtime);
    await assert.rejects(verifyRelease(state.release, state.options), /RELEASE_FINGERPRINT_MISMATCH/, `${directory}: ${relative}`);
    await fs.writeFile(file, previous);
    await fs.utimes(file, stat.atime, stat.mtime);
  }
});

test('verifier detects live and staged private env changes and ignores only the mutable build cache', async (t) => {
  const state = await fakeRelease(t);
  await write(state.release, 'apps/frontoffice/.next/cache/cache-file', 'mutable cache');
  assert.deepEqual(await verifyRelease(state.release, state.options), state.manifest);
  const original = await fs.readFile(path.join(state.runtime, '.env.local'));
  await write(state.runtime, '.env.local', 'PRIVATE_TOKEN="another-fake-token"\n');
  await assert.rejects(verifyRelease(state.release, state.options), /PRIVATE_ENV_CHANGED/);
  await fs.writeFile(path.join(state.runtime, '.env.local'), original);
  await write(state.release, '.env.local', 'PRIVATE_TOKEN="staged-fake-token"\n');
  await assert.rejects(verifyRelease(state.release, state.options), /RELEASE_PRIVATE_ENV_CHANGED/);
});

test('verifier rejects unexpected hash-map keys, altered managed/migration lists and a symlinked release path', async (t) => {
  const state = await fakeRelease(t);
  for (const key of ['sourceHashes', 'sourceDependencies', 'baseSources', 'baseArtifacts', 'baseDependencies', 'basePublic', 'releaseSources', 'releaseArtifacts', 'releaseDependencies']) {
    state.manifest[key]['unexpected-entry'] = 'fake-hash';
    await state.saveManifest();
    await assert.rejects(verifyRelease(state.release, state.options), /RELEASE_MANIFEST_INVALID/, key);
    delete state.manifest[key]['unexpected-entry'];
  }
  state.manifest.managed = [...MANAGED, 'unexpected-entry'];
  await state.saveManifest();
  await assert.rejects(readManifest(state.release, state.options), /RELEASE_MANIFEST_INVALID/);
  state.manifest.managed = MANAGED;
  state.manifest.migrations = [...MIGRATIONS].reverse();
  await state.saveManifest();
  await assert.rejects(readManifest(state.release, state.options), /RELEASE_MANIFEST_INVALID/);
  state.manifest.migrations = MIGRATIONS;
  await state.saveManifest();
  const alias = path.join(state.root, 'release-alias');
  await fs.symlink(state.release, alias);
  await assert.rejects(readManifest(alias, state.options), /RELEASE_PATH_INVALID/);
});

test('verifier independently requires build markers and an executable launcher', async (t) => {
  const state = await fakeRelease(t);
  await fs.unlink(path.join(state.release, 'apps/api/dist/main.js'));
  state.manifest.releaseArtifacts = await hashPaths(state.release, ARTIFACTS, artifactOptions);
  await assert.rejects(verifyContents(state.release, state.manifest), { code: 'ENOENT' });
  await write(state.release, 'apps/api/dist/main.js', 'compiled API fixture');
  state.manifest.releaseArtifacts = await hashPaths(state.release, ARTIFACTS, artifactOptions);
  await fs.chmod(path.join(state.release, 'vanly'), 0o600);
  state.manifest.releaseSources = await hashPaths(state.release, MANAGED, sourceOptions);
  await assert.rejects(verifyContents(state.release, state.manifest), /RELEASE_LAUNCHER_NOT_EXECUTABLE/);
});

test('verifier rejects readable-to-others or symlinked staged private env even when its recorded hash matches', async (t) => {
  const state = await fakeRelease(t);
  const privateFile = path.join(state.release, '.env.local');
  await fs.chmod(privateFile, 0o644);
  await assert.rejects(verifyContents(state.release, state.manifest), /RELEASE_PRIVATE_ENV_NOT_PROTECTED/);
  await fs.unlink(privateFile);
  await fs.symlink(path.join(state.runtime, '.env.local'), privateFile);
  state.manifest.releaseEnv = await fingerprint(state.release, '.env.local');
  await assert.rejects(verifyContents(state.release, state.manifest), /RELEASE_PRIVATE_ENV_NOT_PROTECTED/);
});

test('managed copying deletes removed code while preserving env/public/private/dependency entries and launcher mode', async (t) => {
  const { root } = await fixture(t);
  const source = path.join(root, 'source'), destination = path.join(root, 'destination');
  await write(source, 'apps/heyvans/src/new.js', 'new code');
  await write(destination, 'apps/heyvans/src/removed.js', 'old code');
  const protectedEntries = ['.env.local', '.env.production', 'public/logo.svg', '.local/private-token', 'node_modules/private-module/index.js'];
  for (const relative of protectedEntries) {
    await write(source, `apps/heyvans/${relative}`, 'source must not overwrite this');
    await write(destination, `apps/heyvans/${relative}`, `preserved ${relative}`);
  }
  await write(source, 'vanly', '#!/bin/sh\nexit 0\n');
  await fs.chmod(path.join(source, 'vanly'), 0o751);
  await copyManaged(source, destination, ['apps/heyvans', 'vanly']);
  assert.equal(await fs.readFile(path.join(destination, 'apps/heyvans/src/new.js'), 'utf8'), 'new code');
  await assert.rejects(fs.access(path.join(destination, 'apps/heyvans/src/removed.js')), { code: 'ENOENT' });
  for (const relative of protectedEntries) assert.equal(await fs.readFile(path.join(destination, `apps/heyvans/${relative}`), 'utf8'), `preserved ${relative}`);
  assert.equal((await fs.stat(path.join(destination, 'vanly'))).mode & 0o777, 0o751);
});

test('managed copying preserves real public directories when staged app public entries are symlinks', async (t) => {
  const { root } = await fixture(t);
  const staged = path.join(root, 'staged'), runtime = path.join(root, 'runtime');
  const apps = ['frontoffice', 'camperfolks', 'heyvans'];
  for (const app of apps) {
    await write(staged, `apps/${app}/src/index.mjs`, `new ${app} code`);
    await write(runtime, `apps/${app}/public/logo.svg`, `original ${app} asset`);
    await write(runtime, `apps/${app}/public/nested/photo.jpg`, `original nested ${app} asset`);
    await fs.symlink(path.join(runtime, `apps/${app}/public`), path.join(staged, `apps/${app}/public`));
  }
  const originals = await hashPaths(runtime, apps.map((app) => `apps/${app}/public`));
  await copyManaged(staged, runtime, apps.map((app) => `apps/${app}`));
  for (const app of apps) {
    const publicDirectory = await fs.lstat(path.join(runtime, `apps/${app}/public`));
    assert.equal(publicDirectory.isDirectory(), true, app);
    assert.equal(publicDirectory.isSymbolicLink(), false, app);
    assert.equal(await fs.readFile(path.join(runtime, `apps/${app}/src/index.mjs`), 'utf8'), `new ${app} code`);
  }
  assert.deepEqual(await hashPaths(runtime, apps.map((app) => `apps/${app}/public`)), originals);
});

test('managed copying protects compiled directories from staged artifact entries that are regular files or symlinks', async (t) => {
  const { root } = await fixture(t);
  const staged = path.join(root, 'staged'), runtime = path.join(root, 'runtime');
  const cases = [
    ['apps/api', 'dist', 'file'],
    ['apps/owner', 'dist', 'symlink'],
    ['apps/frontoffice', '.next', 'file'],
    ['apps/camperfolks', '.next', 'symlink'],
  ];
  for (const [app, artifact, type] of cases) {
    await write(staged, `${app}/src/index.mjs`, 'updated source');
    await write(runtime, `${app}/${artifact}/compiled.js`, `original ${app} compiled content`);
    if (type === 'file') await write(staged, `${app}/${artifact}`, 'staged artifact is a file');
    else await fs.symlink(path.join(runtime, `${app}/${artifact}`), path.join(staged, `${app}/${artifact}`));
  }
  const artifacts = cases.map(([app, artifact]) => `${app}/${artifact}`);
  const originals = await hashPaths(runtime, artifacts);
  await copyManaged(staged, runtime, cases.map(([app]) => app));
  assert.deepEqual(await hashPaths(runtime, artifacts), originals);
  for (const relative of artifacts) assert.equal((await fs.lstat(path.join(runtime, relative))).isDirectory(), true, relative);
});

test('dependency staging uses exact source bytes despite equal runtime cache metadata and includes newly added libraries', async (t) => {
  const { root } = await fixture(t);
  const source = path.join(root, 'source'), runtime = path.join(root, 'runtime'), release = path.join(root, 'release');
  for (const directory of [source, runtime]) for (const entry of DEPENDENCIES) await fs.mkdir(path.join(directory, entry), { recursive: true });
  const cached = 'node_modules/.pnpm/cached@1/node_modules/cached/index.js';
  await write(source, cached, 'source bytes');
  await write(runtime, cached, 'cached bytes');
  const stamp = new Date('2026-10-06T12:00:00Z');
  for (const directory of [source, runtime]) await fs.utimes(path.join(directory, cached), stamp, stamp);
  assert.notEqual(await fingerprint(source, cached, { cacheBase: runtime }), await fingerprint(runtime, cached), 'source hashing must not substitute metadata-matched cached bytes');
  await write(source, 'node_modules/.pnpm/pdfkit@new/node_modules/pdfkit/index.js', 'new library fixture');
  await write(runtime, 'node_modules/obsolete-library/index.js', 'removed library');
  const packageTarget = path.join(source, 'node_modules/.pnpm/pdfkit@new/node_modules/pdfkit');
  for (const link of ['node_modules/pdfkit', 'apps/api/node_modules/pdfkit']) {
    const file = path.join(source, link);
    await fs.symlink(path.relative(path.dirname(file), packageTarget), file);
  }
  await stageDependencies(source, runtime, release);
  assert.equal(await fs.readFile(path.join(release, cached), 'utf8'), 'source bytes');
  assert.equal(await fs.readFile(path.join(release, 'apps/api/node_modules/pdfkit/index.js'), 'utf8'), 'new library fixture');
  await assert.rejects(fs.access(path.join(release, 'node_modules/obsolete-library')), { code: 'ENOENT' });
  assert.deepEqual(await hashPaths(release, DEPENDENCIES), await hashPaths(source, DEPENDENCIES));
  await validateDependencyLinks(release);
});

test('dependency link validation rejects external and missing targets but accepts an internal pnpm link', async (t) => {
  const { root } = await fixture(t);
  const release = path.join(root, 'release');
  for (const entry of DEPENDENCIES) await fs.mkdir(path.join(release, entry), { recursive: true });
  await write(release, 'node_modules/.pnpm/package@1/node_modules/package/index.js', 'internal package');
  const link = path.join(release, 'node_modules/package');
  await fs.symlink('.pnpm/package@1/node_modules/package', link);
  await validateDependencyLinks(release);
  await fs.unlink(link);
  await write(root, 'outside/index.js', 'external package');
  await fs.symlink(path.join(root, 'outside'), link);
  await assert.rejects(validateDependencyLinks(release), /RELEASE_DEPENDENCY_LINK_OUTSIDE/);
  await fs.unlink(link);
  await fs.symlink('.pnpm/missing-package', link);
  await assert.rejects(validateDependencyLinks(release), /RELEASE_DEPENDENCY_LINK_MISSING/);
});

test('temporary backup/install/restore round trip restores exact code, artifacts, dependencies, env and absent paths', async (t) => {
  const state = await fakeRelease(t);
  const { source, runtime, release, manifest } = state;
  const originallyAbsent = ['apps/admin', 'apps/worker', 'packages/documents', 'scripts/panel-server.mjs', '.env.example'];
  for (const relative of originallyAbsent) await fs.rm(path.join(runtime, relative), { recursive: true, force: true });
  await fs.unlink(path.join(runtime, `db/migrations/${MIGRATIONS[0]}`));
  await write(runtime, 'apps/api/src/obsolete.mjs', 'old code removed by release');
  await write(runtime, 'node_modules/obsolete/index.js', 'old dependency removed by release');
  await write(runtime, 'apps/api/dist/obsolete.js', 'old compiled output removed by release');
  await write(runtime, 'apps/frontoffice/.next/cache/state', 'mutable original build cache');
  const protectedEntries = ['.local/private-token', 'apps/heyvans/.env.local', 'apps/heyvans/.env.production', 'apps/heyvans/.local/private-token', 'apps/heyvans/public/logo.svg'];
  for (const relative of protectedEntries) await write(runtime, relative, `private/public original ${relative}`);
  for (const directory of [source, release]) {
    await write(directory, 'apps/api/src/new.mjs', 'new source module');
    await write(directory, 'apps/frontoffice/components/dist/card.mjs', 'source directory named dist');
    await write(directory, 'apps/frontoffice/components/public/card.mjs', 'source directory named public');
    await write(directory, 'node_modules/pdfkit/index.js', 'new PDF dependency fixture');
    await write(directory, 'apps/api/dist/cache/adapter.js', 'updated compiled cache module');
    await write(directory, 'apps/frontoffice/.next/server/app/cache/page.js', 'updated compiled cache route');
    await write(directory, 'apps/heyvans/.env.production', 'must not replace private brand env');
    await write(directory, 'apps/heyvans/public/logo.svg', 'must not replace public assets');
  }
  const originalEnv = await fs.readFile(path.join(runtime, '.env.local'), 'utf8');
  const installedEnv = originalEnv + 'MAIL_FROM="portal@vanly.me"\n';
  await write(release, '.env.local', installedEnv);
  manifest.sourceHashes = await hashPaths(source, MANAGED, sourceOptions);
  manifest.sourceDependencies = await hashPaths(source, DEPENDENCIES);
  manifest.baseSources = await hashPaths(runtime, MANAGED, sourceOptions);
  manifest.baseArtifacts = await hashPaths(runtime, ARTIFACTS, artifactOptions);
  manifest.baseDependencies = await hashPaths(runtime, DEPENDENCIES);
  manifest.basePublic = await hashPaths(runtime, PUBLIC_INPUTS);
  manifest.baseEnv = await fingerprint(runtime, '.env.local');
  manifest.releaseSources = await hashPaths(release, MANAGED, sourceOptions);
  manifest.releaseArtifacts = await hashPaths(release, ARTIFACTS, artifactOptions);
  manifest.releaseDependencies = await hashPaths(release, DEPENDENCIES);
  manifest.releaseEnv = await fingerprint(release, '.env.local');
  await state.saveManifest();
  const originalTreeHash = await fingerprint(runtime, '.');
  const backup = path.join(state.root, 'backup');
  await backupRuntime(backup, { runtime });
  assert.equal((await fs.stat(path.join(backup, 'env.local'))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(backup)).mode & 0o777, 0o700);
  await installRelease(release, state.options);
  assert.deepEqual(await hashPaths(runtime, MANAGED, sourceOptions), manifest.releaseSources);
  assert.deepEqual(await hashPaths(runtime, ARTIFACTS, artifactOptions), manifest.releaseArtifacts);
  assert.deepEqual(await hashPaths(runtime, DEPENDENCIES), manifest.releaseDependencies);
  assert.equal(await fs.readFile(path.join(runtime, '.env.local'), 'utf8'), installedEnv);
  assert.equal((await fs.stat(path.join(runtime, '.env.local'))).mode & 0o777, 0o600);
  assert.equal(await fs.readFile(path.join(runtime, 'apps/frontoffice/.next/cache/state'), 'utf8'), 'mutable original build cache');
  for (const relative of protectedEntries) assert.equal(await fs.readFile(path.join(runtime, relative), 'utf8'), `private/public original ${relative}`, relative);
  for (const relative of ['apps/api/src/obsolete.mjs', 'node_modules/obsolete/index.js', 'apps/api/dist/obsolete.js']) await assert.rejects(fs.access(path.join(runtime, relative)), { code: 'ENOENT' });
  await restoreRuntime(backup, { runtime });
  assert.deepEqual(await hashPaths(runtime, MANAGED, sourceOptions), manifest.baseSources);
  assert.deepEqual(await hashPaths(runtime, ARTIFACTS, artifactOptions), manifest.baseArtifacts);
  assert.deepEqual(await hashPaths(runtime, DEPENDENCIES), manifest.baseDependencies);
  assert.equal(await fs.readFile(path.join(runtime, '.env.local'), 'utf8'), originalEnv);
  for (const relative of originallyAbsent) await assert.rejects(fs.access(path.join(runtime, relative)), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(runtime, `db/migrations/${MIGRATIONS[0]}`)), { code: 'ENOENT' });
  assert.equal(await fingerprint(runtime, '.'), originalTreeHash, 'restore the entire original fixture tree');
});

// The release format predates concurrent traversal. Keep a small sequential
// reference so scheduling changes cannot silently change persisted digests.
async function sequentialFingerprint(base, relative, options = {}) {
  const skip = new Set(options.skip || ['.DS_Store']);
  const file = path.join(base, relative);
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink()) return `link:${await fs.readlink(file)}`;
  if (stat.isFile()) {
    const bytes = await fs.readFile(file);
    return crypto.createHash('sha256').update(`${stat.mode & 0o111}:`).update(bytes).digest('hex');
  }
  assert.ok(stat.isDirectory(), 'the reference corpus contains only files/directories/symlinks');
  const names = (await fs.readdir(file)).filter((name) => !skip.has(name) && !options.ignore?.(name, relative)).sort();
  const entries = [];
  for (const name of names) entries.push([name, await sequentialFingerprint(base, path.join(relative, name), options)]);
  return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

test('concurrent fingerprints retain sequential release digests for nested, empty, binary, executable and symlink entries', async (t) => {
  const { root } = await fixture(t);
  await fs.mkdir(path.join(root, 'tree/empty'), { recursive: true });
  await write(root, 'tree/nested/leaf/normal.mjs', 'ordinary content');
  await write(root, 'tree/nested/leaf/hidden.mjs', 'excluded only by its parent');
  await write(root, 'tree/hidden.mjs', 'included at another parent');
  await write(root, 'tree/nested/leaf/binary.bin', Buffer.from([0, 255, 128, 10, 34]));
  await write(root, 'tree/nested/leaf/run.sh', '#!/bin/sh\nexit 0\n');
  await fs.chmod(path.join(root, 'tree/nested/leaf/run.sh'), 0o751);
  await write(root, 'tree/nested/omit/data.mjs', 'custom skip directory');
  await write(root, 'tree/.DS_Store', 'ignored finder metadata');
  await write(root, 'tree/nested/leaf/.DS_Store', 'nested ignored metadata');
  await fs.symlink('nested/leaf/normal.mjs', path.join(root, 'tree/internal-link'));
  await fs.symlink('does-not-exist', path.join(root, 'tree/dangling-link'));
  await fs.symlink('cycle-b', path.join(root, 'tree/cycle-a'));
  await fs.symlink('cycle-a', path.join(root, 'tree/cycle-b'));
  await write(root, 'apps/frontoffice/components/public/card.mjs', 'source public directory');
  await write(root, 'apps/frontoffice/components/dist/card.mjs', 'source dist directory');
  await write(root, 'apps/frontoffice/public/logo.svg', 'protected public asset');
  await write(root, 'apps/frontoffice/node_modules/pkg/index.mjs', 'dependency excluded from source');
  await write(root, 'apps/frontoffice/.env.local', 'PRIVATE_TOKEN="fake-only"');
  await write(root, 'apps/frontoffice/.next/cache/build-cache', 'mutable build cache');
  await write(root, 'apps/frontoffice/.next/server/app/cache/page.js', 'compiled cache route');
  await write(root, 'apps/api/dist/cache/adapter.js', 'compiled cache adapter');
  const cases = [
    ['tree', {}],
    ['tree/empty', {}],
    ['tree/nested/leaf/run.sh', {}],
    ['tree/internal-link', {}],
    ['missing-entry', {}],
    ['tree', { skip: ['.DS_Store', 'omit'], ignore: (name, parent) => name === 'hidden.mjs' && parent === 'tree/nested/leaf' }],
    ['apps/frontoffice', sourceOptions],
    ['apps/frontoffice/.next', artifactOptions],
    ['apps/api/dist', artifactOptions],
  ];
  const expected = [];
  for (const [relative, options] of cases) expected.push(await sequentialFingerprint(root, relative, options));
  const actual = await Promise.all(cases.map(([relative, options]) => fingerprint(root, relative, options)));
  assert.deepEqual(actual, expected);
  for (const [relative, options] of cases) assert.equal(await fingerprint(root, relative, options), await sequentialFingerprint(root, relative, options), relative);
});

test('parallel fingerprint calls share a global bound at the filesystem I/O boundary', { timeout: 10000 }, async (t) => {
  const { root } = await fixture(t);
  for (let index = 0; index < 96; index++) await write(root, `many/group-${index % 8}/file-${index}.mjs`, `content ${index}`);
  const expected = await sequentialFingerprint(root, 'many');
  const operations = ['lstat', 'readdir', 'readFile', 'readlink'];
  const originals = Object.fromEntries(operations.map((operation) => [operation, fs[operation]]));
  let active = 0, maximum = 0, observed = 0;
  for (const operation of operations) {
    fs[operation] = async (...args) => {
      active++;
      observed++;
      maximum = Math.max(maximum, active);
      try {
        // Delay only test fixture reads to expose overlap; no production hook.
        await new Promise((resolve) => setTimeout(resolve, 2));
        return await originals[operation](...args);
      } finally {
        active--;
      }
    };
  }
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => fingerprint(root, 'many')));
    assert.deepEqual(results, Array(8).fill(expected));
    assert.ok(observed > 96, 'observe filesystem operations from multiple traversals');
    assert.ok(maximum > 1, 'concurrent traversal should overlap I/O');
    assert.ok(maximum <= FINGERPRINT_CONCURRENCY, `global active I/O ${maximum} exceeded ${FINGERPRINT_CONCURRENCY}`);
    assert.equal(FINGERPRINT_CONCURRENCY, 32);
  } finally {
    for (const operation of operations) fs[operation] = originals[operation];
  }
  assert.equal(active, 0);
});
