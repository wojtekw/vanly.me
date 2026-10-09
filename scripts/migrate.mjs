import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query('SELECT pg_advisory_lock(822319)');
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const name of (await fs.readdir(path.join(root, 'db/migrations'))).sort()) {
    if (
      !name.endsWith('.sql') ||
      (await db.query('select 1 from schema_migrations where name=$1', [name])).rowCount
    )
      continue;
    await db.query('BEGIN');
    try {
      await db.query(await fs.readFile(path.join(root, 'db/migrations', name), 'utf8'));
      await db.query('insert into schema_migrations(name) values($1)', [name]);
      await db.query('COMMIT');
      console.log('Applied', name);
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
  }
} finally {
  await db.query('SELECT pg_advisory_unlock(822319)');
  await db.end();
}
