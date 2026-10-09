import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config({ path: '.env.local', quiet: true });
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/vanly_test') throw Error('Only vanly_test is allowed.');
const db = new pg.Pool({ connectionString: url });
const fakeKey = 'AIza' + 'x'.repeat(35);
const base = 'http://127.0.0.1:4102/api/v1/maps';
const env = {
  ...process.env,
  DATABASE_URL: url,
  API_PORT: '4102',
  APP_ORIGIN: 'http://vanly.local',
  GOOGLE_MAPS_BROWSER_KEY: fakeKey,
  GOOGLE_MAPS_ENABLED: 'true',
  GOOGLE_MAPS_QUOTAS_CONFIRMED: 'true',
  GOOGLE_MAPS_DAILY_LOADS: '3',
  GOOGLE_MAPS_MONTHLY_LOADS: '4',
  GOOGLE_PLACES_DAILY_QUERIES: '3',
  GOOGLE_PLACES_MONTHLY_QUERIES: '4',
};
let server;
async function request(operation, origin = 'http://vanly.local') {
  const r = await fetch(base + '/permit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin },
    body: JSON.stringify({ operation }),
  });
  return { status: r.status, data: await r.json() };
}
async function start(overrides = {}) {
  server = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env: { ...env, ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => {
    log += d;
  });
  server.stderr.on('data', (d) => {
    log += d;
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/status')).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(log);
}
async function stop() {
  const exited = once(server, 'exit');
  server.kill('SIGTERM');
  await exited;
}
const day = new Date().toISOString().slice(0, 10),
  month = day.slice(0, 7);
test('Google Maps activation and transactional usage limits (no requests to Google)', async (t) => {
  execFileSync(process.execPath, ['scripts/migrate.mjs'], { env, stdio: 'pipe' });
  try {
    await db.query('TRUNCATE maps_usage');
    await start({ GOOGLE_MAPS_QUOTAS_CONFIRMED: 'false' });
    await t.test(
      'activation requires provider quotas; no browser key and no usage when disabled',
      async () => {
        const data = await (await fetch(base + '/status')).json();
        assert.deepEqual(data, { enabled: false, available: false });
        assert.equal((await request('map')).status, 503);
        assert.equal((await db.query('SELECT * FROM maps_usage')).rowCount, 0);
      },
    );
    await stop();
    await start();
    await t.test('only same-origin, valid operations can consume an allowance', async () => {
      assert.equal((await request('map', 'https://external.example')).status, 403);
      assert.equal((await request('unknown')).status, 400);
      const data = await (await fetch(base + '/status')).json();
      assert.deepEqual(data, { enabled: true, available: true });
      assert.equal((await db.query('SELECT * FROM maps_usage')).rowCount, 0);
    });
    await t.test('parallel map loads cannot exceed the daily allowance', async () => {
      const r = await Promise.all(Array.from({ length: 12 }, () => request('map')));
      assert.equal(r.filter((x) => x.status === 201).length, 3);
      assert.equal(r.filter((x) => x.status === 429).length, 9);
      assert.equal(r.find((x) => x.status === 201).data.browserKey, fakeKey);
      for (const row of (await db.query("SELECT requests FROM maps_usage WHERE kind='map'")).rows)
        assert.equal(row.requests, 3);
    });
    await t.test(
      'search and details share one counter; map usage remains independent',
      async () => {
        const r = await Promise.all(
          ['search', 'details', 'search', 'details', 'search', 'details'].map((op) => request(op)),
        );
        assert.equal(r.filter((x) => x.status === 201).length, 3);
        assert.equal(r.filter((x) => x.status === 429).length, 3);
        for (const x of r) assert.equal('browserKey' in x.data, false);
        for (const row of (await db.query('SELECT requests FROM maps_usage')).rows)
          assert.equal(row.requests, 3);
      },
    );
    await t.test('exhausted monthly allowance rolls back the daily increment', async () => {
      await db.query("UPDATE maps_usage SET requests=0 WHERE period=$1 AND kind='places'", [day]);
      await db.query("UPDATE maps_usage SET requests=4 WHERE period=$1 AND kind='places'", [month]);
      assert.equal((await request('search')).status, 429);
      assert.equal(
        (await db.query("SELECT requests FROM maps_usage WHERE period=$1 AND kind='places'", [day]))
          .rows[0].requests,
        0,
      );
      const status = await (await fetch(base + '/status')).json();
      assert.equal(status.available, false);
    });
    await t.test('server restart preserves used allowances', async () => {
      await stop();
      await start();
      assert.equal((await request('search')).status, 429);
      assert.equal((await request('map')).status, 429);
    });
  } finally {
    if (server?.exitCode === null) await stop();
    await db.query('TRUNCATE maps_usage');
    await db.end();
  }
});
