import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import pg from 'pg';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { MailerService, loadMailerConfig } from '../packages/mailer/index.mjs';
import { resolveMailDocuments } from '../packages/documents/service.mjs';
import { ReminderProducer } from '../scripts/worker/reminders/producer.mjs';
import { loadNotificationConfig } from '../scripts/worker/reminders/config.mjs';
import { validateNotificationGuard } from '../scripts/worker/reminders/guard.mjs';
dotenv.config({ path: '.env.local', quiet: true });
process.env.TRAVELER_PAYMENT_MODE = 'local_test';
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/vanly_test')
  throw Error('Tests only run against isolated vanly_test.');
const apiPort = Number(process.env.TEST_API_PORT || 4101);
const apiEntry = process.env.TEST_API_ENTRY || 'apps/api/dist/main.js';
if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535)
  throw Error('Invalid test API port.');
const apiDatabase = new URL(url);
const testApplication = 'vanly-api-test-' + apiPort;
apiDatabase.searchParams.set('application_name', testApplication);
const env = {
  ...process.env,
  DATABASE_URL: apiDatabase.toString(),
  API_PORT: String(apiPort),
  UPLOAD_DIR:process.cwd()+'/.local/test-uploads',
  MAIL_PROVIDER: 'local',
  MAIL_SES_ENABLED: 'false',
  APP_URL: 'http://localhost:3100',
  APP_ORIGIN: 'http://localhost:3100',
  APP_ADDITIONAL_ORIGINS: 'https://vanly.local,https://camperfolks.example',
};
const db = new pg.Pool({ connectionString: url });
let server, testLock;
const accounts = JSON.parse(await fs.readFile('.local/accounts.json', 'utf8'));
let traveler, other, owner, otherOwner, admin, mainBooking;
const day = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const input = (vehicleId = 'coast', start = 30, end = 36, extras = {}) => ({
  vehicleId,
  start: day(start),
  end: day(end),
  guests: 2,
  extras,
  plan: 'deposit',
});
async function request(s, p, method = 'GET', body, key = crypto.randomUUID(), extra = {}) {
  const res = await fetch(`http://127.0.0.1:${apiPort}/api/v1` + p, {
    method,
    headers: {
      origin: 'http://localhost:3100',
      ...(s ? { cookie: s.cookie, 'x-csrf-token': s.csrf } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      'idempotency-key': key,
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data, cookie: res.headers.get('set-cookie') };
}
async function login(email) {
  const a = accounts.find((a) => a.email === email);
  const r = await request(null, '/auth/login', 'POST', { email, password: a.password });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { cookie: r.cookie.split(';')[0], csrf: r.data.csrf, user: r.data.user };
}
async function quote(s, d) {
  const r = await request(s, '/quotes', 'POST', d);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}
async function hold(s, d) {
  const q = await quote(s, d);
  const r = await request(s, '/holds', 'POST', { quoteId: q.id });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}
async function pay(s, b, key = crypto.randomUUID()) {
  return request(
    s,
    '/bookings/' + b.id + '/pay-test',
    'POST',
    {
      name: s.user.name,
      email: s.user.email,
      note: 'Test integracyjny',
      accept: true,
      scenario: 'success',
    },
    key,
  );
}
async function createStock(overrides = {}, account = owner) {
  const r = await request(account, '/owner/stock', 'POST', {
    name: 'Krzesło turystyczne',
    quantity: 4,
    price: 1000,
    unit: 'day',
    excludedTypes: [],
    ...overrides,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}
async function stockAt(item, start = 100, end = 110, account = owner) {
  const r = await request(account, `/owner/stock?start=${day(start)}&end=${day(end)}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.find((row) => row.id === item.id);
}
before(async () => {
  // Concurrent local tasks share this fixture database and test port.
  testLock = await db.connect();
  await testLock.query('SELECT pg_advisory_lock(822320)');
  execFileSync(process.execPath, ['scripts/migrate.mjs'], { env, stdio: 'pipe' });
  await db.query('TRUNCATE companies,users,articles,camps RESTART IDENTITY CASCADE');
  execFileSync(process.execPath, ['scripts/seed.mjs'], { env, stdio: 'pipe' });
  server = spawn(process.execPath, [apiEntry], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const readinessDeadline = Date.now() + 30000;
  let apiReady = false;
  while (Date.now() < readinessDeadline) {
    if (server.exitCode !== null) throw Error(log || 'Test API exited before readiness.');
    try {
      const r = await request(null, '/health');
      if (r.data.ok) { apiReady = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!apiReady) throw Error(log || 'Test API did not become ready within 30 seconds.');
  [traveler, other, owner, otherOwner, admin] = await Promise.all(
    [
      'podroznik@vanly.local',
      'drugi@vanly.local',
      'baltic@vanly.local',
      'slow@vanly.local',
      'operator@vanly.local',
    ].map(login),
  );
});
after(async () => {
  if (server && server.exitCode === null) {
    await new Promise((resolve) => {
      server.once('exit', resolve);
      server.kill('SIGTERM');
    });
  }
  if (testLock) {
    await testLock.query('SELECT pg_advisory_unlock(822320)');
    testLock.release();
  }
  await db.end();
});
test('anonymous SEO inventory includes all public records and excludes drafts and unverified firms', async () => {
  try {
    await db.query(`INSERT INTO companies(id,name,city,lat,lng,verified) VALUES('seo-unverified','Firma testowa SEO','Gdynia',54.5,18.5,false)`);
    await db.query(`INSERT INTO vehicles(id,company_id,name,type,asset,city,lat,lng,seats,sleeps,daily,deposit,status)
      SELECT 'seo-public-'||n,company_id,'Pojazd SEO '||n,type,asset,city,lat,lng,seats,sleeps,daily,deposit,'published'
      FROM vehicles CROSS JOIN generate_series(1,101) n WHERE id='coast'`);
    await db.query(`INSERT INTO vehicles(id,company_id,name,type,asset,city,lat,lng,seats,sleeps,daily,deposit,status)
      SELECT 'seo-'||s,company_id,'Pojazd SEO '||s,type,asset,city,lat,lng,seats,sleeps,daily,deposit,s
      FROM vehicles CROSS JOIN unnest(ARRAY['draft','hidden']) s WHERE id='coast'`);
    await db.query(`INSERT INTO vehicles(id,company_id,name,type,asset,city,lat,lng,seats,sleeps,daily,deposit,status)
      SELECT 'seo-unverified','seo-unverified','Pojazd niezweryfikowanej firmy',type,asset,city,lat,lng,seats,sleeps,daily,deposit,'published'
      FROM vehicles WHERE id='coast'`);
    await db.query(`INSERT INTO articles(id,title,kind,summary,body,asset,published) VALUES('seo-unpublished','Szkic SEO','guide','Niepubliczny szkic','[]','trip.webp',false)`);
    await grantFixturePublications(Array.from({length:101},(_,i)=>'seo-public-'+(i+1)));
    const response = await request(null, '/seo/inventory');
    assert.equal(response.status, 200);
    const expectedVehicles = (await db.query("SELECT v.id FROM vehicles v JOIN companies c ON c.id=v.company_id WHERE v.status='published' AND c.verified ORDER BY v.id")).rows;
    assert.deepEqual(response.data.vehicles, expectedVehicles);
    assert.equal(response.data.vehicles.filter(v => v.id.startsWith('seo-public-')).length, 101);
    assert.ok(!response.data.vehicles.some(v => ['seo-draft','seo-hidden','seo-unverified'].includes(v.id)));
    assert.ok(!response.data.articles.some(a => a.id === 'seo-unpublished'));
    for (const article of response.data.articles) assert.deepEqual(Object.keys(article).sort(), ['id','updated_at']);
  } finally {
    await db.query("DELETE FROM vehicles WHERE id LIKE 'seo-%'");
    await db.query("DELETE FROM companies WHERE id='seo-unverified'");
    await db.query("DELETE FROM articles WHERE id='seo-unpublished'");
  }
});
test('sessions, CSRF and tenant boundaries are enforced', async () => {
  assert.equal((await request(null, '/bookings')).status, 401);
  assert.equal((await request(traveler, '/admin/dashboard')).status, 403);
  assert.equal((await request(traveler, '/owner/dashboard')).status, 403);
  assert.equal(
    (await request(owner, '/owner/vehicles/family', 'PATCH', { name: 'Unauthorized rename' }))
      .status,
    403,
  );
  assert.equal(
    (await request(traveler, '/favorites/coast', 'POST', {}, undefined, { 'x-csrf-token': 'bad' }))
      .status,
    403,
  );
  assert.equal(
    (
      await request(traveler, '/favorites/coast', 'POST', {}, undefined, {
        origin: 'http://evil.invalid',
      })
    ).status,
    403,
  );
});
test('favorites and similar offers never expose draft, hidden or unverified inventory', async () => {
  const ids = ['private-favorite-test', 'draft-favorite-test', 'hidden-favorite-test'];
  const originalType = (await db.query("SELECT type FROM vehicles WHERE id='coast'")).rows[0].type;
  await db.query("INSERT INTO companies(id,name,verified) VALUES('private-favorites-company','Prywatna firma',false)");
  try {
    for (const [index, id] of ids.entries()) await db.query(
      `INSERT INTO vehicles(id,company_id,name,type,asset,city,seats,sleeps,daily,deposit,status)
       SELECT $1,$2,name,'private-test-kind',asset,city,seats,sleeps,daily,deposit,$3 FROM vehicles WHERE id='coast'`,
      [id, index === 0 ? 'private-favorites-company' : owner.user.company_id, ['published', 'draft', 'hidden'][index]],
    );
    // Existing favorites may outlive a listing becoming private.
    for (const id of ids) await db.query('INSERT INTO favorites(user_id,vehicle_id) VALUES($1,$2)', [traveler.user.id, id]);
    const favorites = await request(traveler, '/favorites');
    assert.equal(favorites.status, 200);
    assert.ok(favorites.data.every(vehicle => !ids.includes(vehicle.id)));
    for (const id of ids) assert.equal((await request(traveler, '/favorites/' + id, 'POST')).status, 404);
    await db.query("UPDATE vehicles SET type='private-test-kind' WHERE id='coast'");
    const detail = await request(null, '/vehicles/coast');
    assert.equal(detail.status, 200);
    assert.ok(detail.data.similar.every(vehicle => !ids.includes(vehicle.id)));
  } finally {
    await db.query("UPDATE vehicles SET type=$1 WHERE id='coast'", [originalType]);
    await db.query('DELETE FROM favorites WHERE vehicle_id=ANY($1::text[])', [ids]);
    await db.query('DELETE FROM vehicles WHERE id=ANY($1::text[])', [ids]);
    await db.query("DELETE FROM companies WHERE id='private-favorites-company'");
  }
});

test('concurrent onboarding creates one company and one committed owner assignment', async () => {
  const registered = await request(null, '/auth/register', 'POST', {
    email: 'onboarding-race@vanly.example', name: 'Nowa firma', password: 'OnboardingTest!2026',
  });
  assert.equal(registered.status, 201);
  const session = { cookie: registered.cookie.split(';')[0], csrf: registered.data.csrf, user: registered.data.user };
  const beforeCompanies = (await db.query('SELECT count(*)::int n FROM companies')).rows[0].n;
  const results = await Promise.all(Array.from({ length: 3 }, () =>
    request(session, '/company-onboarding', 'POST', { name: 'Wypożyczalnia testu współbieżności' }),
  ));
  assert.equal(results.filter(result => result.status === 201).length, 1);
  assert.ok(results.every(result => [201, 403, 409].includes(result.status)));
  assert.equal((await db.query('SELECT count(*)::int n FROM companies')).rows[0].n, beforeCompanies + 1);
  const account = (await db.query('SELECT role,company_id FROM users WHERE id=$1', [session.user.id])).rows[0];
  assert.equal(account.role, 'owner');
  assert.equal(account.company_id, results.find(result => result.status === 201).data.id);
  assert.equal((await db.query("SELECT count(*)::int n FROM audit WHERE user_id=$1 AND action='company.onboarding'", [session.user.id])).rows[0].n, 1);
});

test('LAN HTTPS uses a separate Secure cookie and still enforces origin and CSRF', async () => {
  const account = accounts.find((a) => a.email === 'podroznik@vanly.local');
  const headers = { origin: 'https://vanly.local', 'x-vanly-protocol': 'https' };
  const signedIn = await request(null, '/auth/login', 'POST', account, undefined, headers);
  assert.equal(signedIn.status, 201);
  assert.match(signedIn.cookie, /^__Host-vanly_session=/);
  assert.match(signedIn.cookie, /; Secure/);
  assert.match(signedIn.cookie, /; HttpOnly/);
  assert.match(signedIn.cookie, /; SameSite=Strict/);
  assert.doesNotMatch(signedIn.cookie, /; Domain=/);
  const session = { cookie: signedIn.cookie.split(';')[0], csrf: signedIn.data.csrf };
  assert.equal((await request(session, '/auth/me', 'GET', undefined, undefined, headers)).data.user.email, account.email);
  // HTTPS sessions are never selected on the plain HTTP listener, or vice versa.
  assert.equal((await request(session, '/auth/me')).data.user, null);
  assert.equal((await request(traveler, '/auth/me', 'GET', undefined, undefined, headers)).data.user, null);
  assert.equal((await request(session, '/favorites/coast', 'POST', {}, undefined, { ...headers, 'x-csrf-token': 'bad' })).status, 403);
  assert.equal((await request(null, '/auth/login', 'POST', account, undefined, { ...headers, origin: 'https://vanly.local.evil.invalid' })).status, 403);
  const logout = await request(session, '/auth/logout', 'POST', {}, undefined, headers);
  assert.equal(logout.status, 201);
  assert.match(logout.cookie, /^__Host-vanly_session=;/);
  assert.match(logout.cookie, /; Secure/);
  assert.equal((await request(session, '/auth/me', 'GET', undefined, undefined, headers)).data.user, null);
});
test('price and capacity are calculated by the server', async () => {
  const d = input();
  const q = await quote(traveler, d);
  assert.equal(q.totalMinor, 6 * 42900 + 19000);
  assert.equal(q.dueNowMinor, Math.round(q.totalMinor * 0.3));
  assert.equal((await request(traveler, '/quotes', 'POST', { ...d, totalMinor: 1 })).status, 400);
  assert.equal((await request(traveler, '/quotes', 'POST', { ...d, guests: 12 })).status, 400);
  assert.equal((await request(traveler, '/quotes', 'POST', { ...d, end: day(29) })).status, 400);
});
test('two simultaneous holds cannot reserve the same vehicle', async () => {
  const [q1, q2] = await Promise.all([quote(traveler, input()), quote(other, input())]);
  const holds = await Promise.all([
    request(traveler, '/holds', 'POST', { quoteId: q1.id }),
    request(other, '/holds', 'POST', { quoteId: q2.id }),
  ]);
  assert.deepEqual(holds.map((r) => r.status).sort(), [201, 409]);
  const index = holds.findIndex((r) => r.status === 201);
  mainBooking = holds[index].data;
  if (index === 1) [traveler, other] = [other, traveler];
  assert.equal((await request(other, '/bookings/' + mainBooking.id)).status, 403);
  assert.equal((await request(otherOwner, '/bookings/' + mainBooking.id)).status, 403);
  assert.equal((await request(owner, '/bookings/' + mainBooking.id)).status, 200);
  assert.equal((await request(traveler, '/quotes', 'POST', input('coast', 36, 39))).status, 409);
  assert.equal((await request(traveler, '/quotes', 'POST', input('coast', 37, 40))).status, 201);
});
test('payment retries are idempotent and customer cannot decide acceptance', async () => {
  const key = crypto.randomUUID();
  const [a, b] = await Promise.all([
    pay(traveler, mainBooking, key),
    pay(traveler, mainBooking, key),
  ]);
  assert.equal(a.status, 201, JSON.stringify(a));
  assert.equal(b.status, 201);
  assert.equal(a.data.status, 'pending');
  assert.equal((await request(owner, '/bookings/' + mainBooking.id + '/decision', 'POST', { accept: true })).data.status, 'confirmed');
  const result = await db.query('SELECT count(*)::int n FROM payments WHERE booking_id=$1', [
    mainBooking.id,
  ]);
  assert.equal(result.rows[0].n, 1);
  assert.equal(
    (await request(traveler, '/bookings/' + mainBooking.id + '/decision', 'POST', { accept: true }))
      .status,
    403,
  );
  assert.equal(
    (
      await request(traveler, '/bookings/' + mainBooking.id + '/review', 'POST', {
        rating: 5,
        text: 'Nie odbył się jeszcze wynajem',
      })
    ).status,
    403,
  );
});
test('shared stock cannot be overbooked on two different vehicles', async () => {
  const [q1, q2] = await Promise.all([
    quote(traveler, input('coast', 45, 50, { chair: 3 })),
    quote(other, input('wild', 45, 50, { chair: 3 })),
  ]);
  const results = await Promise.all([
    request(traveler, '/holds', 'POST', { quoteId: q1.id }),
    request(other, '/holds', 'POST', { quoteId: q2.id }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const winning = results.find((r) => r.status === 201).data;
  assert.equal(
    (await request(owner, '/owner/stock/chair', 'PATCH', { quantity: 2, price: 500 })).status,
    409,
  );
  const u = winning.user_id === traveler.user.id ? traveler : other;
  assert.equal((await request(u, '/bookings/' + winning.id + '/cancel', 'POST')).status, 201);
});
test('stock availability uses peak simultaneous quantity, not sum over the interval', async () => {
  const b1 = await hold(traveler, input('coast', 60, 63, { chair: 3 })),
    b2 = await hold(traveler, input('coast', 65, 68, { chair: 3 }));
  const q = await quote(other, input('wild', 60, 68, { chair: 1 }));
  assert.equal(q.extras[0].quantity, 1);
  await request(traveler, '/bookings/' + b1.id + '/cancel', 'POST');
  await request(traveler, '/bookings/' + b2.id + '/cancel', 'POST');
});
test('request-mode booking is accepted only by its company', async () => {
  const b = await hold(traveler, input('family', 30, 36));
  const paid = await pay(traveler, b);
  assert.equal(paid.data.status, 'pending');
  assert.equal(
    (await request(owner, '/bookings/' + b.id + '/decision', 'POST', { accept: true })).status,
    403,
  );
  assert.equal(
    (await request(otherOwner, '/bookings/' + b.id + '/decision', 'POST', { accept: true })).data
      .status,
    'confirmed',
  );
  await request(traveler, '/bookings/' + b.id + '/cancel', 'POST');
  assert.equal(
    (await request(admin, '/bookings/' + b.id + '/refund-test', 'POST')).data.payment_status,
    'refunded',
  );
});
test('expired holds release the calendar and reject a late payment', async () => {
  const b = await hold(traveler, input('weekend', 40, 45));
  await db.query("UPDATE bookings SET hold_until=now()-interval '1 second' WHERE id=$1", [b.id]);
  assert.equal((await pay(traveler, b)).status, 409);
  const q = await quote(other, input('weekend', 40, 45));
  assert.ok(q.id);
  assert.equal((await request(traveler, '/bookings/' + b.id)).data.status, 'expired');
});
test('accepted amendment keeps the old snapshot and changes availability atomically', async () => {
  const a = await request(traveler, '/bookings/' + mainBooking.id + '/amendments', 'POST', {
    start: day(32),
    end: day(39),
    note: 'Wydłużenie',
  });
  assert.equal(a.status, 201, JSON.stringify(a));
  assert.equal(
    (await request(otherOwner, '/amendments/' + a.data.id + '/decision', 'POST', { accept: true }))
      .status,
    403,
  );
  const r = await request(owner, '/amendments/' + a.data.id + '/decision', 'POST', {
    accept: true,
  });
  assert.equal(r.status, 201, JSON.stringify(r));
  assert.equal(r.data.start_date, day(32));
  assert.equal(r.data.total_minor, 7 * 42900 + 19000);
  assert.equal(r.data.amendments[0].previous.start, day(30));
  assert.equal((await request(traveler, '/quotes', 'POST', input('coast', 38, 42))).status, 409);
});
test('handover, review moderation and separate deposit status persist', async () => {
  const h = {
    mileage: 12000,
    fuel: 'Pełny',
    notes: 'Sprawdzono',
    checks: { equipment: true, condition: true, fuel: true },
  };
  assert.equal(
    (
      await request(owner, '/bookings/' + mainBooking.id + '/handovers', 'POST', {
        ...h,
        kind: 'return',
      })
    ).status,
    409,
  );
  const pickup = await request(owner, '/bookings/' + mainBooking.id + '/handovers', 'POST', {
    ...h,
    kind: 'pickup',
  });
  assert.equal(pickup.status, 201);
  assert.equal(
    (await request(traveler, '/handovers/' + pickup.data.id + '/confirm', 'POST')).status,
    201,
  );
  assert.equal(
    (
      await request(owner, '/bookings/' + mainBooking.id + '/handovers', 'POST', {
        ...h,
        kind: 'return',
        mileage: 12400,
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await request(owner, '/bookings/' + mainBooking.id + '/deposit', 'POST', {
        status: 'released',
        reason: 'Stan bez uwag',
      })
    ).status,
    201,
  );
  const review = await request(traveler, '/bookings/' + mainBooking.id + '/review', 'POST', {
    rating: 5,
    text: 'Udany test całej rezerwacji i odbioru.',
  });
  assert.equal(review.status, 201);
  const v1 = await request(null, '/vehicles/coast');
  assert.equal(v1.data.comments.length, 0);
  assert.equal(
    (
      await request(admin, '/comments/' + review.data.id + '/reply', 'POST', {
        text: 'Nie jestem firmą',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(admin, '/admin/comments/' + review.data.id + '/moderate', 'POST', {
        status: 'published',
        reason: 'Opinia po potwierdzonym wynajmie',
      })
    ).status,
    201,
  );
  const v2 = await request(null, '/vehicles/coast');
  assert.equal(v2.data.comments.length, 1);
  assert.equal(
    (await request(traveler, '/bookings/' + mainBooking.id)).data.deposit_status,
    'released',
  );
});
test('cancellation and refund are separate and refund cannot run twice', async () => {
  const b = await hold(traveler, input('slow', 30, 36));
  await pay(traveler, b);
  const cancelled = await request(traveler, '/bookings/' + b.id + '/cancel', 'POST');
  assert.equal(cancelled.data.payment_status, 'refund_pending');
  assert.equal((await request(traveler, '/bookings/' + b.id + '/refund-test', 'POST')).status, 403);
  const key = crypto.randomUUID();
  const [a, c] = await Promise.all([
    request(admin, '/bookings/' + b.id + '/refund-test', 'POST', undefined, key),
    request(admin, '/bookings/' + b.id + '/refund-test', 'POST', undefined, key),
  ]);
  assert.equal(a.data.payment_status, 'refunded');
  assert.equal(c.data.paid_minor, 0);
  assert.equal(
    (
      await db.query("SELECT count(*)::int n FROM payments WHERE booking_id=$1 AND kind='refund'", [
        b.id,
      ])
    ).rows[0].n,
    1,
  );
});
test('unverified companies cannot be booked even by direct vehicle URL', async () => {
  assert.equal(
    (
      await request(admin, '/admin/companies/weekend-dalej/verify', 'POST', {
        verified: false,
        reason: 'Test kontroli publikacji',
      })
    ).status,
    201,
  );
  assert.equal((await request(null, '/vehicles/weekend')).status, 404);
  assert.equal((await request(traveler, '/quotes', 'POST', input('weekend', 80, 85))).status, 404);
});
test('messages are private to traveler and the correct company', async () => {
  await request(traveler, '/messages', 'POST', { vehicleId: 'coast', text: 'Wiadomość prywatna' });
  const thread = await request(owner, '/messages?vehicle=coast&traveler=' + traveler.user.id);
  assert.equal(thread.data.length, 1);
  assert.equal((await request(other, '/messages?vehicle=coast')).data.length, 0);
  assert.equal(
    (await request(otherOwner, '/messages?vehicle=coast&traveler=' + traveler.user.id)).status,
    403,
  );
  assert.equal(
    (
      await request(other, '/messages', 'POST', {
        vehicleId: 'coast',
        travelerId: traveler.user.id,
        text: 'Podszywanie',
      })
    ).status,
    403,
  );
});

test('private offers reject first contact and public questions while established conversations remain available', async () => {
  const ids = ['contact-draft', 'contact-hidden', 'contact-unverified', 'contact-established'];
  await db.query("INSERT INTO companies(id,name,verified) VALUES('contact-private-company','Prywatna firma kontaktu',false)");
  try {
    for (const [index, id] of ids.entries()) await db.query(
      `INSERT INTO vehicles(id,company_id,name,type,asset,city,seats,sleeps,daily,deposit,status)
       SELECT $1,$2,name,type,asset,city,seats,sleeps,daily,deposit,$3 FROM vehicles WHERE id='coast'`,
      [id, index === 2 ? 'contact-private-company' : owner.user.company_id,
        ['draft', 'hidden', 'published', 'published'][index]],
    );
    for (const id of ids.slice(0, 3)) {
      assert.equal((await request(traveler, '/messages', 'POST', { vehicleId: id, text: 'Pierwszy kontakt' })).status, 404);
      assert.equal((await request(traveler, `/vehicles/${id}/questions`, 'POST', { text: 'Czy ta oferta jest dostępna?' })).status, 404);
    }
    await grantFixturePublications([ids[3]]);
    const vehicleId = ids[3];
    assert.equal((await request(traveler, '/messages', 'POST', { vehicleId, text: 'Rozmowa z publiczną ofertą' })).status, 201);
    await db.query("UPDATE vehicles SET status='hidden' WHERE id=$1", [vehicleId]);
    assert.equal((await request(traveler, '/messages', 'POST', { vehicleId, text: 'Kontynuacja po ukryciu oferty' })).status, 201);
    assert.equal((await request(owner, '/messages', 'POST', { vehicleId, travelerId: traveler.user.id, text: 'Odpowiedź firmy' })).status, 201);
    assert.equal((await request(other, '/messages', 'POST', { vehicleId, text: 'Nowa rozmowa z ukrytą ofertą' })).status, 404);
    assert.equal((await request(traveler, `/vehicles/${vehicleId}/questions`, 'POST', { text: 'Nowe publiczne pytanie' })).status, 404);
  } finally {
    await db.query('DELETE FROM messages WHERE vehicle_id=ANY($1::text[])', [ids]);
    await db.query('DELETE FROM message_conversations WHERE vehicle_id=ANY($1::text[])', [ids]);
    await db.query('DELETE FROM vehicles WHERE id=ANY($1::text[])', [ids]);
    await db.query("DELETE FROM companies WHERE id='contact-private-company'");
  }
});

test('registration continues to a private company with draft-only publishing until verification', async () => {
  const company = { name: 'Nowa wypożyczalnia testowa' };
  assert.equal((await request(null, '/company-onboarding', 'POST', company)).status, 401);
  const registered = await request(null, '/auth/register', 'POST', {
    name: 'Właściciel testowy', email: 'onboarding-' + crypto.randomUUID() + '@example.test',
    password: crypto.randomUUID(),
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.data.user.role, 'traveler');
  const account = { cookie: registered.cookie.split(';')[0], csrf: registered.data.csrf };
  const created = await request(account, '/company-onboarding', 'POST', company);
  assert.equal(created.status, 201);
  assert.equal(created.data.status, 'pending_verification');
  const onboardingMail = (await db.query(
    'SELECT payload FROM jobs WHERE recipient_user_id=$1 AND event_key=$2',
    [registered.data.user.id, 'company.onboarding:' + created.data.id],
  )).rows;
  assert.equal(onboardingMail.length, 1);
  assert.equal(new URL(onboardingMail[0].payload.variables.action_url).pathname, '/company');
  const refreshed = await request(account, '/auth/me');
  assert.equal(refreshed.data.user.role, 'owner');
  assert.equal(refreshed.data.user.company_id, created.data.id);
  const dashboard = await request(account, '/owner/dashboard');
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.data.company.verified, false);
  assert.equal(dashboard.data.company.city, null);
  assert.equal(dashboard.data.company.lat, null);
  assert.equal(dashboard.data.company.lng, null);
  assert.deepEqual(dashboard.data.vehicles, []);
  assert.equal((await request(account, '/company-onboarding', 'POST', company)).status, 403);
  const draft = {
    name: 'Kamper nowej firmy', type: 'campervan', city: '  Gmina Nowa Testowa  ',
    street: '  Leśna  ', house_number: '  12A/3  ',
    seats: 4, sleeps: 4, daily: 50000, prep: 0, deposit: 100000, min_days: 2,
    auto: false, pets: false, instant: true, km: null, description: 'Pojazd testowy nowej wypożyczalni.',
    tagline: '', features: [], asset: 'campervan.webp', status: 'draft',
  };
  const vehicle = await request(account, '/owner/vehicles', 'POST', draft);
  assert.equal(vehicle.status, 201, JSON.stringify(vehicle.data));
  const saved = (await request(account, '/owner/dashboard')).data.vehicles[0];
  assert.equal(saved.city, 'Gmina Nowa Testowa');
  assert.equal(saved.street, 'Leśna');
  assert.equal(saved.house_number, '12A/3');
  assert.equal(saved.lat, null);
  assert.equal(saved.lng, null);
  assert.equal((await request(account, '/owner/vehicles/' + vehicle.data.id, 'PATCH', { status: 'published' })).status, 403);
  assert.equal((await request(null, '/vehicles/' + vehicle.data.id)).status, 404);
  assert.equal((await request(otherOwner, '/owner/vehicles/' + vehicle.data.id, 'PATCH', { name: 'Obca firma' })).status, 403);
});

const pickupVehicle = (overrides = {}) => ({
  name: 'Kamper z własnym miejscem odbioru', type: 'campervan', city: 'Gmina Testowa',
  seats: 4, sleeps: 4, daily: 50000, prep: 0, deposit: 100000, min_days: 2,
  auto: false, pets: false, instant: true, km: null,
  description: 'Pojazd do testów własnego miejsca odbioru.', tagline: '', features: [],
  asset: 'campervan.webp', status: 'draft', ...overrides,
});
async function createPickupVehicle(overrides = {}) {
  if (overrides.status === 'published') assert.equal((await request(owner,'/owner/credits/buy-test','POST',{credits:1})).status,201);
  const result = await request(owner, '/owner/vehicles', 'POST', pickupVehicle(overrides));
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.id;
}
async function grantFixturePublications(ids) {
  await db.query(`INSERT INTO vehicle_publications(vehicle_id,company_id,anchor_at,months,valid_until)
    SELECT id,company_id,now(),1,now()+interval '1 month' FROM vehicles WHERE id=ANY($1::text[]) ON CONFLICT DO NOTHING`,[ids]);
}

test('vehicle pickup supports free text and optional address without inherited coordinates', async () => {
  const id = await createPickupVehicle({
    city: '  Osada Własna Testowa  ', street: '  Nad Strumieniem  ', house_number: '  8B/2  ',
  });
  const dashboard = await request(owner, '/owner/dashboard');
  const saved = dashboard.data.vehicles.find((v) => v.id === id);
  assert.equal(saved.city, 'Osada Własna Testowa');
  assert.equal(saved.street, 'Nad Strumieniem');
  assert.equal(saved.house_number, '8B/2');
  assert.equal(saved.lat, null);
  assert.equal(saved.lng, null);
  const edited = await request(owner, '/owner/vehicles/' + id, 'PATCH', {
    city: '  Gmina Własna Testowa  ', street: '  Polna  ', house_number: '  21C  ',
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.city, 'Gmina Własna Testowa');
  assert.equal(edited.data.street, 'Polna');
  assert.equal(edited.data.house_number, '21C');
  assert.equal(edited.data.lat, null);
  assert.equal(edited.data.lng, null);
  assert.equal((await request(otherOwner, '/owner/vehicles/' + id, 'PATCH', {
    city: 'Obce miejsce', street: 'Obca ulica', house_number: '1',
  })).status, 403);
  const cleared = await request(owner, '/owner/vehicles/' + id, 'PATCH', {
    street: '', house_number: '',
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.street, '');
  assert.equal(cleared.data.house_number, '');
});

test('pickup validation rejects blank locality, overlong addresses and incomplete coordinates', async () => {
  const invalid = [
    { city: '  ' }, { city: ' x ' }, { city: 'x'.repeat(81) },
    { street: 'x'.repeat(1000) }, { house_number: 'x'.repeat(1000) },
    { lat: 50 }, { lng: 20 }, { lat: null, lng: 20 }, { lat: 50, lng: null },
  ];
  for (const fields of invalid) {
    const response = await request(owner, '/owner/vehicles', 'POST', pickupVehicle(fields));
    assert.equal(response.status, 400, JSON.stringify({ fields, data: response.data }));
  }
  const id = await createPickupVehicle({ city: 'Kraków', lat: 50.0647, lng: 19.945 });
  for (const fields of invalid) {
    const response = await request(owner, '/owner/vehicles/' + id, 'PATCH', fields);
    assert.equal(response.status, 400, JSON.stringify({ fields, data: response.data }));
  }
  const moved = await request(owner, '/owner/vehicles/' + id, 'PATCH', {
    city: 'Nowa własna miejscowość',
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.equal(moved.data.lat, null, 'Changed text must clear coordinates from the old pickup');
  assert.equal(moved.data.lng, null);
  const unchanged = await request(owner, '/owner/vehicles/' + id, 'PATCH', {
    street: 'Nowa ulica',
  });
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.data.city, 'Nowa własna miejscowość');
});

test('public locations are vehicle pickups and exclude drafts, hidden vehicles and private companies', async () => {
  const publicCity = 'Osada Publiczna Testowa';
  await createPickupVehicle({ city: publicCity, status: 'published' });
  await createPickupVehicle({ city: 'Osada Szkic Testowa', status: 'draft' });
  await createPickupVehicle({ city: 'Osada Ukryta Testowa', status: 'hidden' });
  await db.query(`INSERT INTO companies(id,name,city,lat,lng,verified)
    VALUES('pickup-headquarters','Firma z samą siedzibą','Siedziba Prywatna Testowa',51,20,true),
      ('pickup-unverified','Niezweryfikowana firma','Firma Prywatna Testowa',51,20,false)`);
  await db.query(`INSERT INTO vehicles(id,company_id,name,type,asset,city,lat,lng,seats,sleeps,daily,deposit,status)
    SELECT 'pickup-private','pickup-unverified','Pojazd prywatnej firmy',type,asset,
      'Odbiór Prywatny Testowy',lat,lng,seats,sleeps,daily,deposit,'published'
    FROM vehicles WHERE id='coast'`);
  const locations = await request(null, '/locations');
  assert.equal(locations.status, 200);
  const cities = locations.data.map((row) => row.city);
  assert.ok(cities.includes(publicCity), 'Published free-text pickup belongs in discovery');
  for (const privateCity of [
    'Osada Szkic Testowa', 'Osada Ukryta Testowa', 'Siedziba Prywatna Testowa',
    'Firma Prywatna Testowa', 'Odbiór Prywatny Testowy', 'Gmina Nowa Testowa',
  ]) assert.ok(!cities.includes(privateCity), privateCity + ' must remain private');
});

test('catalogue finds a moved pickup and same-name free text when locality resolves coordinates', async () => {
  const suggestions = await request(null, '/localities?q=' + encodeURIComponent('Kraków'));
  assert.equal(suggestions.status, 200);
  const locality = suggestions.data.find((row) => row.name === 'Kraków' && row.lat !== null);
  assert.ok(locality, 'Autocomplete must contain Kraków with coordinates');
  assert.equal(typeof locality.label, 'string');
  assert.equal(typeof locality.lat, 'number');
  assert.equal(typeof locality.lng, 'number');
  const mappedId = await createPickupVehicle({
    city: locality.name, lat: locality.lat, lng: locality.lng, status: 'published',
  });
  const customId = await createPickupVehicle({ city: locality.name, status: 'published' });
  const nearby = await request(null, '/catalog?location=' + encodeURIComponent(locality.name) + '&radius=1');
  assert.equal(nearby.status, 200);
  const mapped = nearby.data.find((row) => row.id === mappedId);
  assert.ok(mapped, 'Vehicle pickup overrides the owner company location in Gdynia');
  assert.ok(mapped.distance_km < 1);
  const custom = nearby.data.find((row) => row.id === customId);
  assert.ok(custom, 'Same-name custom pickup without coordinates must not disappear');
  assert.equal(custom.lat, null);
  assert.equal(custom.lng, null);
});

test('catalogue equipment filters support legacy and repeated selections with all-selected matching', async () => {
  const city = 'Miejscowość Filtra Wyposażenia Testowa';
  const fixtures = [
    ['none', []],
    ['shower', ['Prysznic']],
    ['kitchen', ['Kuchnia z lodówką']],
    ['heat', ['Ogrzewanie postojowe']],
    ['pair', ['Prysznic i toaleta', 'Aneks kuchenny']],
    ['all', ['Prysznic i toaleta', 'Kuchnia z lodówką', 'Ogrzewanie postojowe']],
  ];
  const prefix = 'equipment-filter-';
  try {
    for (const [name, features] of fixtures)
      await db.query(`INSERT INTO vehicles(id,company_id,name,type,asset,city,lat,lng,seats,sleeps,daily,deposit,features,status)
        SELECT $1,company_id,$1,type,asset,$2,NULL,NULL,seats,sleeps,daily,deposit,$3::jsonb,'published'
        FROM vehicles WHERE id='coast'`, [prefix + name, city, JSON.stringify(features)]);
    await grantFixturePublications(fixtures.map(([name])=>prefix+name));
    const cases = [
      ['', ['none', 'shower', 'kitchen', 'heat', 'pair', 'all']],
      ['&feature=shower', ['shower', 'pair', 'all']],
      ['&feature=kitchen', ['kitchen', 'pair', 'all']],
      ['&feature=heat', ['heat', 'all']],
      ['&feature=shower&feature=kitchen', ['pair', 'all']],
      ['&feature=kitchen&feature=heat', ['all']],
      ['&feature=shower&feature=kitchen&feature=heat', ['all']],
      ['&feature=heat&feature=kitchen&feature=shower', ['all']],
      ['&feature=shower&feature=shower', ['shower', 'pair', 'all']],
    ];
    for (const [query, expected] of cases) {
      const response = await request(null, '/catalog?location=' + encodeURIComponent(city) + query);
      assert.equal(response.status, 200, JSON.stringify(response.data));
      assert.deepEqual(response.data.map((v) => v.id).sort(),
        expected.map((name) => prefix + name).sort(), query || 'No equipment selected');
    }
  } finally {
    await db.query("DELETE FROM vehicles WHERE id LIKE 'equipment-filter-%'");
  }
});

test('catalogue equipment filters reject unknown and excessive repeated selections', async () => {
  for (const query of [
    'feature=unknown',
    'feature=shower&feature=unknown',
    'feature=shower,kitchen',
    'feature=',
    'feature=shower&feature=kitchen&feature=heat&feature=shower',
  ]) {
    const response = await request(null, '/catalog?' + query);
    assert.equal(response.status, 400, query + ': ' + JSON.stringify(response.data));
  }
});

test('booking pickup address survives fleet edits and an accepted date amendment', async () => {
  const original = { city: 'Gmina Rezerwacji Testowa', street: 'Letnia', house_number: '15A/2' };
  const id = await createPickupVehicle({ ...original, status: 'published' });
  const booking = await hold(traveler, input(id, 100, 105));
  assert.equal(booking.snapshot.vehicle.city, original.city);
  assert.equal(booking.snapshot.vehicle.street, original.street);
  assert.equal(booking.snapshot.vehicle.house_number, original.house_number);
  const payment = await pay(traveler, booking);
  assert.equal(payment.status, 201, JSON.stringify(payment.data));
  assert.equal(payment.data.status, 'pending');
  assert.equal((await request(owner, '/bookings/' + booking.id + '/decision', 'POST', { accept: true })).data.status, 'confirmed');
  const before = await request(traveler, '/bookings/' + booking.id);
  assert.equal(before.status, 200);
  for (const [field, value] of Object.entries(original)) assert.equal(before.data[field], value);
  const moved = await request(owner, '/owner/vehicles/' + id, 'PATCH', {
    city: 'Inna Gmina Testowa', street: 'Zimowa', house_number: '99',
  });
  assert.equal(moved.status, 200);
  const after = await request(traveler, '/bookings/' + booking.id);
  for (const [field, value] of Object.entries(original)) {
    assert.equal(after.data[field], value, 'Booked pickup must remain stable: ' + field);
    assert.equal(after.data.snapshot.vehicle[field], value);
  }
  const amendment = await request(traveler, '/bookings/' + booking.id + '/amendments', 'POST', {
    start: day(101), end: day(106), note: 'Przesunięcie terminu bez zmiany miejsca odbioru',
  });
  assert.equal(amendment.status, 201, JSON.stringify(amendment.data));
  for (const [field, value] of Object.entries(original)) {
    assert.equal(amendment.data.snapshot.vehicle[field], value,
      'Amendment quote must keep the booked pickup: ' + field);
  }
  const accepted = await request(owner, '/amendments/' + amendment.data.id + '/decision', 'POST', {
    accept: true,
  });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  assert.equal(accepted.data.start_date, day(101));
  assert.equal(accepted.data.end_date, day(106));
  assert.equal(accepted.data.amendments[0].status, 'accepted');
  for (const [field, value] of Object.entries(original)) {
    assert.equal(accepted.data[field], value, 'Accepted amendment must keep the booked pickup: ' + field);
    assert.equal(accepted.data.snapshot.vehicle[field], value);
  }
  const updated = await request(traveler, '/bookings/' + booking.id);
  assert.equal(updated.status, 200);
  for (const [field, value] of Object.entries(original)) {
    assert.equal(updated.data[field], value);
    assert.equal(updated.data.snapshot.vehicle[field], value);
  }
});


async function messageVehicle(t, companyOwner = owner) {
  const id = 'message-' + crypto.randomUUID();
  await db.query(
    `INSERT INTO vehicles(id,company_id,name,type,asset,city,lat,lng,seats,sleeps,daily,deposit,status)
      SELECT $1,$2,name,type,asset,city,lat,lng,seats,sleeps,daily,deposit,status FROM vehicles WHERE id='coast'`,
    [id, companyOwner.user.company_id],
  );
  await grantFixturePublications([id]);
  t.after(async () => {
    await db.query('DELETE FROM messages WHERE vehicle_id=$1', [id]);
    await db.query('DELETE FROM message_conversations WHERE vehicle_id=$1', [id]);
    await db.query('DELETE FROM vehicles WHERE id=$1', [id]);
  });
  return id;
}
test('message lists identify the latest author and who needs to reply, newest first', async (t) => {
  const firstVehicle = await messageVehicle(t), secondVehicle = await messageVehicle(t);
  const initial = await request(traveler, '/messages', 'POST', {
    vehicleId: firstVehicle, text: 'Czy mogę odebrać samochód wcześniej?',
  });
  assert.equal(initial.status, 201);
  assert.equal((await request(other, '/messages', 'POST', {
    vehicleId: secondVehicle, text: 'Pytanie o drugi samochód',
  })).status, 201);
  let companyList = (await request(owner, '/messages?scope=company')).data
    .filter((m) => [firstVehicle, secondVehicle].includes(m.vehicle_id));
  assert.deepEqual(companyList.map((m) => m.vehicle_id), [secondVehicle, firstVehicle]);
  const first = companyList[1];
  assert.equal(first.conversation_status, 'needs_reply');
  assert.equal(first.author, traveler.user.name);
  assert.equal(first.traveler_name, traveler.user.name);
  assert.equal(first.created_at, initial.data.created_at);
  assert.ok(first.vehicle_name);
  assert.equal((await request(traveler, '/messages')).data
    .find((m) => m.vehicle_id === firstVehicle).conversation_status, 'awaiting_reply');
  const reply = await request(owner, '/messages', 'POST', {
    vehicleId: firstVehicle, travelerId: traveler.user.id, text: 'Tak, zapraszamy wcześniej.',
  });
  assert.equal(reply.status, 201);
  companyList = (await request(owner, '/messages?scope=company')).data
    .filter((m) => [firstVehicle, secondVehicle].includes(m.vehicle_id));
  assert.equal(companyList[0].vehicle_id, firstVehicle);
  assert.equal(companyList[0].author, owner.user.name);
  assert.equal(companyList[0].conversation_status, 'awaiting_reply');
  assert.equal(companyList[0].created_at, reply.data.created_at);
  const travelerThread = (await request(traveler, '/messages')).data
    .find((m) => m.vehicle_id === firstVehicle);
  assert.equal(travelerThread.conversation_status, 'needs_reply');
  assert.equal(travelerThread.author, owner.user.name);
});
test('conversation resolution persists and either participant sending reopens it', async (t) => {
  const vehicleId = await messageVehicle(t), travelerId = traveler.user.id;
  assert.equal((await request(traveler, '/messages', 'POST', {
    vehicleId, text: 'Dziękuję za wyjaśnienie.',
  })).status, 201);
  const resolved = await request(owner, '/messages/status', 'PATCH', {
    vehicleId, travelerId, resolved: true,
  });
  assert.equal(resolved.status, 200, JSON.stringify(resolved.data));
  assert.equal(resolved.data.conversation_status, 'resolved');
  assert.equal(resolved.data.resolved_by, owner.user.id);
  assert.ok(resolved.data.resolved_at);
  const stored = (await db.query(
    'SELECT resolved_at,resolved_by FROM message_conversations WHERE vehicle_id=$1 AND traveler_id=$2',
    [vehicleId, travelerId],
  )).rows[0];
  assert.equal(stored.resolved_by, owner.user.id);
  assert.equal(stored.resolved_at.toISOString(), resolved.data.resolved_at);
  for (const account of [owner, traveler]) {
    const list = (await request(account, '/messages' + (account === owner ? '?scope=company' : ''))).data;
    assert.equal(list.find((m) => m.vehicle_id === vehicleId).conversation_status, 'resolved');
  }
  const reopened = await request(owner, '/messages/status', 'PATCH', {
    vehicleId, travelerId, resolved: false,
  });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.data.conversation_status, 'needs_reply');
  assert.equal(reopened.data.resolved_at, null);
  assert.equal(reopened.data.resolved_by, null);
  await request(owner, '/messages/status', 'PATCH', { vehicleId, travelerId, resolved: true });
  assert.equal((await request(owner, '/messages', 'POST', {
    vehicleId, travelerId, text: 'Dodaję jeszcze potwierdzenie.',
  })).status, 201);
  let thread = (await request(owner, '/messages?scope=company')).data.find((m) => m.vehicle_id === vehicleId);
  assert.equal(thread.conversation_status, 'awaiting_reply');
  assert.equal(thread.resolved_at, null);
  assert.equal(thread.resolved_by, null);
  await request(owner, '/messages/status', 'PATCH', { vehicleId, travelerId, resolved: true });
  assert.equal((await request(traveler, '/messages', 'POST', {
    vehicleId, text: 'Mam jeszcze jedno pytanie.',
  })).status, 201);
  thread = (await request(owner, '/messages?scope=company')).data.find((m) => m.vehicle_id === vehicleId);
  assert.equal(thread.conversation_status, 'needs_reply');
  assert.equal(thread.resolved_at, null);
  assert.equal(thread.resolved_by, null);
});
test('only the thread company owner can resolve an existing conversation', async (t) => {
  const vehicleId = await messageVehicle(t), travelerId = traveler.user.id;
  await request(traveler, '/messages', 'POST', { vehicleId, text: 'Prywatne pytanie.' });
  const body = { vehicleId, travelerId, resolved: true };
  assert.equal((await request(null, '/messages/status', 'PATCH', body)).status, 401);
  assert.equal((await request(traveler, '/messages/status', 'PATCH', body)).status, 403);
  assert.equal((await request(admin, '/messages/status', 'PATCH', body)).status, 403);
  assert.equal((await request(otherOwner, '/messages/status', 'PATCH', body)).status, 403);
  assert.equal((await request(otherOwner, '/messages', 'POST', {
    vehicleId, travelerId, text: 'Odpowiedź obcej firmy.',
  })).status, 403);
  assert.ok(!(await request(otherOwner, '/messages?scope=company')).data
    .some((m) => m.vehicle_id === vehicleId));
  assert.equal((await request(owner, '/messages/status', 'PATCH', { ...body, travelerId: 'invalid' })).status, 400);
  assert.equal((await request(owner, '/messages/status', 'PATCH', { ...body, resolved: 'true' })).status, 400);
  assert.equal((await request(owner, '/messages/status', 'PATCH', { ...body, travelerId: other.user.id })).status, 404);
  assert.equal((await request(owner, '/messages/status', 'PATCH', { ...body, travelerId: crypto.randomUUID() })).status, 404);
  assert.equal((await request(owner, '/messages/status', 'PATCH', { ...body, vehicleId: 'missing-vehicle' })).status, 404);
  const stored = (await db.query('SELECT resolved_at FROM message_conversations WHERE vehicle_id=$1', [vehicleId])).rows;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].resolved_at, null);
});
test('concurrent resolution and sending leave the state of the last conversation action', async (t) => {
  const vehicleId = await messageVehicle(t), travelerId = traveler.user.id;
  assert.equal((await request(traveler, '/messages', 'POST', {
    vehicleId, text: 'Pierwsze pytanie.',
  })).status, 201);
  const [resolution, sent] = await Promise.all([
    request(owner, '/messages/status', 'PATCH', { vehicleId, travelerId, resolved: true }),
    request(traveler, '/messages', 'POST', { vehicleId, text: 'Dodatkowe pytanie w trakcie zamykania rozmowy.' }),
  ]);
  assert.equal(resolution.status, 200, JSON.stringify(resolution.data));
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  const state = (await db.query(
    'SELECT resolved_at,resolved_by FROM message_conversations WHERE vehicle_id=$1 AND traveler_id=$2',
    [vehicleId, travelerId],
  )).rows[0];
  const sentAt = Date.parse(sent.data.created_at), resolvedAt = Date.parse(resolution.data.resolved_at);
  // JSON dates have millisecond precision; equal dates cannot establish the order of actions.
  if (sentAt !== resolvedAt) assert.equal(state.resolved_at !== null, sentAt < resolvedAt);
  const isResolved = state.resolved_at !== null;
  assert.equal(state.resolved_by, isResolved ? owner.user.id : null);
  const thread = (await request(owner, '/messages?scope=company')).data
    .find((m) => m.vehicle_id === vehicleId);
  assert.equal(thread.id, sent.data.id);
  assert.equal(thread.conversation_status, isResolved ? 'resolved' : 'needs_reply');
});

test('image uploads are scoped to the company and converted to safe WebP', async () => {
  const image = await fs.readFile('apps/frontoffice/public/assets/campervan.webp');
  const send = async (account, payload, filename) => {
    const form = new FormData(); form.set('file', new Blob([payload]), filename);
    const res = await fetch(`http://127.0.0.1:${apiPort}/api/v1/owner/vehicles/coast/photo`, {method:'POST',headers:{origin:'http://localhost:3100',cookie:account.cookie,'x-csrf-token':account.csrf},body:form});
    return {status:res.status,data:await res.json()};
  };
  assert.equal((await send(otherOwner,image,'photo.webp')).status,403);
  assert.equal((await send(owner,Buffer.from('not an image'),'bad.webp')).status,400);
  const oversized = await send(owner, Buffer.alloc(5 * 1024 * 1024 + 1), 'too-large.webp');
  assert.equal(oversized.status, 413, JSON.stringify(oversized.data));
  assert.match(oversized.data.message, /5 MB/);
  const ok=await send(owner,image,'photo.webp');assert.equal(ok.status,201,JSON.stringify(ok));
  const response=await fetch(`http://127.0.0.1:${apiPort}`+ok.data.asset);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/image\/webp/);
});

test('vehicle photos follow listing visibility and private reads stay within company or booking permissions', async () => {
  const vehicle = (await db.query("SELECT asset,status,company_id FROM vehicles WHERE id='coast'")).rows[0];
  const company = (await db.query('SELECT verified FROM companies WHERE id=$1', [vehicle.company_id])).rows[0];
  assert.match(vehicle.asset, /^\/api\/v1\/media\//);
  const fetchPhoto = (account) => fetch(`http://127.0.0.1:${apiPort}` + vehicle.asset,
    { headers: account ? { cookie: account.cookie } : {} });
  try {
    for (const change of ['draft', 'hidden', 'unverified']) {
      await db.query("UPDATE vehicles SET status=$1 WHERE id='coast'", [change === 'unverified' ? 'published' : change]);
      await db.query('UPDATE companies SET verified=$1 WHERE id=$2', [change !== 'unverified', vehicle.company_id]);
      assert.equal((await fetchPhoto()).status, 404);
      assert.equal((await fetchPhoto(other)).status, 404);
      assert.equal((await fetchPhoto(otherOwner)).status, 404);
      for (const account of [owner, admin, traveler]) {
        const response = await fetchPhoto(account);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'private,no-store');
        await response.arrayBuffer();
      }
    }
  } finally {
    await db.query("UPDATE vehicles SET status=$1 WHERE id='coast'", [vehicle.status]);
    await db.query('UPDATE companies SET verified=$1 WHERE id=$2', [company.verified, vehicle.company_id]);
  }
  const publicPhoto = await fetchPhoto();
  assert.equal(publicPhoto.status, 200);
  assert.equal(publicPhoto.headers.get('cache-control'), 'public,max-age=3600');
  await publicPhoto.arrayBuffer();
});

test('vehicle photo upload rolls back media, asset and file when its audit fails', async () => {
  const previous = (await db.query('SELECT asset FROM vehicles WHERE id=$1', ['coast'])).rows[0].asset;
  const mediaBefore = (await db.query('SELECT count(*)::int n FROM media')).rows[0].n;
  const filesBefore = (await fs.readdir(env.UPLOAD_DIR)).sort();
  await db.query(`CREATE FUNCTION reject_vehicle_photo_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='vehicle.photo_uploaded' THEN RAISE EXCEPTION 'Injected audit failure'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER reject_vehicle_photo_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION reject_vehicle_photo_audit();`);
  try {
    const form = new FormData();
    form.set('file', new Blob([await fs.readFile('apps/frontoffice/public/assets/campervan.webp')]), 'photo.webp');
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/v1/owner/vehicles/coast/photo`, {
      method: 'POST', headers: { origin: 'http://localhost:3100', cookie: owner.cookie, 'x-csrf-token': owner.csrf }, body: form,
    });
    assert.equal(response.status, 500);
    assert.equal((await db.query('SELECT asset FROM vehicles WHERE id=$1', ['coast'])).rows[0].asset, previous);
    assert.equal((await db.query('SELECT count(*)::int n FROM media')).rows[0].n, mediaBefore);
    assert.deepEqual((await fs.readdir(env.UPLOAD_DIR)).sort(), filesBefore);
  } finally {
    await db.query('DROP TRIGGER reject_vehicle_photo_audit ON audit; DROP FUNCTION reject_vehicle_photo_audit();');
  }
});

test('owner settings, calendar unblock and season edits roll back when their audit fails', async () => {
  const company = owner.user.company_id;
  const original = (await db.query('SELECT settings FROM companies WHERE id=$1', [company])).rows[0].settings;
  const block = await request(owner, '/owner/blocks', 'POST', { vehicleId: 'coast', start: day(500), end: day(502), reason: 'Test atomowości' });
  assert.equal(block.status, 201, JSON.stringify(block.data));
  const seasonInput = { vehicleId: 'coast', start: day(500), end: day(502), rate: 63000, name: 'Sezon testu transakcji' };
  const season = await request(owner, '/owner/seasons', 'POST', seasonInput);
  assert.equal(season.status, 201, JSON.stringify(season.data));
  const seasonCount = (await db.query('SELECT count(*)::int n FROM seasons WHERE company_id=$1', [company])).rows[0].n;
  await db.query(`CREATE FUNCTION reject_owner_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action IN('company.settings','calendar.unblocked','season.created','season.deleted') THEN RAISE EXCEPTION 'Injected audit failure'; END IF;
    RETURN NEW; END; $$; CREATE TRIGGER reject_owner_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION reject_owner_audit();`);
  try {
    assert.equal((await request(owner, '/owner/settings', 'PATCH', { minDays: 2, buffer: 1, prep: 19100, open: '09:00', close: '17:00' })).status, 500);
    assert.deepEqual((await db.query('SELECT settings FROM companies WHERE id=$1', [company])).rows[0].settings, original);
    assert.equal((await request(owner, '/owner/blocks/' + block.data.id, 'DELETE')).status, 500);
    assert.equal((await db.query('SELECT active FROM allocations WHERE id=$1', [block.data.id])).rows[0].active, true);
    assert.equal((await request(owner, '/owner/seasons', 'POST', { ...seasonInput, name: 'Nie zostanie zapisany' })).status, 500);
    assert.equal((await db.query('SELECT count(*)::int n FROM seasons WHERE company_id=$1', [company])).rows[0].n, seasonCount);
    assert.equal((await request(owner, '/owner/seasons/' + season.data.id, 'DELETE')).status, 500);
    assert.equal((await db.query('SELECT id FROM seasons WHERE id=$1', [season.data.id])).rows.length, 1);
  } finally {
    await db.query('DROP TRIGGER reject_owner_audit ON audit; DROP FUNCTION reject_owner_audit();');
    await request(owner, '/owner/blocks/' + block.data.id, 'DELETE');
    await request(owner, '/owner/seasons/' + season.data.id, 'DELETE');
  }
});

test('vehicle creation, article updates and job retries roll back when their audit fails', async () => {
  const vehicleCount = (await db.query('SELECT count(*)::int n FROM vehicles')).rows[0].n;
  const originalArticle = (await db.query('SELECT * FROM articles ORDER BY id LIMIT 1')).rows[0];
  const job = (await db.query("INSERT INTO jobs(kind,payload,status,error) VALUES('review-fixture','{}','failed','Review fixture') RETURNING *")).rows[0];
  await db.query(`CREATE FUNCTION reject_admin_write_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action IN('vehicle.created','article.updated','job.retry') THEN RAISE EXCEPTION 'Injected audit failure'; END IF;
    RETURN NEW; END; $$; CREATE TRIGGER reject_admin_write_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION reject_admin_write_audit();`);
  try {
    assert.equal((await request(owner, '/owner/vehicles', 'POST', pickupVehicle())).status, 500);
    assert.equal((await db.query('SELECT count(*)::int n FROM vehicles')).rows[0].n, vehicleCount);
    const articleInput = {
      title: 'Tytuł, który nie powinien zostać zapisany', summary: 'Opis do sprawdzenia transakcji artykułu',
      kind: originalArticle.kind, body: [['Nagłówek', 'Tekst artykułu do testu transakcyjnego.']], published: !originalArticle.published,
    };
    assert.equal((await request(admin, '/admin/articles/' + originalArticle.id, 'PATCH', articleInput)).status, 500);
    assert.deepEqual((await db.query('SELECT * FROM articles WHERE id=$1', [originalArticle.id])).rows[0], originalArticle);
    assert.equal((await request(admin, '/admin/jobs/' + job.id + '/retry', 'POST')).status, 500);
    assert.deepEqual((await db.query('SELECT status,error,next_run FROM jobs WHERE id=$1', [job.id])).rows[0],
      { status: job.status, error: job.error, next_run: job.next_run });
  } finally {
    await db.query('DROP TRIGGER reject_admin_write_audit ON audit; DROP FUNCTION reject_admin_write_audit();');
    await db.query('DELETE FROM jobs WHERE id=$1', [job.id]);
  }
});

async function stockPhotoFixture(t, account = owner) {
  const item = await createStock({ name: 'Wyposażenie ze zdjęciami', vehicleIds: [] }, account);
  t.after(async () => {
    const photos = (await db.query(
      `SELECT m.id,m.filename FROM media m JOIN stock_item_photos sp ON sp.media_id=m.id
        WHERE sp.company_id=$1 AND sp.item_id=$2`, [account.user.company_id, item.id],
    )).rows;
    await db.query('DELETE FROM stock_items WHERE company_id=$1 AND id=$2', [account.user.company_id, item.id]);
    for (const photo of photos) {
      await db.query('DELETE FROM media WHERE id=$1', [photo.id]);
      await fs.unlink(env.UPLOAD_DIR + '/' + photo.filename).catch(() => undefined);
    }
  });
  return item;
}
async function uploadStockPhoto(item, account, image, field = 'file') {
  const form = new FormData();
  form.set(field, new Blob([image]), 'equipment.webp');
  const response = await fetch(`http://127.0.0.1:${apiPort}/api/v1/owner/stock/${item.id}/photos`, {
    method: 'POST',
    headers: { origin: 'http://localhost:3100', ...(account ? { cookie: account.cookie, 'x-csrf-token': account.csrf } : {}) },
    body: form,
  });
  return { status: response.status, data: await response.json() };
}
test('stock photos are persisted in list and update responses and deletion removes the media', async (t) => {
  const item = await stockPhotoFixture(t);
  assert.deepEqual(item.photos, []);
  assert.deepEqual((await stockAt(item)).photos, []);
  const image = await fs.readFile('apps/frontoffice/public/assets/campervan.webp');
  const uploaded = await uploadStockPhoto(item, owner, image);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  assert.match(uploaded.data.id, /^[a-f0-9-]{36}$/);
  assert.equal(uploaded.data.asset, '/api/v1/media/' + uploaded.data.id);
  assert.deepEqual((await stockAt(item)).photos, [uploaded.data]);
  const updated = await request(owner, '/owner/stock/' + item.id, 'PATCH', { name: 'Zmieniona nazwa sprzętu' });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.deepEqual(updated.data.photos, [uploaded.data]);
  const stored = (await db.query(
    `SELECT m.filename,m.public FROM media m JOIN stock_item_photos sp ON sp.media_id=m.id
      WHERE sp.company_id=$1 AND sp.item_id=$2 AND m.id=$3`, [owner.user.company_id, item.id, uploaded.data.id],
  )).rows[0];
  assert.equal(stored.public, true);
  await fs.access(env.UPLOAD_DIR + '/' + stored.filename);
  const preview = await fetch(`http://127.0.0.1:${apiPort}` + uploaded.data.asset);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type'), /^image\/webp/);
  const encoded = Buffer.from(await preview.arrayBuffer());
  assert.equal(encoded.subarray(0, 4).toString(), 'RIFF');
  assert.equal(encoded.subarray(8, 12).toString(), 'WEBP');
  const deleted = await request(owner, `/owner/stock/${item.id}/photos/${uploaded.data.id}`, 'DELETE');
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
  const retriedDelete = await request(owner, `/owner/stock/${item.id}/photos/${uploaded.data.id}`, 'DELETE');
  assert.equal(retriedDelete.status, 200, JSON.stringify(retriedDelete.data));
  assert.deepEqual(retriedDelete.data, { ok: true });
  assert.deepEqual((await stockAt(item)).photos, []);
  assert.equal((await fetch(`http://127.0.0.1:${apiPort}` + uploaded.data.asset)).status, 404);
  await assert.rejects(fs.access(env.UPLOAD_DIR + '/' + stored.filename), { code: 'ENOENT' });
});
test('stock photo writes enforce authentication, company boundaries and actual image input', async (t) => {
  const item = await stockPhotoFixture(t), another = await stockPhotoFixture(t), foreign = await stockPhotoFixture(t, otherOwner);
  const image = await fs.readFile('apps/frontoffice/public/assets/campervan.webp');
  assert.equal((await uploadStockPhoto(item, null, image)).status, 401);
  assert.equal((await uploadStockPhoto(item, traveler, image)).status, 403);
  assert.equal((await uploadStockPhoto(item, otherOwner, image)).status, 404);
  assert.equal((await uploadStockPhoto(item, owner, Buffer.from('Not a real image'))).status, 400);
  assert.equal((await uploadStockPhoto(item, owner, image, 'wrong-field')).status, 400);
  const oversized = await uploadStockPhoto(item, owner, Buffer.alloc(10 * 1024 * 1024 + 1));
  assert.equal(oversized.status, 413, JSON.stringify(oversized.data));
  assert.deepEqual((await stockAt(item)).photos, []);
  const uploaded = await uploadStockPhoto(item, owner, image);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  const foreignUpload = await uploadStockPhoto(foreign, otherOwner, image);
  assert.equal(foreignUpload.status, 201, JSON.stringify(foreignUpload.data));
  const route = `/owner/stock/${item.id}/photos/${uploaded.data.id}`;
  for (const [account, target, status] of [
    [traveler, route, 403],
    [otherOwner, route, 404],
    [owner, `/owner/stock/${another.id}/photos/${uploaded.data.id}`, 404],
    [owner, `/owner/stock/${item.id}/photos/${foreignUpload.data.id}`, 404],
    [owner, `/owner/stock/${item.id}/photos/invalid`, 400],
    [owner, `/owner/stock/${item.id}/photos/${crypto.randomUUID()}`, 200],
  ]) {
    const deleted = await request(account, target, 'DELETE');
    assert.equal(deleted.status, status, JSON.stringify(deleted.data));
  }
  assert.deepEqual((await stockAt(foreign, 100, 110, otherOwner)).photos, [foreignUpload.data]);
  assert.deepEqual((await stockAt(item)).photos, [uploaded.data]);
});
test('simultaneous stock uploads cannot exceed six photos and a deleted slot can be reused', async (t) => {
  const item = await stockPhotoFixture(t);
  const image = await fs.readFile('apps/frontoffice/public/assets/campervan.webp');
  for (let index = 0; index < 5; index++) {
    const uploaded = await uploadStockPhoto(item, owner, image);
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  }
  const uploads = await Promise.all([uploadStockPhoto(item, owner, image), uploadStockPhoto(item, owner, image)]);
  assert.deepEqual(uploads.map((result) => result.status).sort(), [201, 409]);
  let photos = (await stockAt(item)).photos;
  assert.equal(photos.length, 6);
  const linkedMedia = (await db.query(
    'SELECT count(*)::int n FROM stock_item_photos WHERE company_id=$1 AND item_id=$2', [owner.user.company_id, item.id],
  )).rows[0].n;
  assert.equal(linkedMedia, 6);
  assert.equal((await uploadStockPhoto(item, owner, image)).status, 409);
  const removed = photos[2];
  const deleted = await request(owner, `/owner/stock/${item.id}/photos/${removed.id}`, 'DELETE');
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
  const replacement = await uploadStockPhoto(item, owner, image);
  assert.equal(replacement.status, 201, JSON.stringify(replacement.data));
  photos = (await stockAt(item)).photos;
  assert.equal(photos.length, 6);
  assert.equal(photos.at(-1).id, replacement.data.id);
  assert.ok(!photos.some((photo) => photo.id === removed.id));
});

test('stock creation validates all fields and assigns a stable company-scoped ID', async () => {
  const body = { name: '  Nowy stolik  ', quantity: 0, price: 0, unit: 'trip', excludedTypes: [] };
  assert.equal((await request(null, '/owner/stock', 'POST', body)).status, 401);
  assert.equal((await request(traveler, '/owner/stock', 'POST', body)).status, 403);
  const invalid = [
    { name: '  ' }, { name: 'x' }, { name: 'x'.repeat(101) },
    { quantity: -1 }, { quantity: 1001 }, { quantity: 1.5 }, { quantity: '2' },
    { price: -1 }, { price: 1000001 }, { price: 1.5 },
    { unit: 'week' }, { excludedTypes: ['minivan'] }, { excludedTypes: ['semi', 'semi'] },
    { excludedTypes: null }, { active: false }, { id: 'client-id' },
    { company_id: otherOwner.user.company_id },
  ];
  for (const change of invalid) {
    const r = await request(owner, '/owner/stock', 'POST', { ...body, ...change });
    assert.equal(r.status, 400, JSON.stringify({ change, response: r.data }));
  }
  const missing = { ...body };
  delete missing.unit;
  assert.equal((await request(owner, '/owner/stock', 'POST', missing)).status, 400);
  const created = await request(owner, '/owner/stock', 'POST', body);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.match(created.data.id, /^stock-[0-9a-f-]{36}$/);
  assert.equal(created.data.name, 'Nowy stolik');
  assert.equal(created.data.company_id, owner.user.company_id);
  assert.equal(created.data.active, true);
  assert.equal(created.data.minimum_quantity, 0);
  assert.equal(created.data.available, 0);
  assert.equal((await stockAt(created.data)).id, created.data.id);
  const upper = await createStock({
    name: 'x'.repeat(100), quantity: 1000, price: 1000000,
    excludedTypes: ['campervan', 'semi', 'alcove', 'offroad', 'trailer'],
  });
  assert.equal(upper.excluded_types.length, 5);
});

test('partial stock updates preserve omitted values and enforce tenant isolation', async () => {
  const item = await createStock();
  const foreign = await createStock({ name: 'Sprzęt innej firmy' }, otherOwner);
  assert.equal(await stockAt(item, 100, 110, otherOwner), undefined);
  assert.equal(await stockAt(foreign), undefined);
  assert.equal((await request(otherOwner, '/owner/stock/' + item.id, 'PATCH', { price: 1 })).status, 404);
  assert.equal((await request(otherOwner, '/owner/stock/' + item.id, 'PATCH', { active: false })).status, 404);
  assert.equal((await request(traveler, '/owner/stock/' + item.id, 'PATCH', { quantity: 1 })).status, 403);
  for (const body of [{}, { unknown: true }, { price: 1001, company_id: otherOwner.user.company_id },
    { name: ' ' }, { quantity: 2.5 }, { unit: 'hour' }, { active: 'false' },
    { excludedTypes: ['unknown'] }, { excludedTypes: ['trailer', 'trailer'] }]) {
    assert.equal((await request(owner, '/owner/stock/' + item.id, 'PATCH', body)).status, 400, JSON.stringify(body));
  }
  const renamed = await request(owner, '/owner/stock/' + item.id, 'PATCH', { name: '  Składane krzesło  ' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.name, 'Składane krzesło');
  assert.equal(renamed.data.quantity, item.quantity);
  assert.equal(renamed.data.price, item.price);
  assert.equal(renamed.data.unit, item.unit);
  await Promise.all([
    request(owner, '/owner/stock/' + item.id, 'PATCH', { price: 1500, unit: 'trip' }),
    request(owner, '/owner/stock/' + item.id, 'PATCH', { quantity: 7, excludedTypes: ['trailer'] }),
  ]).then((results) => results.forEach((r) => assert.equal(r.status, 200, JSON.stringify(r.data))));
  const updated = await stockAt(item);
  assert.equal(updated.quantity, 7);
  assert.equal(updated.price, 1500);
  assert.equal(updated.unit, 'trip');
  assert.deepEqual(updated.excluded_types, ['trailer']);
  assert.equal((await stockAt(foreign, 100, 110, otherOwner)).price, foreign.price);
  assert.equal((await request(owner, '/owner/stock/missing', 'PATCH', { price: 100 })).status, 404);
  const updateAudit = await db.query("SELECT count(*)::int n FROM audit WHERE company_id=$1 AND resource=$2 AND action='stock.updated'",
    [owner.user.company_id, item.id]);
  assert.equal(updateAudit.rows[0].n, 3);
});

test('active stock vehicle restrictions and charging units are enforced by quotes', async () => {
  const vehicle = (await request(null, '/vehicles/coast')).data;
  const item = await createStock({ excludedTypes: [vehicle.type], unit: 'trip', price: 2300 });
  assert.equal((await request(traveler, '/quotes', 'POST', input('coast', 120, 125, { [item.id]: 2 }))).status, 400);
  assert.equal((await request(owner, '/owner/stock/' + item.id, 'PATCH', { excludedTypes: [] })).status, 200);
  const trip = await quote(traveler, input('coast', 120, 125, { [item.id]: 2 }));
  assert.equal(trip.equipmentMinor, 4600);
  assert.equal((await request(owner, '/owner/stock/' + item.id, 'PATCH', { unit: 'day' })).status, 200);
  const daily = await quote(traveler, input('coast', 120, 125, { [item.id]: 2 }));
  assert.equal(daily.equipmentMinor, 23000);
});

test('owner stock reports interval peak and the minimum across all future bookings', async () => {
  const item = await createStock({ quantity: 5 });
  const a = await hold(traveler, input('coast', 100, 103, { [item.id]: 3 }));
  const b = await hold(other, input('wild', 100, 103, { [item.id]: 2 }));
  const c = await hold(traveler, input('coast', 105, 108, { [item.id]: 3 }));
  try {
    const overlapping = await stockAt(item, 100, 108);
    assert.equal(overlapping.reserved, 5);
    assert.equal(overlapping.available, 0);
    assert.equal(overlapping.minimum_quantity, 5);
    const emptyInterval = await stockAt(item, 110, 115);
    assert.equal(emptyInterval.reserved, 0);
    assert.equal(emptyInterval.available, 5);
    assert.equal(emptyInterval.minimum_quantity, 5);
    const denied = await request(owner, '/owner/stock/' + item.id, 'PATCH', { quantity: 4 });
    assert.equal(denied.status, 409);
    assert.match(denied.data.message, /5 szt/);
    assert.equal((await stockAt(item)).quantity, 5);
    assert.equal((await request(owner, '/owner/stock/' + item.id, 'PATCH', { price: 2500 })).status, 200);
    await request(other, '/bookings/' + b.id + '/cancel', 'POST');
    assert.equal((await stockAt(item)).minimum_quantity, 3);
    assert.equal((await request(owner, '/owner/stock/' + item.id, 'PATCH', { quantity: 3 })).status, 200);
    await db.query("UPDATE bookings SET hold_until=now()-interval '1 second' WHERE id=$1", [a.id]);
    assert.equal((await stockAt(item, 100, 104)).reserved, 0);
    assert.equal((await stockAt(item)).minimum_quantity, 3);
    // Stale active statuses entirely in the past must not lock today's stock.
    await db.query('UPDATE bookings SET start_date=$1,end_date=$2 WHERE id=$3', [day(-10), day(-5), c.id]);
    assert.equal((await stockAt(item)).minimum_quantity, 0);
    assert.equal((await request(owner, '/owner/stock/' + item.id, 'PATCH', { quantity: 0 })).status, 200);
  } finally {
    for (const booking of [a, b, c]) await request(traveler.user.id === booking.user_id ? traveler : other,
      '/bookings/' + booking.id + '/cancel', 'POST');
  }
});

test('archiving preserves booked extras and history while blocking new quotes and stale holds', async () => {
  const item = await createStock({ name: 'Pierwotne krzesło', quantity: 4 });
  const b = await hold(traveler, input('coast', 140, 145, { [item.id]: 2 }));
  const paid = await pay(traveler, b);
  assert.equal(paid.status, 201);
  const originalSnapshot = paid.data.snapshot;
  const originalExtras = paid.data.extras;
  const stale = await quote(other, input('wild', 140, 145, { [item.id]: 1 }));
  try {
    const archived = await request(owner, '/owner/stock/' + item.id, 'PATCH', {
      active: false, name: 'Nowa nazwa', price: 9900, unit: 'trip', excludedTypes: ['campervan'],
    });
    assert.equal(archived.status, 200);
    assert.equal(archived.data.active, false);
    const detail = await request(traveler, '/bookings/' + b.id);
    assert.deepEqual(detail.data.snapshot, originalSnapshot);
    assert.deepEqual(detail.data.extras, originalExtras);
    const ownerItem = await stockAt(item, 140, 145);
    assert.equal(ownerItem.active, false);
    assert.equal(ownerItem.reserved, 2);
    assert.equal(ownerItem.available, 2);
    assert.equal(ownerItem.minimum_quantity, 2);
    const publicVehicle = await request(null, '/vehicles/coast');
    assert.ok(!publicVehicle.data.equipment.some((e) => e.id === item.id));
    assert.equal((await request(other, '/quotes', 'POST', input('wild', 140, 145, { [item.id]: 1 }))).status, 400);
    assert.equal((await request(null, '/preview-quote', 'POST', input('wild', 140, 145, { [item.id]: 1 }))).status, 400);
    assert.equal((await request(other, '/holds', 'POST', { quoteId: stale.id })).status, 400);
    const increased = await request(traveler, '/bookings/' + b.id + '/amendments', 'POST', {
      start: day(140), end: day(146), extras: { [item.id]: 3 },
    });
    assert.equal(increased.status, 400);
    const retained = await request(traveler, '/bookings/' + b.id + '/amendments', 'POST', {
      start: day(140), end: day(146),
    });
    assert.equal(retained.status, 201, JSON.stringify(retained.data));
    assert.equal(retained.data.snapshot.extras[0].name, 'Pierwotne krzesło');
    assert.equal(retained.data.snapshot.extras[0].price, 1000);
    assert.equal(retained.data.snapshot.extras[0].unit, 'day');
    assert.equal(retained.data.snapshot.extras[0].total, 12000);
    const accepted = await request(owner, '/amendments/' + retained.data.id + '/decision', 'POST', { accept: true });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
    assert.deepEqual(accepted.data.amendments[0].previous.snapshot, originalSnapshot);
    const reduced = await request(traveler, '/bookings/' + b.id + '/amendments', 'POST', {
      start: day(140), end: day(146), extras: { [item.id]: 1 },
    });
    assert.equal(reduced.status, 201, JSON.stringify(reduced.data));
    const reducedAccepted = await request(owner, '/amendments/' + reduced.data.id + '/decision', 'POST', { accept: true });
    assert.equal(reducedAccepted.status, 201, JSON.stringify(reducedAccepted.data));
    assert.equal(reducedAccepted.data.extras[0].quantity, 1);
    assert.equal(reducedAccepted.data.extras[0].price, 1000);
    const restored = await request(owner, '/owner/stock/' + item.id, 'PATCH', { active: true, excludedTypes: [] });
    assert.equal(restored.status, 200);
    assert.equal(restored.data.id, item.id);
    assert.equal((await stockAt(item)).active, true);
    assert.ok((await request(null, '/vehicles/coast')).data.equipment.some((e) => e.id === item.id));
    const fresh = await quote(other, input('wild', 140, 146, { [item.id]: 1 }));
    assert.equal(fresh.extras[0].price, 9900);
    assert.equal(fresh.extras[0].unit, 'trip');
    assert.equal(fresh.equipmentMinor, 9900);
    const actions = (await db.query('SELECT action FROM audit WHERE company_id=$1 AND resource=$2 ORDER BY created_at',
      [owner.user.company_id, item.id])).rows.map((r) => r.action);
    assert.deepEqual(actions, ['stock.created', 'stock.archived', 'stock.restored']);
  } finally {
    await request(traveler, '/bookings/' + b.id + '/cancel', 'POST');
  }
});

test('archived extras cannot be introduced into a booking which did not order them', async () => {
  const item = await createStock();
  const b = await hold(traveler, input('coast', 160, 165));
  assert.equal((await pay(traveler, b)).status, 201);
  try {
    assert.equal((await request(owner, '/owner/stock/' + item.id, 'PATCH', { active: false })).status, 200);
    assert.equal((await request(traveler, '/bookings/' + b.id + '/amendments', 'POST', {
      start: day(160), end: day(165), extras: { [item.id]: 1 },
    })).status, 400);
  } finally {
    await request(traveler, '/bookings/' + b.id + '/cancel', 'POST');
  }
});

test('a stock reduction concurrent with a hold cannot produce under-covered bookings', async () => {
  const item = await createStock({ quantity: 2 });
  const q = await quote(traveler, input('coast', 180, 185, { [item.id]: 2 }));
  const blocker = await db.connect();
  let holdResult;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM stock_items WHERE company_id=$1 AND id=$2 FOR UPDATE',
      [owner.user.company_id, item.id]);
    const patchPromise = request(owner, '/owner/stock/' + item.id, 'PATCH', { quantity: 1 });
    const holdPromise = request(traveler, '/holds', 'POST', { quoteId: q.id });
    await blocker.query('COMMIT');
    const [patch, held] = await Promise.all([patchPromise, holdPromise]);
    holdResult = held;
    assert.ok(
      (patch.status === 200 && held.status === 409) || (patch.status === 409 && held.status === 201),
      JSON.stringify({ patch, held }),
    );
    const actual = await stockAt(item, 180, 185);
    assert.ok(actual.quantity >= actual.reserved);
    assert.ok(actual.quantity >= actual.minimum_quantity);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    if (holdResult?.status === 201) await request(traveler, '/bookings/' + holdResult.data.id + '/cancel', 'POST');
  }
});

test('stock vehicle migration preserves legacy rules for the existing fleet', async () => {
  const client = await db.connect();
  const schema = 'stock_migration_' + crypto.randomUUID().replaceAll('-', '');
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path="${schema}",public`);
    await client.query(`CREATE TABLE vehicles(id text PRIMARY KEY,company_id text NOT NULL,type text NOT NULL);
      CREATE TABLE stock_items(company_id text NOT NULL,id text NOT NULL,excluded_types jsonb NOT NULL,active boolean NOT NULL,PRIMARY KEY(company_id,id));
      INSERT INTO vehicles VALUES('a1','a','campervan'),('a2','a','campervan'),('a3','a','semi'),('b1','b','campervan');
      INSERT INTO stock_items VALUES('a','all','[]',true),('a','limited','["semi"]',false),('b','all','[]',true);`);
    await client.query(await fs.readFile('db/migrations/006_stock_vehicles.sql', 'utf8'));
    const links = (await client.query('SELECT company_id,item_id,vehicle_id FROM stock_item_vehicles ORDER BY company_id,item_id,vehicle_id')).rows;
    assert.deepEqual(links, [
      { company_id: 'a', item_id: 'all', vehicle_id: 'a1' },
      { company_id: 'a', item_id: 'all', vehicle_id: 'a2' },
      { company_id: 'a', item_id: 'all', vehicle_id: 'a3' },
      { company_id: 'a', item_id: 'limited', vehicle_id: 'a1' },
      { company_id: 'a', item_id: 'limited', vehicle_id: 'a2' },
      { company_id: 'b', item_id: 'all', vehicle_id: 'b1' },
    ]);
    await assert.rejects(client.query("INSERT INTO stock_item_vehicles VALUES('a','all','b1')"),
      (error) => error.code === '23503');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

test('stock vehicle selections distinguish vehicles of the same type and reject foreign IDs', async () => {
  const a = await createPickupVehicle({ status: 'published', lat: 54, lng: 18, name: 'Pierwszy campervan' });
  const b = await createPickupVehicle({ status: 'published', lat: 54, lng: 18, name: 'Drugi campervan' });
  const draft = await createPickupVehicle({ status: 'draft', lat: 54, lng: 18 });
  const hidden = await createPickupVehicle({ status: 'hidden', lat: 54, lng: 18 });
  const body = { name: 'Bagażnik tylko pierwszego', quantity: 4, price: 500, unit: 'trip', vehicleIds: [a, draft, hidden] };
  for (const ids of [['family'], [a, 'family'], [a, a], ['missing-vehicle'], [123], null]) {
    const failed = await request(owner, '/owner/stock', 'POST', { ...body, vehicleIds: ids });
    assert.equal(failed.status, 400, JSON.stringify(failed.data));
  }
  const created = await request(owner, '/owner/stock', 'POST', body);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const item = created.data;
  assert.deepEqual(item.vehicle_ids, [a, draft, hidden].sort());
  assert.deepEqual((await stockAt(item)).vehicle_ids, item.vehicle_ids);
  assert.equal((await request(owner, '/owner/stock/' + item.id, 'PATCH', { vehicleIds: ['family'] })).status, 400);
  assert.equal((await request(otherOwner, '/owner/stock/' + item.id, 'PATCH', { vehicleIds: ['family'] })).status, 404);
  assert.deepEqual((await stockAt(item)).vehicle_ids, item.vehicle_ids);
  assert.ok((await request(null, '/vehicles/' + a)).data.equipment.some((e) => e.id === item.id));
  assert.ok(!(await request(null, '/vehicles/' + b)).data.equipment.some((e) => e.id === item.id));
  await quote(traveler, input(a, 210, 215, { [item.id]: 1 }));
  assert.equal((await request(traveler, '/quotes', 'POST', input(b, 210, 215, { [item.id]: 1 }))).status, 400);
  const stale = await quote(traveler, input(a, 210, 215, { [item.id]: 1 }));
  const moved = await request(owner, '/owner/stock/' + item.id, 'PATCH', { vehicleIds: [b] });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.deepEqual(moved.data.vehicle_ids, [b]);
  for (const key of ['name', 'quantity', 'price', 'unit']) assert.equal(moved.data[key], item[key]);
  assert.equal((await request(traveler, '/holds', 'POST', { quoteId: stale.id })).status, 400);
  assert.equal((await request(null, '/preview-quote', 'POST', input(a, 210, 215, { [item.id]: 1 }))).status, 400);
  assert.ok(!(await request(null, '/vehicles/' + a)).data.equipment.some((e) => e.id === item.id));
  const publicItem = (await request(null, '/vehicles/' + b)).data.equipment.find((e) => e.id === item.id);
  assert.ok(publicItem);
  assert.deepEqual(publicItem.excluded_types, []);
  await quote(traveler, input(b, 210, 215, { [item.id]: 1 }));
  await request(owner, '/owner/stock/' + item.id, 'PATCH', { vehicleIds: [] });
  assert.deepEqual((await stockAt(item)).vehicle_ids, []);
  assert.equal((await request(traveler, '/quotes', 'POST', input(b, 210, 215, { [item.id]: 1 }))).status, 400);
  const unassigned = await request(owner, '/owner/stock', 'POST', { name: 'Przyszły dodatek', quantity: 1, price: 0, unit: 'trip' });
  assert.equal(unassigned.status, 201, JSON.stringify(unassigned.data));
  assert.deepEqual(unassigned.data.vehicle_ids, []);
  assert.equal((await request(traveler, '/quotes', 'POST', input(a, 210, 215, { [unassigned.data.id]: 1 }))).status, 400);
});

test('reassigning stock preserves existing bookings and amendment prices without allowing increases', async () => {
  const item = await createStock({ excludedTypes: undefined, vehicleIds: ['coast'], name: 'Stary bagażnik', quantity: 4 });
  const booking = await hold(traveler, input('coast', 230, 235, { [item.id]: 2 }));
  const paid = await pay(traveler, booking);
  assert.equal(paid.status, 201, JSON.stringify(paid.data));
  try {
    const moved = await request(owner, '/owner/stock/' + item.id, 'PATCH', {
      vehicleIds: ['wild'], name: 'Nowy bagażnik', price: 8000, unit: 'trip',
    });
    assert.equal(moved.status, 200);
    const preserved = (await request(traveler, '/bookings/' + booking.id)).data;
    assert.deepEqual(preserved.snapshot, paid.data.snapshot);
    assert.deepEqual(preserved.extras, paid.data.extras);
    assert.equal((await stockAt(item, 230, 235)).reserved, 2);
    assert.equal((await request(traveler, '/quotes', 'POST', input('coast', 240, 245, { [item.id]: 1 }))).status, 400);
    const offered = await quote(other, input('wild', 230, 235, { [item.id]: 1 }));
    assert.equal(offered.extras[0].price, 8000);
    assert.equal((await request(traveler, '/bookings/' + booking.id + '/amendments', 'POST', {
      start: day(230), end: day(236), extras: { [item.id]: 3 },
    })).status, 400);
    const amendment = await request(traveler, '/bookings/' + booking.id + '/amendments', 'POST', {
      start: day(230), end: day(236),
    });
    assert.equal(amendment.status, 201, JSON.stringify(amendment.data));
    assert.equal(amendment.data.snapshot.extras[0].name, 'Stary bagażnik');
    assert.equal(amendment.data.snapshot.extras[0].price, 1000);
    assert.equal(amendment.data.snapshot.extras[0].unit, 'day');
    const accepted = await request(owner, '/amendments/' + amendment.data.id + '/decision', 'POST', { accept: true });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
    assert.deepEqual(accepted.data.amendments[0].previous.snapshot, paid.data.snapshot);
    const reduced = await request(traveler, '/bookings/' + booking.id + '/amendments', 'POST', {
      start: day(230), end: day(236), extras: { [item.id]: 1 },
    });
    assert.equal(reduced.status, 201, JSON.stringify(reduced.data));
    const reducedAccepted = await request(owner, '/amendments/' + reduced.data.id + '/decision', 'POST', { accept: true });
    assert.equal(reducedAccepted.status, 201);
    assert.equal(reducedAccepted.data.extras[0].quantity, 1);
    assert.equal(reducedAccepted.data.extras[0].price, 1000);
  } finally {
    await request(traveler, '/bookings/' + booking.id + '/cancel', 'POST');
  }
});

test('stock reassignment and concurrent holds are serialized without vehicle FK deadlocks', { timeout: 5000 }, async () => {
  const item = await createStock({ excludedTypes: undefined, vehicleIds: ['coast'] });
  const quoted = await quote(traveler, input('coast', 250, 255, { [item.id]: 1 }));
  const lock = await db.connect();
  let held;
  async function waitForLock(query) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const pending = await db.query(
        "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND query=$2 AND wait_event_type='Lock'",
        [testApplication, query],
      );
      if (pending.rowCount) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail('Expected the isolated API request to wait on the inventory lock.');
  }
  try {
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM stock_items WHERE company_id=$1 AND id=$2 FOR UPDATE', [owner.user.company_id, item.id]);
    // Queue the assignment first, then a hold which locks its vehicle before waiting on stock.
    const assigning = request(owner, '/owner/stock/' + item.id, 'PATCH', { vehicleIds: ['coast', 'wild'] });
    await waitForLock('SELECT * FROM stock_items WHERE company_id=$1 AND id=$2 FOR UPDATE');
    const holding = request(traveler, '/holds', 'POST', { quoteId: quoted.id });
    await waitForLock('SELECT * FROM stock_items WHERE company_id=$1 ORDER BY id FOR UPDATE');
    await lock.query('COMMIT');
    const [updated, holdResult] = await Promise.all([assigning, holding]);
    held = holdResult;
    assert.equal(updated.status, 200, JSON.stringify(updated.data));
    assert.equal(held.status, 201, JSON.stringify(held.data));
    assert.deepEqual((await stockAt(item)).vehicle_ids, ['coast', 'wild']);
    if (held.status === 201) assert.equal((await request(traveler, '/bookings/' + held.data.id)).data.extras[0].item_id, item.id);
  } finally {
    await lock.query('ROLLBACK');lock.release();
    if (held?.status === 201) await request(traveler, '/bookings/' + held.data.id + '/cancel', 'POST');
  }
});

test('stock seed reruns preserve explicit vehicle selections on existing items', async () => {
  const selected = await request(owner, '/owner/stock/chair', 'PATCH', { vehicleIds: ['coast'] });
  assert.equal(selected.status, 200, JSON.stringify(selected.data));
  execFileSync(process.execPath, ['scripts/seed.mjs'], { env, stdio: 'pipe' });
  assert.deepEqual((await stockAt({ id: 'chair' })).vehicle_ids, ['coast']);
});

test('account notifications share the business transaction and reset tokens expire', async () => {
  const email = 'mailer.account@vanly.example';
  const registered = await request(null, '/auth/register', 'POST', {
    email, name: 'Anna Przykładowa', password: 'LocalMailerTest!2026',
  });
  assert.equal(registered.status, 201);
  const accountId = registered.data.user.id;
  const unknown = await request(null, '/auth/forgot', 'POST', { email: 'not.registered@vanly.example' });
  const known = await request(null, '/auth/forgot', 'POST', { email });
  assert.equal(known.status, unknown.status);
  assert.equal(known.data.message, unknown.data.message);
  const repeated = await Promise.all(Array.from({ length: 6 }, () =>
    request(null, '/auth/forgot', 'POST', { email }),
  ));
  assert.ok(repeated.every((response) =>
    response.status === known.status && response.data.message === known.data.message,
  ));
  const queued = (await db.query(
    "SELECT * FROM jobs WHERE recipient_user_id=$1 ORDER BY id", [accountId],
  )).rows;
  assert.equal(queued.length, 3);
  assert.ok(queued.some(row => row.event_key === 'account.created:' + accountId));
  assert.equal(queued.filter(row => row.payload.template === '01-weryfikacja-adresu').length, 1);
  const passwordReset = queued.find(row => row.payload.template === '02-reset-hasla');
  assert.ok(passwordReset);
  const expiry = new Date(passwordReset.payload.expiresAt).getTime();
  assert.ok(expiry > Date.now() && expiry <= Date.now() + 30 * 60000);
  const token = new URL(passwordReset.payload.variables.action_url).searchParams.get('token');
  await db.query("UPDATE reset_tokens SET created_at=now()-interval '6 minutes' WHERE user_id=$1", [accountId]);
  assert.equal((await request(null, '/auth/forgot', 'POST', { email })).status, 201);
  const another = (await db.query(
    "SELECT payload FROM jobs WHERE recipient_user_id=$1 AND payload->>'template'='02-reset-hasla' ORDER BY id DESC LIMIT 1",
    [accountId],
  )).rows[0];
  const anotherToken = new URL(another.payload.variables.action_url).searchParams.get('token');
  assert.notEqual(anotherToken, token);
  const reset = await request(null, '/auth/reset', 'POST', {
    token, password: 'LocalMailerChanged!2026',
  });
  assert.equal(reset.status, 201);
  assert.equal((await request(null, '/auth/reset', 'POST', {
    token, password: 'LocalMailerChanged!2026',
  })).status, 400);
  assert.equal((await request(null, '/auth/reset', 'POST', {
    token: anotherToken, password: 'LocalMailerChanged!2026',
  })).status, 400, 'A password change invalidates every outstanding reset link');
  const changed = (await db.query(
    "SELECT * FROM jobs WHERE recipient_user_id=$1 AND event_key LIKE 'account.password_changed:%'", [accountId],
  )).rows;
  assert.equal(changed.length, 1);
  assert.ok(!changed[0].payload.body.includes(token));

  // Inject a queue write failure in the isolated test DB to verify all-or-nothing signup.
  await db.query(`CREATE FUNCTION test_reject_mail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.event_key LIKE 'account.created:%' AND EXISTS(
        SELECT 1 FROM users WHERE id=NEW.recipient_user_id AND email='mailer.rollback@vanly.example'
      ) THEN RAISE EXCEPTION 'TEST_OUTBOX_FAILURE'; END IF;
      RETURN NEW;
    END $$`);
  await db.query('CREATE TRIGGER test_reject_mail_outbox BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION test_reject_mail_outbox()');
  try {
    const failed = await request(null, '/auth/register', 'POST', {
      email: 'mailer.rollback@vanly.example', name: 'Test Transakcji', password: 'LocalMailerTest!2026',
    });
    assert.equal(failed.status, 500);
    assert.equal((await db.query("SELECT id FROM users WHERE email='mailer.rollback@vanly.example'")).rows.length, 0);
  } finally {
    await db.query('DROP TRIGGER test_reject_mail_outbox ON jobs');
    await db.query('DROP FUNCTION test_reject_mail_outbox()');
  }
});

test('booking notifications describe committed states and preserve test-payment labels', async () => {
  const rows = (await db.query(
    "SELECT event_key,payload FROM jobs WHERE event_key LIKE 'booking.%' OR event_key LIKE 'payment.%' ORDER BY id",
  )).rows;
  const pending = rows.find(row => row.event_key.startsWith('booking.request_submitted:'));
  const ownerRequest = rows.find(row => row.event_key.startsWith('booking.request_received:'));
  const confirmed = rows.find(row => row.event_key.startsWith('booking.confirmed:'));
  const cancellations = rows.filter(row => row.event_key.startsWith('booking.cancelled:'));
  const cancellation = cancellations.find(row => row.payload.body.includes('Rozliczenie oczekuje na zwrot'));
  const refund = rows.find(row => row.event_key.startsWith('payment.refund:'));
  assert.match(pending.payload.body, /Wyjazd nie jest jeszcze potwierdzony/);
  assert.ok(ownerRequest, 'A booking request must notify its rental company.');
  assert.equal(new URL(ownerRequest.payload.variables.action_url).pathname,
    '/company/booking/' + ownerRequest.event_key.slice('booking.request_received:'.length));
  assert.match(confirmed.payload.subject, /potwierdzona/);
  assert.match(confirmed.payload.body, /Kaucja, rozliczana osobno/);
  assert.match(cancellation.payload.body, /To nie jest potwierdzenie wykonania zwrotu/);
  assert.ok(cancellations.some(row => !row.payload.body.includes('Rozliczenie oczekuje na zwrot')),
    'An unpaid cancelled hold must not claim a refund is pending.');
  assert.match(refund.payload.body, /Nie pobrano ani nie wypłacono rzeczywistych pieniędzy/);
  const duplicates = (await db.query(
    'SELECT recipient_user_id,event_key,count(*) FROM jobs WHERE event_key IS NOT NULL GROUP BY 1,2 HAVING count(*)>1',
  )).rows;
  assert.equal(duplicates.length, 0);
});

test('public-reply mail waits for publication and unchanged replies are deduplicated', async () => {
  const question = await request(traveler, '/vehicles/coast/questions', 'POST', {
    text: 'Czy przykładowy kamper ma ogrzewanie postojowe?',
  });
  assert.equal(question.status, 201);
  const reply = { text: 'Tak, ogrzewanie jest dostępne w tym pojeździe.' };
  assert.equal((await request(owner, '/comments/' + question.data.id + '/reply', 'POST', reply)).status, 201);
  const count = async () => (await db.query(
    "SELECT count(*)::int n FROM jobs WHERE event_key LIKE $1", ['comment.reply:' + question.data.id + ':%'],
  )).rows[0].n;
  assert.equal(await count(), 0);
  assert.equal((await request(admin, '/admin/comments/' + question.data.id + '/moderate', 'POST', {
    status: 'published', reason: 'Pytanie nadaje się do publikacji.',
  })).status, 201);
  assert.equal(await count(), 1);
  await request(owner, '/comments/' + question.data.id + '/reply', 'POST', reply);
  assert.equal(await count(), 1);
});

test('private-message mail waits for the unread window, targets participants and excludes conversation text', async () => {
  const text = 'Prywatny numer telefonu do odbioru 555-111-222';
  const startedAt = new Date();
  const producerConfig = loadNotificationConfig({
    MAIL_REMINDERS_ENABLED: 'true', NOTIFICATION_START_AFTER: startedAt.toISOString(),
    MAIL_REMINDERS_SEND_HOUR: '23', APP_URL: 'http://localhost:3100',
  });
  const sent = await request(traveler, '/messages', 'POST', { vehicleId: 'coast', text });
  assert.equal(sent.status, 201);
  const noticesFor = async (messageId) => (await db.query(
    "SELECT j.*,u.email,u.name FROM jobs j JOIN users u ON u.id=j.recipient_user_id WHERE j.payload->'notificationGuard'->>'messageId'=$1", [messageId],
  )).rows;
  assert.equal((await noticesFor(sent.data.id)).length, 0, 'A chat bubble must not immediately queue email');
  await new ReminderProducer(db, { config: producerConfig, now: () => startedAt }).tick();
  assert.equal((await noticesFor(sent.data.id)).length, 0, 'A fresh unread message must wait five minutes');
  await new ReminderProducer(db, { config: producerConfig, now: () => new Date(Date.now() + 6 * 60000) }).tick();
  const first = await noticesFor(sent.data.id);
  assert.ok(first.length >= 1);
  const owners = (await db.query("SELECT id FROM users WHERE company_id=$1 AND role='owner'", [owner.user.company_id])).rows;
  assert.deepEqual(first.map(row => row.recipient_user_id).sort(), owners.map(row => row.id).sort());
  assert.ok(first.every(row => new URL(row.payload.variables.action_url).pathname === '/company/messages'));
  assert.ok(first.every(row => !row.payload.body.includes(text) && !JSON.stringify(row.payload).includes('555-111-222')));
  const replied = await request(owner, '/messages', 'POST', { vehicleId: 'coast', travelerId: traveler.user.id, text: 'Potwierdzamy odbiór pojazdu.' });
  assert.equal(replied.status, 201);
  assert.equal((await noticesFor(replied.data.id)).length, 0);
  await new ReminderProducer(db, { config: producerConfig, now: () => new Date(Date.now() + 6 * 60000) }).tick();
  const second = await noticesFor(replied.data.id);
  assert.equal(second.length, 1);
  assert.equal(second[0].recipient_user_id, traveler.user.id);
  assert.match(second[0].payload.variables.action_url, /\/konto\/wiadomosci$/);
  const deliveries = [], outcomes = [];
  const mailer = new MailerService(db, {
    config: loadMailerConfig({
      MAIL_PROVIDER: 'ses', MAIL_SES_ENABLED: 'true',
      MAIL_DEPLOYMENT_ENVIRONMENT: 'local', MAIL_TEST_MODE: 'true',
      MAIL_TEST_RECIPIENT: 'wydmuch@gmail.com', AWS_PROFILE: 'vanly-mailer-local-test',
      MAIL_SES_START_AFTER: startedAt.toISOString(), APP_URL: 'http://localhost:3100',
      MAIL_FROM: 'portal@vanly.me', MAIL_REPLY_TO: 'info@wydmuch.xyz',
      MAIL_SENDER_LEGAL_NAME: 'Operator testowy', MAIL_SENDER_LEGAL_ADDRESS: 'Adres testowy',
      MAIL_SENDER_REGISTRATION_DETAILS: 'Dane testowe',
    }),
    provider: { name: 'ses', async send(message, job) {
      deliveries.push({ message, job });
      return { status: 'accepted', messageId: 'mock-private-message' };
    } },
    queue: { async finish(_job, outcome) { outcomes.push(outcome); } },
    notificationGuard: (job) => validateNotificationGuard(db, job),
  });
  try {
    assert.equal(await mailer.process({ ...second[0], attempts: 1 }), 'accepted');
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].job.email, 'wydmuch@gmail.com');
    assert.equal(deliveries[0].job.recipient_user_id, traveler.user.id);
    assert.match(deliveries[0].message.subject, /^VANLY-TEST: /);
    assert.doesNotMatch(deliveries[0].message.html + deliveries[0].message.text, /555-111-222|Potwierdzamy odbiór pojazdu/);
    assert.equal(second[0].email, traveler.user.email, 'Test routing must preserve the business recipient');
    assert.equal((await request(traveler, '/messages?vehicle=coast')).status, 200);
    assert.equal(await mailer.process({ ...second[0], attempts: 1 }), 'dead');
    assert.equal(deliveries.length, 1, 'Reading the conversation must prevent a later provider request');
    assert.equal(outcomes[1].code, 'NOTIFICATION_NO_LONGER_APPLICABLE');
  } finally { mailer.close(); }
});

test('reset links preserve the trusted brand origin and enforce the IP request limit', async () => {
  const recoveryEmail = 'mailer.brand@vanly.example';
  const registered = await request(null, '/auth/register', 'POST', {
    email: recoveryEmail, name: 'Marka Testowa', password: 'LocalMailerTest!2026',
  });
  assert.equal(registered.status, 201);
  const headers = { origin: 'https://camperfolks.example', 'x-forwarded-for': '203.0.113.20' };
  const known = await request(null, '/auth/forgot', 'POST', { email: recoveryEmail }, undefined, headers);
  const unknown = await request(null, '/auth/forgot', 'POST', { email: 'brand.absent@vanly.example' }, undefined, headers);
  assert.equal(known.status, 201);
  assert.deepEqual(known.data, unknown.data);
  const queued = (await db.query("SELECT payload FROM jobs WHERE recipient_user_id=$1 AND event_key LIKE 'account.password_reset:%'",
    [registered.data.user.id])).rows;
  assert.equal(queued.length, 1);
  assert.equal(new URL(queued[0].payload.variables.action_url).origin, headers.origin);
  for (let index = 0; index < 18; index++) {
    const response = await request(null, '/auth/forgot', 'POST', { email: index % 2 ? recoveryEmail : 'brand.absent@vanly.example' }, undefined, headers);
    assert.equal(response.status, 201);
    assert.deepEqual(response.data, known.data);
  }
  const deniedKnown = await request(null, '/auth/forgot', 'POST', { email: recoveryEmail }, undefined, headers);
  const deniedUnknown = await request(null, '/auth/forgot', 'POST', { email: 'brand.absent@vanly.example' }, undefined, headers);
  assert.equal(deniedKnown.status, 429);
  assert.deepEqual(deniedKnown.data, deniedUnknown.data);
  assert.equal((await db.query("SELECT count(*)::int n FROM jobs WHERE recipient_user_id=$1 AND event_key LIKE 'account.password_reset:%'",
    [registered.data.user.id])).rows[0].n, 1);
});

test('local mail exposes downloadable PDF metadata only within current booking permissions', async () => {
  const ownDocument = (await db.query("SELECT * FROM booking_documents WHERE booking_id=$1 AND kind='summary' LIMIT 1", [mainBooking.id])).rows[0];
  assert.ok(ownDocument);
  const foreignBooking = await hold(other, input('family', 800, 806));
  const foreignDocument = (await db.query(`INSERT INTO booking_documents(booking_id,kind,version,event_key,file_name,content,sha256,snapshot)
    VALUES($1,'summary',1,'mail-review-fixture','foreign-summary.pdf',$2,$3,$4) RETURNING *`,
    [foreignBooking.id, ownDocument.content, ownDocument.sha256, ownDocument.snapshot])).rows[0];
  const refs = [{ documentId: ownDocument.id }, { documentId: foreignDocument.id }, { documentId: 'not-a-document' }];
  const fixtureIds = [];
  try {
    for (const [account, expected] of [
      [traveler, [ownDocument.id]], [owner, [ownDocument.id]],
      [otherOwner, [foreignDocument.id]], [admin, [ownDocument.id, foreignDocument.id]],
    ]) {
      const mail = (await db.query('INSERT INTO local_mail(user_id,subject,body,attachments) VALUES($1,$2,$3,$4) RETURNING id',
        [account.user.id, 'Test metadanych załącznika', 'Test uprawnień PDF', JSON.stringify(refs)])).rows[0];
      fixtureIds.push(mail.id);
      const result = await request(account, '/mail');
      assert.equal(result.status, 200, JSON.stringify(result.data));
      const returned = result.data.find(row => row.id === mail.id);
      assert.deepEqual(returned.attachments.map(row => row.documentId), expected);
      for (const attachment of returned.attachments) {
        assert.equal(attachment.bookingId, attachment.documentId === ownDocument.id ? mainBooking.id : foreignBooking.id);
        assert.equal(attachment.contentType, 'application/pdf');
        assert.ok(attachment.fileName.endsWith('.pdf'));
        assert.ok(attachment.size > 0);
        assert.ok(!('content' in attachment) && !('data' in attachment) && !('snapshot' in attachment));
        const download = await fetch(`http://127.0.0.1:${apiPort}/api/v1/bookings/${attachment.bookingId}/documents/${attachment.documentId}`, {
          headers: { cookie: account.cookie },
        });
        assert.equal(download.status, 200);
        assert.match(download.headers.get('content-type'), /^application\/pdf/);
      }
      assert.ok(!(await request(other, '/mail')).data.some(row => row.id === mail.id));
    }
  } finally {
    await db.query('DELETE FROM local_mail WHERE id=ANY($1::bigint[])', [fixtureIds]);
    await db.query('DELETE FROM booking_documents WHERE id=$1', [foreignDocument.id]);
    await request(other, '/bookings/' + foreignBooking.id + '/cancel', 'POST');
  }
});

