import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadMailerConfig } from '../packages/mailer/config.mjs';
import { loadNotificationConfig } from './worker/reminders/config.mjs';
import dotenv from 'dotenv';

// Match dotenv spans, including exported and quoted multiline assignments.
const assignments = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg;

export async function configureMailerLocal(file, { now = new Date(), replyTo, testRecipient, testSesProfile } = {}) {
  if (!file || path.basename(file) !== '.env.local') throw Error('PRIVATE_ENV_PATH_REQUIRED');
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('PRIVATE_ENV_REGULAR_FILE_REQUIRED');
  const original = await fs.readFile(file, 'utf8');
  const content = original.replace(/\r\n?/g, '\n');
  const current = dotenv.parse(content);
  const defaults = {
    MAIL_PROVIDER: 'local', MAIL_SES_ENABLED: 'false', MAIL_FEEDBACK_ENABLED: 'false',
    MAIL_DEPLOYMENT_ENVIRONMENT: 'local', MAIL_TEST_MODE: 'false', MAIL_TEST_RECIPIENT: '',
    MAIL_FROM: 'portal@vanly.me', MAIL_FROM_NO_REPLY: 'no-reply@vanly.me', MAIL_FROM_PORTAL: 'portal@vanly.me', MAIL_REPLY_TO: 'info@wydmuch.xyz',
    MAIL_SENDER_LEGAL_NAME: 'Wojciech Wydmuch Sales&Product Consulting',
    MAIL_SENDER_LEGAL_ADDRESS: 'ul. Janki Bryla 18/4, 81-577 Gdynia', MAIL_SENDER_REGISTRATION_DETAILS: 'NIP 6342487971 · REGON 241930650',
    APP_URL: current.APP_ORIGIN || 'https://vanly.me.local',
    MAIL_REMINDERS_ENABLED: 'true', NOTIFICATION_START_AFTER: now.toISOString(), MAIL_NEWSLETTER_ENABLED: 'false',
    MAIL_REMINDERS_SEND_HOUR: '9', MAIL_UNREAD_DELAY_MINUTES: '5', MAIL_UNREAD_COOLDOWN_HOURS: '12',
  };
  const overrideReplyTo = replyTo !== undefined;
  const overrideTestRecipient = testRecipient !== undefined;
  const overrideTestSesProfile = testSesProfile !== undefined;
  if (overrideTestSesProfile && (typeof testSesProfile !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(testSesProfile))) throw Error('INVALID_MAIL_TEST_SES_PROFILE');
  // Refuse to relabel an explicitly production configuration as local.
  if ((overrideTestRecipient || overrideTestSesProfile) && current.MAIL_DEPLOYMENT_ENVIRONMENT === 'production') throw Error('MAIL_TEST_MODE_REQUIRES_LOCAL_ENVIRONMENT');
  const overrides = {
    ...(overrideReplyTo ? { MAIL_REPLY_TO: replyTo } : {}),
    ...(overrideTestRecipient ? { MAIL_DEPLOYMENT_ENVIRONMENT: 'local', MAIL_TEST_MODE: 'true', MAIL_TEST_RECIPIENT: testRecipient } : {}),
  };
  if (overrideTestSesProfile) {
    const routing = { ...defaults, ...current, ...overrides };
    if (routing.MAIL_DEPLOYMENT_ENVIRONMENT !== 'local' || routing.MAIL_TEST_MODE !== 'true') throw Error('MAIL_TEST_SES_REQUIRES_TEST_ROUTING');
    Object.assign(overrides, {
      MAIL_PROVIDER: 'ses', MAIL_SES_ENABLED: 'true', MAIL_SES_START_AFTER: now.toISOString(),
      AWS_PROFILE: testSesProfile, MAIL_AWS_REGION: 'eu-central-1', MAIL_SES_CONFIGURATION_SET: 'vanly-transactional',
      MAIL_BATCH_SIZE: '1', MAIL_POLL_MS: '1000',
    });
  }
  const expected = { ...defaults, ...current, ...overrides };
  const mailer = loadMailerConfig(expected);
  // The local provider has a fallback for blank addresses; an explicit override
  // must itself be the validated address, including for the local provider.
  if (overrideReplyTo && mailer.replyTo !== replyTo) throw Error('INVALID_MAIL_REPLY_TO');
  loadNotificationConfig(expected);
  const matches = [...content.matchAll(assignments)];
  const last = new Map(matches.map(match => [match[1], match.index]));
  // Retain the last complete original assignment; do not reserialize secrets.
  let configured = content.replace(assignments, (span, key, _value, offset) => {
    if (last.get(key) !== offset) return '';
    return Object.hasOwn(overrides, key) ? key + '=' + JSON.stringify(overrides[key]) + '\n' : span;
  });
  for (const key of Object.keys(expected)) if (!Object.hasOwn(current, key)) configured = configured.trimEnd() + '\n' + key + '=' + JSON.stringify(expected[key]) + '\n';
  const parsed = dotenv.parse(configured);
  if (Object.keys(expected).some(key => parsed[key] !== expected[key]) || Object.keys(parsed).some(key => !Object.hasOwn(expected, key))) throw Error('PRIVATE_ENV_CANONICALIZATION_FAILED');
  const temp = path.join(path.dirname(file), '.env.local.tmp-' + crypto.randomUUID());
  try {
    await fs.writeFile(temp, configured, { mode: 0o600, flag: 'wx' });
    if (await fs.readFile(file, 'utf8') !== original) throw Error('PRIVATE_ENV_CHANGED');
    await fs.rename(temp, file); await fs.chmod(file, 0o600);
  } finally { await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  return { configured: true };
}

function parseArguments(args) {
  const [file, ...remaining] = args;
  const options = {};
  for (let index = 0; index < remaining.length; index += 1) {
    const argument = remaining[index];
    if (argument === '--test-recipient' || argument === '--test-ses-profile') {
      const key = argument === '--test-recipient' ? 'testRecipient' : 'testSesProfile';
      if (Object.hasOwn(options, key) || index + 1 >= remaining.length) throw Error('INVALID_MAIL_CONFIGURATION_ARGUMENTS');
      options[key] = remaining[++index];
    } else if (argument.startsWith('--') || Object.hasOwn(options, 'replyTo')) {
      throw Error('INVALID_MAIL_CONFIGURATION_ARGUMENTS');
    } else {
      options.replyTo = argument;
    }
  }
  return { file, options };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const { file, options } = parseArguments(process.argv.slice(2)); await configureMailerLocal(file, options); console.log(options.testSesProfile === undefined ? 'Konfiguracja sprawdzona; istniejący transport i prywatne ustawienia zachowane.' : 'Konfiguracja sprawdzona; SES włączony wyłącznie dla lokalnego kierowania testowego.'); }
  catch (error) { console.error(/^[A-Z0-9_]+$/.test(error.code || error.message) ? error.code || error.message : 'MAIL_CONFIGURATION_FAILED'); process.exitCode = 1; }
}
