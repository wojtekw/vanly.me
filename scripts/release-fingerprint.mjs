import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const SOURCE = '/Users/wojtek/Documents/ChatGPT/Vanly.me';
export const RUNTIME = '/Users/wojtek/.local/share/vanly-portal';
export const RELEASE_PARENT = '/Users/wojtek/.local/share';
export const APPS = ['api', 'worker', 'frontoffice', 'owner', 'admin', 'camperfolks', 'heyvans'];
export const SERVICES = ['api', 'worker', 'web', 'owner', 'admin', 'camperfolks', 'heyvans'];
export const MIGRATIONS = ['009_mailer.sql', '010_mail_feedback.sql', '011_password_reset_mail_limit.sql', '013_booking_documents.sql', '014_notification_automation.sql'];
export const MANAGED = [
  ...APPS.map(app => 'apps/' + app), 'packages/ui', 'packages/mailer', 'packages/documents',
  'scripts/worker', 'scripts/worker.mjs', 'scripts/configure-mailer-local.mjs',
  'scripts/service.mjs', 'scripts/panel-server.mjs', 'scripts/migrate.mjs',
  'scripts/prepare-mailer-release.mjs', 'scripts/verify-mailer-release.mjs',
  'scripts/release-fingerprint.mjs', 'scripts/deploy-mailer-release.sh', 'scripts/deploy-local.sh',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.env.example', 'vanly',
  'db/migrations', 'db/localities-pl.json',
];
export const DEPENDENCIES = ['node_modules', ...APPS.filter(app => app !== 'worker').map(app => 'apps/' + app + '/node_modules'), 'packages/ui/node_modules'];
export const ARTIFACTS = ['apps/api/dist', ...['frontoffice', 'camperfolks', 'heyvans'].map(app => 'apps/' + app + '/.next'), ...['owner', 'admin'].map(app => 'apps/' + app + '/dist')];
export const PUBLIC_INPUTS = ['frontoffice', 'camperfolks', 'heyvans'].map(app => 'apps/' + app + '/public');
export const SOURCE_SKIP = new Set(['node_modules', '.DS_Store', '.local']);
export const sourceOptions = { skip: SOURCE_SKIP, ignore: (name, parent) => name.startsWith('.env') || name.endsWith('.tsbuildinfo') || [...ARTIFACTS, ...PUBLIC_INPUTS].includes(path.join(parent, name)) };
export const artifactOptions = { skip: new Set(['.DS_Store']), ignore: (name, parent) => name === 'cache' && ARTIFACTS.filter(entry => entry.endsWith('/.next')).includes(parent) };
export const SOURCE_EXCLUDES = ['node_modules', '.DS_Store', '.local', '.env*', '*.tsbuildinfo'];
export const PROTECTED_EXCLUDES = ['node_modules', '.env*', '.local'];

// Exact content hashes are the default, including executable mode and symlink
// targets. Callers explicitly exclude mutable caches or protected private files.
export const FINGERPRINT_CONCURRENCY = 32;
const fingerprintQueue = [];
let queueHead = 0, activeReads = 0;

function finishFingerprint(node, hash) {
  if (node.context.failed) return;
  // Directory hashes settle only after all children. No I/O slot waits for a
  // child, and iterative propagation also avoids recursion on deep trees.
  while (node.parent) {
    const parent = node.parent;
    parent.children[node.index][1] = hash;
    if (--parent.remaining) return;
    hash = crypto.createHash('sha256').update(JSON.stringify(parent.children)).digest('hex');
    node = parent;
  }
  node.context.resolve(hash);
}

async function readFingerprintNode(node) {
  const { context } = node;
  try {
    const filename = path.join(context.base, node.rel);
    const stat = await fs.lstat(filename);
    if (stat.isSymbolicLink()) { finishFingerprint(node, 'link:' + await fs.readlink(filename)); return; }
    if (stat.isFile()) {
      finishFingerprint(node, crypto.createHash('sha256').update(String(stat.mode & 0o111) + ':').update(await fs.readFile(filename)).digest('hex'));
      return;
    }
    if (!stat.isDirectory()) throw Error('UNSUPPORTED_RELEASE_ENTRY');
    const entries = (await fs.readdir(filename)).filter(name => !context.skip.has(name) && !context.ignore?.(name, node.rel)).sort();
    if (!entries.length) { finishFingerprint(node, crypto.createHash('sha256').update('[]').digest('hex')); return; }
    node.children = entries.map(name => [name, null]);
    node.remaining = entries.length;
    node.cursor = 0;
    // Queue one cursor per directory, not one promise/task per child. The
    // scheduler materializes children only when an I/O slot is available.
    fingerprintQueue.push(node);
  } catch (error) {
    if (error.code === 'ENOENT') finishFingerprint(node, null);
    else throw error;
  }
}

