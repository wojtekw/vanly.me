import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });
const connection = new URL(process.env.DATABASE_URL);
if (
  !['127.0.0.1', 'localhost'].includes(connection.hostname) ||
  connection.pathname !== '/vanly_local'
)
  throw new Error('Import is limited to the local Vanly database.');

const guides = JSON.parse(await fs.readFile(path.join(root, 'db/guides.json'), 'utf8'));
if (guides.length !== 20 || new Set(guides.map((a) => a.id)).size !== 20)
  throw new Error('Expected 20 distinct guides.');
for (const a of guides) {
  if (a.kind !== 'guide' || !a.title || a.desc.length > 500 || a.body.length !== 6)
    throw new Error('Invalid guide: ' + a.id);
  for (const [h, p] of a.body)
    if (h.length > 150 || p.length > 3000) throw new Error('Editor limit: ' + a.id);
  await fs.access(path.join(root, 'apps/frontoffice/public/assets', a.asset));
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query('BEGIN');
  await db.query('LOCK TABLE articles IN SHARE ROW EXCLUSIVE MODE');
  const { rows: before } = await db.query('SELECT * FROM articles WHERE id = ANY($1::text[])', [
    guides.map((a) => a.id),
  ]);
  if (before.some((a) => a.kind !== 'guide'))
    throw new Error('Refusing to overwrite an inspiration.');
  const backup = path.join(
    root,
    '.local/backups',
    'guides-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json',
  );
  await fs.mkdir(path.dirname(backup), { recursive: true, mode: 0o700 });
  await fs.writeFile(
    backup,
    JSON.stringify({ before, importedIds: guides.map((a) => a.id) }, null, 2),
    { mode: 0o600 },
  );
  for (const a of guides)
    await db.query(
      `INSERT INTO articles(id,title,kind,summary,body,asset,published)
       VALUES($1,$2,'guide',$3,$4,$5,true)
       ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,
       body=EXCLUDED.body,asset=EXCLUDED.asset,published=true,updated_at=now()`,
      [a.id, a.title, a.desc, JSON.stringify(a.body), a.asset],
    );
  await db.query('COMMIT');
  console.log('Published 20 guides in vanly_local. Prior article data: ' + backup);
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally {
  await db.end();
}
