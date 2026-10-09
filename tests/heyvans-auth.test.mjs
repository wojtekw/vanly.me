import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import { allowedAppOrigins, trustedRequestOrigin } from '../apps/api/dist/request-origin.js';

// Existing local database and account only. The temporary API binds loopback;
// this suite never migrates, seeds or creates users, resets, quotes or bookings.
dotenv.config({ path: '.env.local', quiet: true });
const origins = ['https://vanly.me.local', 'https://camperfolks.com.local', 'https://heyvans.com.local'];
process.env.APP_ADDITIONAL_ORIGINS = [...new Set([
  ...(process.env.APP_ADDITIONAL_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
  ...origins,
])].join(',');
let port, server, account;
const sessions = new Set();

async function unusedPort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const selected = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return selected;
}

async function request(path, {
  method = 'GET', body, cookie, csrf, requestOrigin = origins[2], protocol = 'https',
} = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
    method,
    signal: AbortSignal.timeout(10000),
    headers: {
      ...(requestOrigin ? { origin: requestOrigin } : {}),
      'x-vanly-protocol': protocol,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
}

before(async () => {
  const accounts = JSON.parse(await fs.readFile('.local/accounts.json', 'utf8'));
  account = accounts.find((value) => value.email === 'podroznik@vanly.local');
  assert.ok(account, 'Existing traveler account is required.');
  port = await unusedPort();
  server = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env: { ...process.env, API_PORT: String(port) }, stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw Error('Temporary test API could not start.');
    try {
      const health = await request('/health');
      if (health.status === 200 && health.data.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('Temporary test API did not become ready on its free loopback port.');
}, { timeout: 20000 });

after(async () => {
  // Logout even after a failed assertion, then release the temporary listener.
  for (const session of sessions) {
    await request('/auth/logout', { method: 'POST', ...session }).catch(() => {});
  }
  server?.kill('SIGTERM');
  if (server && server.exitCode === null) {
    await new Promise((resolve) => server.once('exit', resolve));
  }
});

test('all three configured origins read the existing API and public inventory', async () => {
  for (const requestOrigin of origins) {
    const health = await request('/health', { requestOrigin });
    assert.equal(health.status, 200);
    assert.equal(health.data.database, 'postgresql');
    assert.ok(['local_test', 'disabled'].includes(health.data.payments));
    assert.equal((await request('/auth/me', { requestOrigin })).data.user, null);
  }
  const inventory = await request('/seo/inventory');
  assert.equal(inventory.status, 200);
  assert.ok(inventory.data.vehicles.length > 0, 'Existing public vehicle inventory must be available.');
});

test('exact origins reach input validation while missing or lookalike origins are rejected', async () => {
  for (const requestOrigin of [
    '', 'https://evil.invalid', 'https://heyvans.com.local.evil.invalid',
    'https://heyvans.com.local/', 'http://heyvans.com.local',
  ]) {
    assert.equal((await request('/preview-quote', {
      method: 'POST', body: {}, requestOrigin,
    })).status, 403, `Untrusted origin must be rejected: ${requestOrigin || '(missing)'}`);
  }
  for (const requestOrigin of origins) {
    assert.equal((await request('/preview-quote', { method: 'POST', body: {}, requestOrigin })).status, 400);
    // Invalid reset input cannot enqueue mail, create a token or change an account.
    assert.equal((await request('/auth/forgot', { method: 'POST', body: {}, requestOrigin })).status, 400);
  }
});

test('the same existing account logs in and out with host-only HTTPS cookie and enforced CSRF on all origins', async () => {
  for (const requestOrigin of origins) {
    const login = await request('/auth/login', {
      method: 'POST', body: { email: account.email, password: account.password }, requestOrigin,
    });
    assert.equal(login.status, 201, 'The existing account must work on each frontend origin.');
    const session = { cookie: login.cookie?.split(';')[0], csrf: login.data.csrf, requestOrigin };
    sessions.add(session);
    assert.ok(login.cookie?.startsWith('__Host-vanly_session='), 'HTTPS session must use its secure cookie name.');
    for (const flag of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) assert.ok(login.cookie.includes(flag));
    assert.ok(!/Domain=/i.test(login.cookie), 'Cookie must remain host-only.');
    assert.ok(session.csrf, 'An authenticated session must have a CSRF token.');
    assert.equal((await request('/auth/me', session)).data.user.email, account.email);
    assert.equal((await request('/auth/me', { ...session, protocol: 'http' })).data.user, null,
      'The HTTP listener must not select the HTTPS cookie.');
    assert.equal((await request('/preview-quote', {
      method: 'POST', body: {}, cookie: session.cookie, requestOrigin,
    })).status, 403);
    assert.equal((await request('/preview-quote', {
      method: 'POST', body: {}, ...session, csrf: 'incorrect',
    })).status, 403);
    assert.equal((await request('/auth/logout', {
      method: 'POST', ...session, requestOrigin: 'https://evil.invalid',
    })).status, 403);
    assert.equal((await request('/preview-quote', { method: 'POST', body: {}, ...session })).status, 400,
      'Valid CSRF must reach input validation without creating a quote.');
    const logout = await request('/auth/logout', { method: 'POST', ...session });
    assert.equal(logout.status, 201);
    assert.match(logout.cookie, /^__Host-vanly_session=;/);
    assert.equal((await request('/auth/me', session)).data.user, null);
    sessions.delete(session);
  }
});

test('password-reset links select the exact allowed frontend and fall back for untrusted or absent origins', () => {
  for (const origin of origins) {
    assert.ok(allowedAppOrigins().includes(origin));
    assert.equal(trustedRequestOrigin({ headers: { origin } }), origin);
  }
  for (const origin of ['https://heyvans.com.local.evil.invalid', 'https://heyvans.com.local/', 'https://evil.invalid']) {
    assert.equal(trustedRequestOrigin({ headers: { origin } }), process.env.APP_ORIGIN);
  }
  assert.equal(trustedRequestOrigin({ headers: {} }), process.env.APP_ORIGIN);
});