function pumpFingerprints() {
  while (activeReads < FINGERPRINT_CONCURRENCY && queueHead < fingerprintQueue.length) {
    let node = fingerprintQueue[queueHead++];
    if (node.context.failed) continue;
    if (node.children) {
      const parent = node, index = parent.cursor++;
      if (parent.cursor < parent.children.length) fingerprintQueue.push(parent);
      node = { context: parent.context, rel: path.join(parent.rel, parent.children[index][0]), parent, index };
    }
    activeReads++;
    readFingerprintNode(node).catch(error => {
      node.context.failed = true;
      node.context.reject(error);
    }).finally(() => { activeReads--; pumpFingerprints(); });
  }
  if (queueHead === fingerprintQueue.length) { fingerprintQueue.length = 0; queueHead = 0; }
  else if (queueHead > 1024) { fingerprintQueue.splice(0, queueHead); queueHead = 0; }
}

export function fingerprint(base, rel, options = {}) {
  return new Promise((resolve, reject) => {
    const context = { base, skip: new Set(options.skip || ['.DS_Store']), ignore: options.ignore, resolve, reject, failed: false };
    fingerprintQueue.push({ context, rel });
    pumpFingerprints();
  });
}

export async function hashPaths(base, entries, options = {}) {
  const hashes = {};
  for (const entry of entries) hashes[entry] = await fingerprint(base, entry, options);
  return hashes;
}

export function syncTree(from, to, { excludes = [], deleteExtra = false, copyDest } = {}) {
  const args = ['-a', '--checksum', ...(deleteExtra ? ['--delete'] : []), ...excludes.map(name => '--exclude=' + name), ...(copyDest ? ['--copy-dest=' + copyDest] : []), from + '/', to + '/'];
  try { execFileSync('/usr/bin/rsync', args, { stdio: 'pipe' }); }
  catch { throw Error('RELEASE_COPY_FAILED'); }
}

export async function copyManaged(from, to, entries = MANAGED, excludes = SOURCE_EXCLUDES) {
  for (const entry of entries) {
    const source = path.join(from, entry), target = path.join(to, entry);
    const stat = await fs.lstat(source);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (stat.isDirectory()) {
      await fs.mkdir(target, { recursive: true });
      const protectedPaths = excludes === SOURCE_EXCLUDES ? [...ARTIFACTS, ...PUBLIC_INPUTS] : excludes === PROTECTED_EXCLUDES ? PUBLIC_INPUTS : [];
      // Match any entry type: staged public assets are symlinks, and a
      // directory-only trailing slash would let rsync replace runtime assets.
      const anchored = protectedPaths.filter(child => child.startsWith(entry + '/')).map(child => '/' + path.relative(entry, child));
      syncTree(source, target, { excludes: [...excludes, ...anchored], deleteExtra: true });
    } else {
      if (!stat.isFile()) throw Error('RELEASE_MANAGED_REGULAR_FILE_REQUIRED');
      await fs.copyFile(source, target);
      await fs.chmod(target, stat.mode & 0o777);
    }
  }
}

export async function stageDependencies(source, runtime, release) {
  for (const entry of DEPENDENCIES) {
    await fs.mkdir(path.join(release, entry), { recursive: true });
    syncTree(path.join(source, entry), path.join(release, entry), { excludes: ['.DS_Store'], deleteExtra: true, copyDest: path.join(runtime, entry) });
  }
  await validateDependencyLinks(release);
}

export async function validateDependencyLinks(root) {
  const visit = async filename => {
    const stat = await fs.lstat(filename);
    if (stat.isSymbolicLink()) {
      const target = await fs.realpath(filename).catch(() => { throw Error('RELEASE_DEPENDENCY_LINK_MISSING'); });
      if (!target.startsWith(root + path.sep)) throw Error('RELEASE_DEPENDENCY_LINK_OUTSIDE');
    } else if (stat.isDirectory()) {
      for (const name of await fs.readdir(filename)) if (name !== '.DS_Store') await visit(path.join(filename, name));
    }
  };
  for (const entry of DEPENDENCIES) await visit(path.join(root, entry));
}
