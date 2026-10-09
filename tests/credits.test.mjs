import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';
import {
  monthAnniversary,
  lockWallet,
  registerPublication,
  publishVehicle,
  stopPublication,
  purchaseCredits,
  renewPublications,
  grantDemoPublications,
} from '../packages/credits/service.mjs';
dotenv.config({ path: '.env.local', quiet: true });
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/vanly_test')
  throw Error('Only isolated vanly_test is permitted');
const schema = 'credits_' + crypto.randomBytes(8).toString('hex');
const scoped = new URL(url);
scoped.searchParams.set('options', '-c search_path=' + schema + ',public');
const admin = new pg.Pool({ connectionString: url });
const pool = new pg.Pool({ connectionString: scoped.toString() });
const start = new Date('2024-01-31T12:15:00Z');
async function transaction(fn) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const value = await fn(db);
    await db.query('COMMIT');
    return value;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
async function fixture(count, credits = 50, { publish = true } = {}) {
  await pool.query(
    "INSERT INTO companies(id,name,verified) VALUES('credit-company','Credits test',true)",
  );
  await transaction(async (db) => {
    const wallet = await lockWallet(db, 'credit-company');
    if (credits) await purchaseCredits(db, wallet, credits, { eventKey: crypto.randomUUID() });
    for (let i = 0; i <= count; i++) {
      const id = 'credit-van-' + String(i).padStart(3, '0');
      await db.query(
        "INSERT INTO vehicles(id,company_id,name,type,asset,city,seats,sleeps,daily,deposit,status) VALUES($1,'credit-company',$1,'trailer','trailer.svg','Gdańsk',4,4,50000,100000,'draft')",
        [id],
      );
      await registerPublication(db, wallet, id, i === 0);
      if (publish || i === 0) await publishVehicle(db, wallet, id, { now: start });
    }
  });
}
const balance = async () =>
  (await pool.query("SELECT balance FROM credit_wallets WHERE company_id='credit-company'")).rows[0]
    .balance;
const publish = async (id, now = start) =>
  transaction(async (db) =>
    publishVehicle(db, await lockWallet(db, 'credit-company'), id, { now }),
  );
async function fund(credits) {
  return transaction(async (db) =>
    purchaseCredits(db, await lockWallet(db, 'credit-company'), credits, {
      eventKey: crypto.randomUUID(),
    }),
  );
}
before(async () => {
  await admin.query('CREATE SCHEMA ' + schema);
  for (const name of (await fs.readdir('db/migrations')).sort())
    if (name.endsWith('.sql')) await pool.query(await fs.readFile('db/migrations/' + name, 'utf8'));
});
beforeEach(async () => {
  await pool.query('TRUNCATE companies,users RESTART IDENTITY CASCADE');
});
after(async () => {
  await pool.end();
  await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
  await admin.end();
});

