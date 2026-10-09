import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

// Run the actual panel HTTP server and production HTML against an isolated
// upstream stub. Redirect and proxy checks never reach the live API or database.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = resolve(process.env.VANLY_PANEL_DIST_ROOT || projectRoot);
const panels = {};
const children = [];
let api;

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function freePort() {
  const reservation = http.createServer();
  const port = await listen(reservation);
  await new Promise((done, reject) => reservation.close(error => error ? reject(error) : done()));
  return port;
}

async function request(kind, pathname, options = {}) {
  return fetch(panels[kind] + pathname, {
    redirect: 'manual', signal: AbortSignal.timeout(5000), ...options,
  });
}

before(async () => {
  api = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString() }));
  });
  const apiPort = await listen(api);
  for (const kind of ['owner', 'admin']) {
    const port = await freePort();
    panels[kind] = 'http://127.0.0.1:' + port;
    const child = spawn(process.execPath, [resolve(projectRoot, 'scripts/panel-server.mjs'), kind, String(port), String(apiPort)], {
      cwd: distRoot, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const deadline = Date.now() + 5000;
    let ready = false;
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        const response = await request(kind, '/');
        assert.equal(response.status, 200, `${kind} production HTML is required: ${output}`);
        await response.text();
        ready = true;
        break;
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
        await new Promise(done => setTimeout(done, 20));
      }
    }
    assert.ok(ready, `${kind} panel failed to start: ${output}`);
  }
});

after(async () => {
  for (const child of children) {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  }
  if (api) await new Promise((done, reject) => api.close(error => error ? reject(error) : done()));
});

const aliases = {
  owner: [
    ['/firma', '/company'],
    ['/firma/wiadomosci', '/company/messages'],
    ['/company/wiadomosci', '/company/messages'],
    ['/firma/rezerwacja/booking-rezerwacja', '/company/booking/booking-rezerwacja'],
    ['/firma/pojazd/vehicle-pojazd', '/company/vehicle/vehicle-pojazd'],
    ['/firma/pojazd/nowy', '/company/vehicle/new'],
    ['/company/vehicle/nowy', '/company/vehicle/new'],
    ['/firma/flota', '/company/fleet'],
  ],
  admin: [
    ['/operator/firmy', '/operator/companies'],
    ['/operator/rezerwacja/booking-rezerwacja', '/operator/booking/booking-rezerwacja'],
    ['/operator/zgloszenia', '/operator/reports'],
    ['/operator/historia', '/operator/history'],
  ],
};

for (const kind of ['owner', 'admin']) {
  test(`${kind} legacy links redirect before serving the panel and preserve query data`, async () => {
    const search = '?return=%2Ffirma%2Fwiadomosci&filter=a%20b&tab=1&tab=2';
    for (const [legacy, canonical] of [...aliases[kind], ['/logowanie', '/login']]) {
      for (const method of ['GET', 'HEAD']) {
        const response = await request(kind, legacy + search, { method });
        assert.equal(response.status, 308, `${method} ${legacy}`);
        assert.equal(response.headers.get('location'), canonical + search, legacy);
        assert.equal(await response.text(), '');
      }
      const page = await request(kind, canonical + search);
      assert.equal(page.status, 200, canonical);
      assert.equal(page.headers.get('location'), null, canonical);
      assert.match(page.headers.get('content-type') || '', /^text\/html/);
      assert.match(await page.text(), /<div id="root"><\/div>/);
    }
  });

  test(`${kind} panel keeps assets, API requests and other-role URLs out of its redirects`, async () => {
    const home = await request(kind, '/');
    const source = await home.text();
    const asset = source.match(/<script\b[^>]*\bsrc="([^"]+)"/)?.[1];
    assert.match(asset || '', /^\/assets\/.*\.js$/);
    const js = await request(kind, asset);
    assert.equal(js.status, 200);
    assert.equal(js.headers.get('location'), null);
    assert.match(js.headers.get('content-type') || '', /^text\/javascript/);
    assert.ok((await js.arrayBuffer()).byteLength > 0);
    const missingAsset = await request(kind, '/assets/firma/wiadomosci.js', { method: 'HEAD' });
    assert.equal(missingAsset.status, 404);
    assert.equal(missingAsset.headers.get('location'), null);
    assert.equal(await missingAsset.text(), '');

    const apiPath = '/api/v1/firma/wiadomosci?target=%2Ffirma%2Fwiadomosci';
    const proxied = await request(kind, apiPath);
    assert.equal(proxied.status, 200);
    assert.equal(proxied.headers.get('location'), null);
    assert.deepEqual(await proxied.json(), { method: 'GET', url: apiPath, body: '' });
    const body = JSON.stringify({ message: 'Treść pozostaje po polsku' });
    const posted = await request(kind, '/api/v1/company/settings', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    assert.equal(posted.status, 200);
    assert.deepEqual(await posted.json(), { method: 'POST', url: '/api/v1/company/settings', body });

    const crossRolePath = kind === 'owner' ? '/operator/zgloszenia' : '/firma/wiadomosci';
    const crossRole = await request(kind, crossRolePath);
    assert.equal(crossRole.status, 200);
    assert.equal(crossRole.headers.get('location'), null);
    await crossRole.text();
    const unsupported = await request(kind, '/logowanie', { method: 'POST' });
    assert.equal(unsupported.status, 405);
    assert.equal(unsupported.headers.get('location'), null);
    await unsupported.text();
  });
}
