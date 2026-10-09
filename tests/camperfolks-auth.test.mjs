import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import { allowedAppOrigins, trustedRequestOrigin } from '../apps/api/dist/request-origin.js';

dotenv.config({ path: '.env.local', quiet: true });
const origin = 'https://camperfolks.com.local';
const port = 4105;
const env = {
  ...process.env,
  API_PORT: String(port),
  APP_ADDITIONAL_ORIGINS: [...new Set([
    ...(process.env.APP_ADDITIONAL_ORIGINS || '').split(',').filter(Boolean), origin,
  ])].join(','),
};
let server;
let session;
let account;

async function request(path, { method = 'GET', body, cookie, csrf, requestOrigin = origin } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
    method,
    headers: {
      origin: requestOrigin,
      'x-vanly-protocol': 'https',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
}

before(async () => {
  // Existing local data only: no migrations, seed, truncation, booking or payment writes.
  const accounts = JSON.parse(await fs.readFile('.local/accounts.json', 'utf8'));
  account = accounts.find((value) => value.email === 'podroznik@vanly.local');
  assert.ok(account, 'Existing traveler account is required.');
  server = spawn(process.execPath, ['apps/api/dist/main.js'], { env, stdio: 'ignore' });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw Error('Test API could not start.');
    try {
      const response = await request('/health');
      if (response.status === 200 && response.data.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('Test API did not become ready on loopback port 4105.');
});

after(async () => {
  // Always remove the test session, including when an assertion fails.
  if (session) await request('/auth/logout', { method: 'POST', ...session }).catch(() => {});
  server?.kill('SIGTERM');
  if (server && server.exitCode === null) {
    await new Promise((resolve) => server.once('exit', resolve));
  }
});

test('Camperfolks uses the existing API and its public data', async () => {
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/auth/me')).data.user, null);
  const inventory = await request('/seo/inventory');
  assert.equal(inventory.status, 200);
  assert.ok(Array.isArray(inventory.data.vehicles));
  assert.ok(inventory.data.vehicles.length > 0, 'Existing vehicle inventory must be available.');
});

test('exact Camperfolks origin, host-only HTTPS cookie and CSRF are enforced', async () => {
  assert.equal((await request('/auth/login', {
    method: 'POST', body: account, requestOrigin: origin + '.evil.invalid',
  })).status, 403);
  const login = await request('/auth/login', { method: 'POST', body: account });
  assert.equal(login.status, 201);
  assert.match(login.cookie, /^__Host-vanly_session=/);
  for (const flag of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) assert.ok(login.cookie.includes(flag));
  assert.doesNotMatch(login.cookie, /Domain=/i);
  session = { cookie: login.cookie.split(';')[0], csrf: login.data.csrf };
  assert.equal((await request('/auth/me', session)).data.user.email, account.email);
  assert.equal((await request('/quotes', { method: 'POST', body: {}, cookie: session.cookie })).status, 403);
  assert.equal((await request('/quotes', { method: 'POST', body: {}, ...session, csrf: 'incorrect' })).status, 403);
  assert.equal((await request('/auth/logout', { method: 'POST', ...session, requestOrigin: 'https://evil.invalid' })).status, 403);
  const logout = await request('/auth/logout', { method: 'POST', ...session });
  assert.equal(logout.status, 201);
  assert.match(logout.cookie, /^__Host-vanly_session=;/);
  assert.equal((await request('/auth/me', session)).data.user, null);
  session = undefined;
});

test('password-reset links retain an exact trusted frontend origin', () => {
  assert.ok(allowedAppOrigins().includes(origin));
  assert.equal(trustedRequestOrigin({ headers: { origin } }), origin);
  assert.equal(trustedRequestOrigin({ headers: { origin: process.env.APP_ORIGIN } }), process.env.APP_ORIGIN);
  assert.equal(trustedRequestOrigin({ headers: { origin: origin + '.evil.invalid' } }), process.env.APP_ORIGIN);
  assert.equal(trustedRequestOrigin({ headers: {} }), process.env.APP_ORIGIN);
});