test('API outbox renders real HTML and text into the local provider without AWS', async () => {
  const mailer = new MailerService(db, { documentResolver: (refs, job) => resolveMailDocuments(db, refs, job),
    notificationGuard: (job) => validateNotificationGuard(db, job), config: loadMailerConfig({
    MAIL_PROVIDER: 'local', MAIL_SES_ENABLED: 'false', APP_URL: 'http://localhost:3100',
    APP_ORIGIN: env.APP_ORIGIN, APP_ADDITIONAL_ORIGINS: env.APP_ADDITIONAL_ORIGINS,
    MAIL_BATCH_SIZE: '50',
  }) });
  try {
    for (let round = 0; round < 10; round++) {
      const result = await mailer.tick();
      for (const row of result) {
        if (row.status === 'local') continue;
        const job = (await db.query('SELECT error FROM jobs WHERE id=$1', [row.jobId])).rows[0];
        assert.equal(row.status, 'dead');
        assert.equal(job.error, 'NOTIFICATION_NO_LONGER_APPLICABLE', JSON.stringify(row));
      }
      if (!result.length) break;
    }
    const messages = (await db.query('SELECT * FROM local_mail WHERE job_id IS NOT NULL')).rows;
    assert.ok(messages.length > 5);
    assert.ok(messages.every(row => row.html.includes('<!DOCTYPE html>') || row.html.includes('<!doctype html>')));
    assert.ok(messages.every(row => !/\{\{[a-z_]+\}\}/.test(row.html + row.text_body)));
    const history = (await db.query('SELECT status,provider_message_id,error_code FROM mail_deliveries')).rows;
    assert.ok(history.length >= messages.length);
    assert.ok(history.every(row => row.status === 'local' ||
      (row.status === 'dead' && row.error_code === 'NOTIFICATION_NO_LONGER_APPLICABLE')));
    assert.equal((await db.query("SELECT count(*)::int n FROM jobs WHERE kind='mail' AND status='pending'")).rows[0].n, 0);
    assert.ok((await db.query("SELECT payload FROM jobs WHERE kind='mail' AND status='done'")).rows
      .every(row => !row.payload.body && !row.payload.variables));
  } finally { mailer.close(); }
});

test('a session-storage outage returns a generic error without exposing database internals', async () => {
  await db.query('ALTER TABLE sessions RENAME TO session_storage_outage_fixture');
  try {
    const result = await request(null, '/catalog', 'GET', undefined, undefined, {
      cookie: 'vanly_session=' + crypto.randomBytes(32).toString('hex'),
    });
    assert.equal(result.status, 500);
    assert.deepEqual(result.data, { message: 'Wystąpił błąd serwera. Spróbuj ponownie.' });
    assert.doesNotMatch(JSON.stringify(result.data), /sessions|relation|SELECT|postgres/i);
  } finally {
    await db.query('ALTER TABLE session_storage_outage_fixture RENAME TO sessions');
  }
  assert.equal((await request(null, '/catalog')).status, 200);
});
