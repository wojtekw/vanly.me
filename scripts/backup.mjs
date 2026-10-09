import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });
const conn = new URL(process.env.DATABASE_URL);
if (conn.pathname !== '/vanly_local') throw Error('Kopia dotyczy wyłącznie bazy vanly_local.');
const folder = path.join(root, '.local/backups', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(folder, { recursive: true, mode: 0o700 });
const env = {
  ...process.env,
  PGHOST: conn.hostname,
  PGPORT: conn.port,
  PGUSER: decodeURIComponent(conn.username),
  PGPASSWORD: decodeURIComponent(conn.password),
  PGDATABASE: conn.pathname.slice(1),
};
execFileSync(
  '/opt/homebrew/opt/postgresql@16/bin/pg_dump',
  ['--format=custom', '--file=' + path.join(folder, 'database.dump')],
  { env, stdio: 'pipe' },
);
execFileSync('/usr/bin/tar', [
  '-czf',
  path.join(folder, 'uploads.tar.gz'),
  '-C',
  path.join(root, '.local'),
  'uploads',
]);
const files = execFileSync(
  '/opt/homebrew/opt/postgresql@16/bin/pg_restore',
  ['--list', path.join(folder, 'database.dump')],
  { encoding: 'utf8' },
);
if (!files.includes('bookings')) throw Error('Niepełna kopia bazy.');
await fs.writeFile(
  path.join(folder, 'backup.json'),
  JSON.stringify(
    {
      created: new Date().toISOString(),
      database: conn.pathname.slice(1),
      contains: ['database.dump', 'uploads.tar.gz'],
      version: '0.1.0',
    },
    null,
    2,
  ),
);
await fs.chmod(path.join(folder, 'database.dump'), 0o600);
await fs.chmod(path.join(folder, 'uploads.tar.gz'), 0o600);
console.log('Kopia gotowa: ' + folder);
