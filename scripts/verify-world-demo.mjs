// Check the fictional local world without displaying account credentials.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });
const connection = new URL(process.env.DATABASE_URL);
assert.ok(['127.0.0.1', 'localhost'].includes(connection.hostname));
assert.equal(connection.pathname, '/vanly_local');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const input = JSON.parse(await fs.readFile(path.join(root, '.local/world-demo-export.json'), 'utf8'));
const checks = [];
const sessions = [];
const report = { checkedAt: new Date().toISOString(), checks, counts: {} };
const check = (name, actual, expected) => {
  assert.deepEqual(actual, expected, name);
  checks.push(name);
};
const count = async (sql, values = []) => Number((await db.query(sql, values)).rows[0].n);
async function api(session, route, method = 'GET', body) {
  const response = await fetch('http://127.0.0.1:4100/api/v1' + route, {
    method,
    headers: {
      origin: 'http://127.0.0.1:3100',
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
      ...(session ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function login(account) {
  assert.ok(account?.password && !account.password.startsWith('Hasło '), 'Test account has known credentials');
  const result = await api(null, '/auth/login', 'POST', { email: account.email, password: account.password });
  check('Login for role ' + account.role + ' / ' + account.email, result.status, 201);
  const session = { cookie: result.cookie, csrf: result.data.csrf, user: result.data.user };
  sessions.push(session);
  return session;
}
await db.connect();
try {
  await db.query('BEGIN READ ONLY');
  check('1000 complete fictional travelers', await count("SELECT count(*)::int n FROM users WHERE role='traveler' AND email ~ '^podroznik[0-9]+@demo[.]vanly[.]local$'"), 1000);
  check('No incomplete demo profiles', await count(`SELECT count(*)::int n FROM users
    WHERE role='traveler' AND profile->>'demoVersion'='vanly-world-demo-v1'
      AND (coalesce(profile->>'phone','')='' OR coalesce(profile->>'birthDate','')=''
        OR coalesce(profile->>'homeCity','')='' OR coalesce(profile->'address'->>'street','')=''
        OR jsonb_array_length(coalesce(profile->'drivers','[]')) NOT BETWEEN 1 AND 5)`), 0);
  const fleet = (await db.query(`WITH fleets AS (SELECT c.id,count(v.id)::int n FROM companies c
    LEFT JOIN vehicles v ON v.company_id=c.id WHERE c.verified GROUP BY c.id)
    SELECT count(*)::int total,count(*) FILTER (WHERE n=1)::int single,
      count(*) FILTER (WHERE n BETWEEN 2 AND 9)::int multi,sum(n)::int vehicles FROM fleets`)).rows[0];
  check('150 rentals, requested fleet sizes, 267 cars', fleet, { total: 150, single: 120, multi: 30, vehicles: 267 });
  check('All published vehicles have bookable assigned equipment', await count(`SELECT count(*)::int n
    FROM vehicles v JOIN companies c ON c.id=v.company_id WHERE v.status='published' AND c.verified
      AND NOT EXISTS(SELECT 1 FROM stock_item_vehicles sv JOIN stock_items s
        ON s.company_id=sv.company_id AND s.id=sv.item_id
        WHERE sv.company_id=v.company_id AND sv.vehicle_id=v.id AND s.active AND s.quantity>0)`), 0);
  check('Every rental has an owner account', await count(`SELECT count(*)::int n FROM companies c
    WHERE c.verified AND NOT EXISTS(SELECT 1 FROM users u WHERE u.company_id=c.id AND u.role='owner')`), 0);
  check('Reviews belong to the actual completed demo rental', await count(`SELECT count(*)::int n
    FROM comments c JOIN bookings b ON b.id=c.booking_id
    WHERE c.type='review' AND (b.status<>'completed' OR b.user_id<>c.author_id OR b.vehicle_id<>c.vehicle_id)`), 0);
  check('Message authors belong to their conversation', await count(`SELECT count(*)::int n
    FROM messages m JOIN vehicles v ON v.id=m.vehicle_id JOIN users u ON u.id=m.author_id
    WHERE m.author_id<>m.traveler_id AND (u.role<>'owner' OR u.company_id<>v.company_id)`), 0);
  check('Snapshots and prices reconcile', await count(`SELECT count(*)::int n FROM bookings b
    WHERE b.snapshot->>'demoDataset'='world-demo-v1'
      AND (NOT (b.snapshot ?& ARRAY['totalMinor','baseMinor','prepMinor','equipmentMinor','days','vehicle','extras','rates'])
        OR (b.snapshot->>'totalMinor')::int<>b.total_minor
        OR (b.snapshot->>'baseMinor')::int+(b.snapshot->>'prepMinor')::int+(b.snapshot->>'equipmentMinor')::int<>b.total_minor
        OR (b.snapshot->>'days')::int<>b.end_date-b.start_date)`), 0);
  check('Snapshot rate and equipment line totals reconcile', await count(`SELECT count(*)::int n FROM bookings b
    WHERE b.snapshot->>'demoDataset'='world-demo-v1'
      AND ((b.snapshot->>'baseMinor')::int<>(SELECT sum((r->>'rate')::int) FROM jsonb_array_elements(b.snapshot->'rates') r)
        OR (b.snapshot->>'equipmentMinor')::int<>(SELECT coalesce(sum((e->>'total')::int),0) FROM jsonb_array_elements(b.snapshot->'extras') e))`), 0);
  check('Payment ledger reconciles to current paid balance', await count(`WITH ledger AS (
    SELECT booking_id,sum(CASE WHEN kind='refund' THEN -amount_minor ELSE amount_minor END) net FROM payments GROUP BY booking_id)
    SELECT count(*)::int n FROM bookings b LEFT JOIN ledger p ON p.booking_id=b.id
    WHERE b.snapshot->>'demoDataset'='world-demo-v1' AND b.paid_minor<>coalesce(p.net,0)`), 0);
  check('Completed and ongoing rentals have plausible dates', await count(`SELECT count(*)::int n FROM bookings
    WHERE snapshot->>'demoDataset'='world-demo-v1' AND
      ((status='completed' AND end_date>(now() AT TIME ZONE 'Europe/Warsaw')::date)
       OR (status='in_rental' AND NOT(start_date<=(now() AT TIME ZONE 'Europe/Warsaw')::date
         AND end_date>(now() AT TIME ZONE 'Europe/Warsaw')::date)))`), 0);
  check('No active occupancy on inactive booking states', await count(`SELECT count(*)::int n
    FROM allocations a JOIN bookings b ON b.id=a.booking_id
    WHERE a.active AND b.status IN('cancelled','rejected','expired')`), 0);
  check('No equipment oversubscription', await count(`WITH relevant AS (
    SELECT e.company_id,e.item_id,e.quantity,b.start_date,b.end_date FROM booking_extras e JOIN bookings b ON b.id=e.booking_id
    WHERE b.status IN('pending','confirmed','in_rental') OR (b.status='held' AND b.hold_until>now())
  ), events AS (
    SELECT company_id,item_id,start_date dt,quantity delta FROM relevant UNION ALL
    SELECT company_id,item_id,end_date,-quantity FROM relevant
  ), daily AS (SELECT company_id,item_id,dt,sum(delta) delta FROM events GROUP BY company_id,item_id,dt),
  running AS (SELECT company_id,item_id,sum(delta) OVER(PARTITION BY company_id,item_id ORDER BY dt) used FROM daily),
  peak AS (SELECT company_id,item_id,max(used) used FROM running GROUP BY company_id,item_id)
  SELECT count(*)::int n FROM peak p JOIN stock_items s ON s.company_id=p.company_id AND s.id=p.item_id WHERE p.used>s.quantity`), 0);
  for (const table of ['users','companies','vehicles','stock_items','stock_item_vehicles','bookings','messages','comments','reports','tasks','handovers','amendments','favorites','local_mail']) {
    report.counts[table] = await count('SELECT count(*)::int n FROM ' + table);
  }
  report.bookingStates = (await db.query('SELECT status,count(*)::int n FROM bookings GROUP BY status ORDER BY status')).rows;
  report.conversations = await count('SELECT count(*)::int n FROM (SELECT DISTINCT vehicle_id,traveler_id FROM messages) t');
  await db.query('COMMIT');

  const catalog = await api(null, '/catalog');
  check('Public API exposes the entire catalog', catalog.status, 200);
  check('Public catalog is not truncated at 100', catalog.data.length, 267);
  const traveler = await login(input.users.find(u => u.email === 'podroznik1000@demo.vanly.local'));
  const returning = await login(input.users.find(u => u.email === 'podroznik001@demo.vanly.local'));
  const multi = input.users.find(u => u.role === 'owner' && u.company_id === 'demo-flota-001');
  const single = input.users.find(u => u.role === 'owner' && u.company_id === 'demo-solo-001');
  const owners = [await login(multi), await login(single)];
  const admin = await login(input.users.find(u => u.role === 'admin'));
  for (const owner of owners) {
    const dashboard = await api(owner, '/owner/dashboard');
    check('Company panel loads ' + owner.user.company_id, dashboard.status, 200);
    check('Company panel stays scoped ' + owner.user.company_id,
      dashboard.data.vehicles.every(v => v.company_id === owner.user.company_id), true);
    assert.ok(dashboard.data.bookings.length > 0);
    const messages = await api(owner, '/messages?scope=company');
    check('Company conversation list loads', messages.status, 200);
    assert.ok(messages.data.length >= 2);
    const stock = await api(owner, '/owner/stock');
    check('Company stock loads', stock.status, 200);
    assert.ok(stock.data.some(e => e.active && e.quantity > 0));
  }
  const administration = await api(admin, '/admin/dashboard');
  check('Admin data loads', administration.status, 200);
  check('Admin reports the full user count', administration.data.stats.users, report.counts.users);
  check('Travelers cannot access another company panel', (await api(traveler, '/owner/dashboard')).status, 403);
  const ownConversation = (await api(returning, '/messages')).data;
  assert.ok(ownConversation.length > 0, 'Existing fictional travelers have conversations');
  const conversation = ownConversation[0];
  check('Different owner cannot read a private conversation', (await api(owners[0], '/messages?vehicle=' + conversation.vehicle_id + '&traveler=' + returning.user.id)).status,
    conversation.vehicle_id.startsWith('demo-flota-001-') ? 200 : 403);

  // Exercise a new customer's real quote/hold endpoints, then release occupancy.
  const start = new Date(Date.now() + 210 * 86400000).toISOString().slice(0,10);
  const end = new Date(Date.now() + 217 * 86400000).toISOString().slice(0,10);
  const vehicle = catalog.data.find(v => v.company_id === 'demo-solo-001');
  const offer = await api(null, '/vehicles/' + vehicle.id + '?start=' + start + '&end=' + end);
  check('Vehicle detail and assigned extras load', offer.status, 200);
  const extra = offer.data.equipment.find(e => e.active && e.available > 0);
  assert.ok(extra);
  const quote = await api(traveler, '/quotes', 'POST', { vehicleId: vehicle.id, start, end, guests: 2, extras: { [extra.id]: 1 }, plan: 'deposit' });
  check('New fictional traveler can obtain a priced quote', quote.status, 201);
  let booking;
  try {
    const hold = await api(traveler, '/holds', 'POST', { quoteId: quote.data.id });
    check('New fictional traveler can reserve a car and equipment', hold.status, 201);
    booking = hold.data;
    assert.equal(booking.user_id, traveler.user.id);
    const blocked = await api(returning, '/quotes', 'POST', { vehicleId: vehicle.id, start, end, guests: 2, extras: {}, plan: 'deposit' });
    check('Occupied vehicle rejects another booking', blocked.status, 409);
  } finally {
    if (booking) check('Verification hold is released', (await api(traveler, '/bookings/' + booking.id + '/cancel', 'POST', {})).status, 201);
  }
  report.verificationBooking = booking?.id;
  report.result = 'passed';
  await fs.writeFile(path.join(root, '.local/world-demo-verification.json'), JSON.stringify(report,null,2)+'\n', {mode:0o600});
  console.log(JSON.stringify({ result: report.result, checks: checks.length, counts: report.counts, conversations: report.conversations },null,2));
} finally {
  for (const session of sessions) await api(session, '/auth/logout', 'POST', {}).catch(() => {});
  await db.end();
}
