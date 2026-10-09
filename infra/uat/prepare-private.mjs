import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { loadMailerConfig } from '../../packages/mailer/index.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const target = path.join(root, '.local/uat');
const local = dotenv.parse(await fs.readFile('/Users/wojtek/.local/share/vanly-portal/.env.local'));
const example = dotenv.parse(await fs.readFile(path.join(import.meta.dirname, 'runtime.env.example')));
let previous = {};
try { previous = dotenv.parse(await fs.readFile(path.join(target, 'runtime.env'))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const password = previous.DATABASE_URL ? new URL(previous.DATABASE_URL).password : crypto.randomBytes(30).toString('base64url');
const env = { ...example, DATABASE_URL: `postgres://vanly_app:${password}@127.0.0.1:5432/vanly_uat` };
for (const [key, value] of Object.entries(local)) {
  if (key.startsWith('GOOGLE_MAPS_') || key.startsWith('GOOGLE_PLACES_') ||
      key.startsWith('MAIL_SENDER_LEGAL_') || key === 'MAIL_SENDER_REGISTRATION_DETAILS' ||
      ['MAIL_FROM', 'MAIL_FROM_NO_REPLY', 'MAIL_FROM_PORTAL', 'MAIL_REPLY_TO', 'MAIL_AWS_REGION', 'MAIL_SES_CONFIGURATION_SET'].includes(key))
    env[key] = value;
}
Object.assign(env, {
  MAIL_PROVIDER: 'ses', MAIL_SES_ENABLED: 'true', AWS_PROFILE: 'vanly-mailer-test',
  AWS_SHARED_CREDENTIALS_FILE: '/run/vanly/aws-credentials', AWS_CONFIG_FILE: '/run/vanly/aws-config',
  MAIL_SES_START_AFTER: previous.MAIL_SES_START_AFTER || new Date().toISOString(),
  MAIL_FEEDBACK_ENABLED: 'false', MAIL_REMINDERS_ENABLED: 'false', MAIL_NEWSLETTER_ENABLED: 'false',
});
loadMailerConfig(env);
if (env.GOOGLE_MAPS_ENABLED !== 'true' || !env.GOOGLE_MAPS_BROWSER_KEY || env.GOOGLE_MAPS_QUOTAS_CONFIRMED !== 'true')
  throw Error('Active map integration with confirmed quotas is required');
const write = async (name, content) => {
  await fs.writeFile(path.join(target, name), content, { mode: 0o600 });
  await fs.chmod(path.join(target, name), 0o600);
};
const serialize = values => Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
await fs.mkdir(target, { recursive: true, mode: 0o700 });
await write('runtime.env', serialize(env));
// Docker Compose env_file does not remove JSON quotes consistently across all
// versions; this DB password is alphanumeric and needs no escaping.
await write('db.env', `POSTGRES_DB=vanly_uat\nPOSTGRES_USER=vanly_app\nPOSTGRES_PASSWORD=${password}\n`);
const credentials = await fs.readFile(path.join(process.env.HOME, '.aws/credentials'), 'utf8');
const section = credentials.split(/(?=^\[)/m).find(section => section.startsWith('[vanly-mailer-test]'));
if (!section || !/^aws_access_key_id\s*=/m.test(section) || !/^aws_secret_access_key\s*=/m.test(section))
  throw Error('The existing restricted mail test profile is unavailable');
await write('aws-credentials', section.trim() + '\n');
await write('aws-config', '[profile vanly-mailer-test]\nregion = eu-central-1\n');
console.log(JSON.stringify({ prepared: true, origin: env.APP_ORIGIN, mail: 'SES test recipient + private inbox', maps: 'enabled with existing quotas' }));