test('calendar months preserve original day, leap February and the time', () => {
  assert.equal(monthAnniversary(start, 1).toISOString(), '2024-02-29T12:15:00.000Z');
  assert.equal(monthAnniversary(start, 2).toISOString(), '2024-03-31T12:15:00.000Z');
  assert.equal(
    monthAnniversary('2025-01-31T23:59:59Z', 1).toISOString(),
    '2025-02-28T23:59:59.000Z',
  );
  assert.equal(
    monthAnniversary('2025-12-31T23:59:59Z', 2).toISOString(),
    '2026-02-28T23:59:59.000Z',
  );
});
test('50 Credits cover 50 months of one paid vehicle plus the permanently free first vehicle', async () => {
  await fixture(1);
  for (let month = 1; month < 50; month++) {
    const r = await renewPublications(pool, { now: monthAnniversary(start, month) });
    assert.equal(r.renewed, 1);
  }
  assert.equal(await balance(), 0);
  const results = await Promise.all([
    renewPublications(pool, { now: monthAnniversary(start, 50) }),
    renewPublications(pool, { now: monthAnniversary(start, 50) }),
  ]);
  assert.equal(
    results.reduce((n, r) => n + r.hidden, 0),
    1,
  );
  assert.deepEqual(
    (await pool.query('SELECT status FROM vehicles ORDER BY id')).rows.map((v) => v.status),
    ['published', 'hidden'],
  );
  assert.equal(
    (await pool.query('SELECT count(*)::int n FROM credit_ledger WHERE credits=-1')).rows[0].n,
    50,
  );
});
test('50 Credits cover two months of 25 paid vehicles; concurrent renewals charge each once', async () => {
  await fixture(25);
  assert.equal(await balance(), 25);
  const results = await Promise.all(
    Array.from({ length: 4 }, () => renewPublications(pool, { now: monthAnniversary(start, 1) })),
  );
  assert.equal(
    results.reduce((n, r) => n + r.renewed, 0),
    25,
  );
  assert.equal(await balance(), 0);
  assert.equal((await renewPublications(pool, { now: monthAnniversary(start, 2) })).hidden, 25);
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM vehicles WHERE status='published'")).rows[0].n,
    1,
  );
});
test('50 paid vehicles consume exactly 50 Credits for one month', async () => {
  await fixture(50);
  assert.equal(await balance(), 0);
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM vehicles WHERE status='published'")).rows[0].n,
    51,
  );
  assert.equal((await renewPublications(pool, { now: monthAnniversary(start, 1) })).hidden, 50);
});
test('simultaneous publication with a single Credit cannot overdraw, and retry does not charge twice', async () => {
  await fixture(2, 1, { publish: false });
  const results = await Promise.allSettled([publish('credit-van-001'), publish('credit-van-002')]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  assert.equal(await balance(), 0);
  const winner = (
    await pool.query("SELECT id FROM vehicles WHERE status='published' AND id<>'credit-van-000'")
  ).rows[0].id;
  await publish(winner);
  assert.equal(await balance(), 0);
});
test('manual hiding preserves paid period, stops renewal and remains hidden after top-up', async () => {
  await fixture(1, 2);
  const original = (
    await pool.query(
      "SELECT valid_until FROM vehicle_publications WHERE vehicle_id='credit-van-001'",
    )
  ).rows[0].valid_until.toISOString();
  await transaction(async (db) => {
    await lockWallet(db, 'credit-company');
    await stopPublication(db, 'credit-company', 'credit-van-001');
    await db.query("UPDATE vehicles SET status='hidden' WHERE id='credit-van-001'");
  });
  await publish('credit-van-001', new Date('2024-02-10T12:00:00Z'));
  assert.equal(await balance(), 1);
  assert.equal(
    (
      await pool.query(
        "SELECT valid_until FROM vehicle_publications WHERE vehicle_id='credit-van-001'",
      )
    ).rows[0].valid_until.toISOString(),
    original,
  );
  await transaction(async (db) => {
    await lockWallet(db, 'credit-company');
    await stopPublication(db, 'credit-company', 'credit-van-001');
    await db.query("UPDATE vehicles SET status='hidden' WHERE id='credit-van-001'");
  });
  await fund(3);
  await renewPublications(pool, { now: monthAnniversary(start, 3) });
  assert.equal(await balance(), 4);
  assert.equal(
    (await pool.query("SELECT status FROM vehicles WHERE id='credit-van-001'")).rows[0].status,
    'hidden',
  );
});
test('empty wallet hides expired offer; top-up resumes a new month without backdated charges', async () => {
  await fixture(1, 1);
  const expiration = monthAnniversary(start, 1);
  await renewPublications(pool, { now: expiration });
  assert.equal(await balance(), 0);
  await fund(2);
  const resume = new Date('2024-06-10T12:00:00Z');
  await renewPublications(pool, { now: resume });
  assert.equal(await balance(), 1);
  const term = (
    await pool.query("SELECT * FROM vehicle_publications WHERE vehicle_id='credit-van-001'")
  ).rows[0];
  assert.equal(term.anchor_at.toISOString(), resume.toISOString());
  assert.equal(term.valid_until.toISOString(), '2024-07-10T12:00:00.000Z');
  assert.equal(term.paused_for_credits, false);
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM credit_ledger WHERE kind='renewal'")).rows[0].n,
    1,
  );
});
test('missed worker months are not charged and funded companies are not starved by empty paused wallets', async () => {
  await fixture(1, 3);
  await renewPublications(pool, { now: new Date('2024-07-01T00:00:00Z') });
  assert.equal(await balance(), 1);
  const term = (
    await pool.query(
      "SELECT valid_until FROM vehicle_publications WHERE vehicle_id='credit-van-001'",
    )
  ).rows[0];
  assert.equal(term.valid_until.toISOString(), '2024-08-01T00:00:00.000Z');
  await pool.query("INSERT INTO companies(id,name,verified) VALUES('aaa-empty','Empty',true)");
  await pool.query("INSERT INTO credit_wallets(company_id) VALUES('aaa-empty')");
  await pool.query(
    "INSERT INTO vehicles(id,company_id,name,type,asset,city,seats,sleeps,daily,deposit,status) VALUES('aaa-van','aaa-empty','Hidden','trailer','trailer.svg','Łódź',4,4,50000,100000,'hidden')",
  );
  await pool.query(
    "INSERT INTO vehicle_publications(vehicle_id,company_id,anchor_at,months,valid_until,auto_renew,paused_for_credits) VALUES('aaa-van','aaa-empty',$1,1,$2,true,true)",
    [start, monthAnniversary(start, 1)],
  );
  assert.equal(
    (await renewPublications(pool, { now: new Date('2024-08-01T00:00:00Z'), limit: 1 })).renewed,
    1,
  );
});
test('unverified company cannot consume Credits to publish or renew; append-only history and scope are enforced', async () => {
  await fixture(1, 2);
  await pool.query("UPDATE companies SET verified=false WHERE id='credit-company'");
  await assert.rejects(() => publish('credit-van-001'), /weryfikację/);
  await renewPublications(pool, { now: monthAnniversary(start, 1) });
  assert.equal(await balance(), 1);
  await assert.rejects(() => pool.query('UPDATE credit_ledger SET credits=50'), /append-only/);
  await assert.rejects(
    () => pool.query("UPDATE credit_wallets SET balance=-1 WHERE company_id='credit-company'"),
    /check constraint/,
  );
});
test('demo initializer never extends existing periods on rerun or grants another free slot', async () => {
  await fixture(1, 1);
  const until = (
    await pool.query('SELECT valid_until FROM vehicle_publications ORDER BY vehicle_id')
  ).rows;
  await transaction((db) =>
    grantDemoPublications(db, ['credit-van-000', 'credit-van-001'], {
      now: new Date('2026-01-01T00:00:00Z'),
    }),
  );
  assert.deepEqual(
    (await pool.query('SELECT valid_until FROM vehicle_publications ORDER BY vehicle_id')).rows,
    until,
  );
  assert.equal(await balance(), 0);
});

