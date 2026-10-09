// Run only inside the isolated Linux UAT test container, never the local runtime.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';

const database = new URL(process.env.DATABASE_URL);
assert.equal(database.pathname, '/vanly_uat');
assert.equal(database.port, '55432');
assert.equal(process.env.UAT_ISOLATED_SMOKE, 'true');
const db = new pg.Pool({ connectionString: database.toString() });
const origin = 'https://uat.vanly.me';
const checks = [];
const accounts = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
async function request(session, path, method = 'GET', body, key = crypto.randomUUID()) {
  const response = await fetch('http://127.0.0.1:4100/api/v1' + path, {
    method,
    headers: { origin, 'x-vanly-protocol': 'https', 'idempotency-key': key,
      ...(session ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  return { status: response.status, data, cookie: response.headers.get('set-cookie') };
}
function session(result) {
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.match(result.cookie, /^__Host-vanly_session=/);
  assert.match(result.cookie, /Secure/);
  assert.match(result.cookie, /HttpOnly/);
  return { cookie: result.cookie.split(';')[0], csrf: result.data.csrf, user: result.data.user };
}
async function login(email) {
  const account = accounts.find(account => account.email === email);
  assert.ok(account);
  return session(await request(null, '/auth/login', 'POST', account));
}
const day = offset => {
  const value = new Date(); value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};
try {
  const health = await request(null, '/health');
  assert.equal(health.status, 200); assert.equal(health.data.ok, true);
  assert.equal((await request(null, '/bookings')).status, 401);
  const owner = await login('baltic@vanly.local');
  const admin = await login('operator@vanly.local');
  const traveler = session(await request(null, '/auth/register', 'POST', {
    email: `uat-smoke-${crypto.randomUUID()}@example.test`, name: 'Tester UAT',
    password: crypto.randomBytes(24).toString('hex'),
  }));
  assert.equal((await request(traveler, '/auth/me')).data.user.id, traveler.user.id);
  assert.equal((await request(owner, '/owner/dashboard')).status, 200);
  assert.equal((await request(admin, '/admin/dashboard')).status, 200);
  assert.equal((await request(traveler, '/admin/dashboard')).status, 403);
  checks.push('registration, secure sessions, owner/admin panels, role boundaries');
  let quote;
  for (const offset of [330, 350, 370, 390]) {
    const result = await request(traveler, '/quotes', 'POST', {
      vehicleId: 'coast', start: day(offset), end: day(offset + 7),
      guests: 2, extras: {}, plan: 'deposit',
    });
    if (result.status === 201) { quote = result.data; break; }
    assert.equal(result.status, 409, JSON.stringify(result.data));
  }
  assert.ok(quote, 'No free date for the smoke booking');
  let booking = await request(traveler, '/holds', 'POST', { quoteId: quote.id });
  assert.equal(booking.status, 201, JSON.stringify(booking.data));
  const id = booking.data.id;
  const paymentKey = crypto.randomUUID();
  const payment = { name: traveler.user.name, email: traveler.user.email,
    note: 'Odizolowany test UAT', accept: true, scenario: 'success' };
  booking = await request(traveler, `/bookings/${id}/pay-test`, 'POST', payment, paymentKey);
  assert.equal(booking.status, 201, JSON.stringify(booking.data));
  assert.ok(['confirmed', 'pending'].includes(booking.data.status));
  const duplicate = await request(traveler, `/bookings/${id}/pay-test`, 'POST', payment, paymentKey);
  assert.equal(duplicate.status, 201);
  assert.equal(duplicate.data.paid_minor, booking.data.paid_minor);
  if (booking.data.status === 'pending') {
    booking = await request(owner, `/bookings/${id}/decision`, 'POST', { accept: true });
    assert.equal(booking.status, 201, JSON.stringify(booking.data));
  }
  assert.equal(booking.data.status, 'confirmed');
  const documents = await request(traveler, `/bookings/${id}/documents`);
  assert.equal(documents.status, 200);
  assert.ok(documents.data.length > 0);
  const pdf = await fetch(`http://127.0.0.1:4100/api/v1/bookings/${id}/documents/${documents.data[0].documentId}`, {
    headers: { origin, 'x-vanly-protocol': 'https', cookie: traveler.cookie },
  });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /application\/pdf/);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  checks.push('quote, hold, test payment, idempotency, confirmation, PDF download');
  assert.equal((await request(traveler, '/messages', 'POST', {
    vehicleId: 'coast', text: 'Wiadomość z testu UAT',
  })).status, 201);
  const messages = await request(owner, `/messages?vehicle=coast&traveler=${traveler.user.id}`);
  assert.equal(messages.status, 200); assert.ok(messages.data.length > 0);
  checks.push('traveler/company messaging');
  booking = await request(traveler, `/bookings/${id}/balance-test`, 'POST');
  assert.equal(booking.status, 201, JSON.stringify(booking.data));
  assert.equal(booking.data.paid_minor, booking.data.total_minor);
  booking = await request(traveler, `/bookings/${id}/cancel`, 'POST');
  assert.equal(booking.status, 201);
  booking = await request(admin, `/bookings/${id}/refund-test`, 'POST');
  assert.equal(booking.status, 201, JSON.stringify(booking.data));
  assert.equal(booking.data.payment_status, 'refunded');
  checks.push('test balance payment, cancellation, test refund');
  let delivered = false;
  for (let attempt = 0; attempt < 25; attempt++) {
    const mail = await request(traveler, '/mail');
    assert.equal(mail.status, 200);
    if (mail.data.length > 0) { delivered = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(delivered, 'Worker did not deliver test mail');
  const payments = await db.query('SELECT count(*)::int n FROM payments WHERE booking_id=$1', [id]);
  assert.equal(payments.rows[0].n, 3);
  checks.push('worker and private test-mail inbox; exactly three payment ledger entries');
  console.log(JSON.stringify({ ok: true, checks }));
} finally {
  await db.end();
}
