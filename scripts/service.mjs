import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  uid = process.getuid(),
  domain = 'gui/' + uid,
  dir = path.join(os.homedir(), 'Library/LaunchAgents'),
  node = process.execPath;
const definitions = {
  owner: [node, path.join(root, 'scripts/panel-server.mjs'), 'owner', '8182'],
  admin: [node, path.join(root, 'scripts/panel-server.mjs'), 'admin', '8183'],
  api: [node, path.join(root, 'apps/api/dist/main.js')],
  web: [
    node,
    path.join(root, 'apps/frontoffice/node_modules/next/dist/bin/next'),
    'start',
    path.join(root, 'apps/frontoffice'),
    '--hostname',
    '127.0.0.1',
    '--port',
    '3100',
  ],
  camperfolks: [
    node,
    path.join(root, 'apps/camperfolks/node_modules/next/dist/bin/next'),
    'start',
    path.join(root, 'apps/camperfolks'),
    '--hostname',
    '127.0.0.1',
    '--port',
    '3104',
  ],
  heyvans: [
    node,
    path.join(root, 'apps/heyvans/node_modules/next/dist/bin/next'),
    'start',
    path.join(root, 'apps/heyvans'),
    '--hostname',
    '127.0.0.1',
    '--port',
    '3106',
  ],
  worker: [node, path.join(root, 'apps/worker/main.mjs')],
};
const xml = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const run = (args, allow = false) => {
  try {
    return execFileSync('/bin/launchctl', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    if (!allow) throw Error(e.stderr?.toString() || e.message);
    return null;
  }
};
const command = process.argv[2] || 'status';
const selected = process.argv.slice(3);
for (const name of selected) {
  if (!Object.hasOwn(definitions, name)) throw Error('Nieznana usługa: ' + name);
}
const logDir = path.join(os.homedir(),'Library/Logs/Vanly');
await fs.mkdir(logDir, {recursive:true,mode:0o700});
for (const [name, args] of Object.entries(definitions)) {
  if (selected.length && !selected.includes(name)) continue;
  const label = 'local.vanly.portal.' + name,
    file = path.join(dir, label + '.plist');
  if (['install', 'start'].includes(command)) {
    await fs.mkdir(dir, { recursive: true });
    const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map((a) => '<string>' + xml(a) + '</string>').join('')}</array><key>WorkingDirectory</key><string>${xml(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>ProcessType</key><string>Interactive</string><key>EnvironmentVariables</key><dict><key>NODE_ENV</key><string>production</string><key>NEXT_TELEMETRY_DISABLED</key><string>1</string><key>PATH</key><string>${xml(path.dirname(node))}:/opt/homebrew/bin:/usr/bin:/bin</string></dict><key>StandardOutPath</key><string>${xml(logDir)}/${name}.log</string><key>StandardErrorPath</key><string>${xml(logDir)}/${name}.error.log</string></dict></plist>`;
    await fs.writeFile(file, plist, { mode: 0o644 });
    if (!run(['print', domain + '/' + label], true)) run(['bootstrap', domain, file]);
    console.log(name + ': uruchomione.');
  } else if (command === 'stop') {
    run(['bootout', domain + '/' + label], true);
    console.log(name + ': zatrzymane.');
  } else if (command === 'restart') {
    run(['kickstart', '-k', domain + '/' + label]);
    console.log(name + ': ponowne uruchomienie.');
  } else if (command === 'status') {
    const r = run(['print', domain + '/' + label], true);
    console.log(name + ': ' + (r?.match(/state = (.+)/)?.[1] || 'zatrzymane'));
  } else throw Error('Użycie: service.mjs start|stop|restart|status [web|camperfolks|heyvans|api|owner|admin|worker]');
}