test('Credits migration preserves the old fleet and fee history, granting one month only to published paid slots', async () => {
  const oldSchema = 'credits_migration_' + crypto.randomBytes(8).toString('hex');
  const oldUrl = new URL(url);
  oldUrl.searchParams.set('options', '-c search_path=' + oldSchema + ',public');
  const old = new pg.Client({ connectionString: oldUrl.toString() });
  await admin.query('CREATE SCHEMA ' + oldSchema);
  await old.connect();
  try {
    for (const name of (await fs.readdir('db/migrations')).sort())
      if (name.endsWith('.sql') && name < '017')
        await old.query(await fs.readFile('db/migrations/' + name, 'utf8'));
    await old.query("INSERT INTO companies(id,name,verified) VALUES('legacy','Legacy',true)");
    await old.query(`INSERT INTO vehicles(id,company_id,name,type,asset,city,seats,sleeps,daily,deposit,status,created_at) VALUES
     ('legacy-first','legacy','First','camper','camper.svg','Gdańsk',4,4,50000,100000,'hidden','2025-01-01'),
     ('legacy-published','legacy','Published','trailer','trailer.svg','Gdańsk',4,4,50000,100000,'published','2025-01-02'),
     ('legacy-draft','legacy','Draft','camper','camper.svg','Gdańsk',4,4,50000,100000,'draft','2025-01-03')`);
    await old.query(
      "INSERT INTO vehicle_listing_fees(vehicle_id,company_id,amount_minor,status,reason) VALUES('legacy-published','legacy',20000,'pending','additional_vehicle')",
    );
    const vehicles = (await old.query('SELECT * FROM vehicles ORDER BY id')).rows,
      fees = (await old.query('SELECT * FROM vehicle_listing_fees')).rows;
    await old.query(await fs.readFile('db/migrations/017_credit_wallets.sql', 'utf8'));
    assert.deepEqual((await old.query('SELECT * FROM vehicles ORDER BY id')).rows, vehicles);
    assert.deepEqual((await old.query('SELECT * FROM vehicle_listing_fees')).rows, fees);
    assert.equal((await old.query('SELECT balance FROM credit_wallets')).rows[0].balance, 0);
    const periods = (await old.query('SELECT * FROM vehicle_publications ORDER BY vehicle_id'))
      .rows;
    assert.equal(periods.find((p) => p.vehicle_id === 'legacy-first').exempt, true);
    assert.equal(periods.find((p) => p.vehicle_id === 'legacy-published').months, 1);
    assert.equal(periods.find((p) => p.vehicle_id === 'legacy-draft').valid_until, null);
    assert.deepEqual(
      (await old.query('SELECT kind,credits,balance_after FROM credit_ledger ORDER BY sequence'))
        .rows,
      [
        { kind: 'migration_grant', credits: 1, balance_after: 1 },
        { kind: 'publication', credits: -1, balance_after: 0 },
      ],
    );
  } finally {
    await old.end();
    await admin.query('DROP SCHEMA ' + oldSchema + ' CASCADE');
  }
});
