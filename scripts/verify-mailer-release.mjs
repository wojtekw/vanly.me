import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { SOURCE, RUNTIME, RELEASE_PARENT, SERVICES, MANAGED, MIGRATIONS, DEPENDENCIES, ARTIFACTS, PUBLIC_INPUTS, sourceOptions, artifactOptions, fingerprint, hashPaths, copyManaged, syncTree, SOURCE_EXCLUDES, PROTECTED_EXCLUDES, validateDependencyLinks } from './release-fingerprint.mjs';

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
async function checkHashes(root, stored, entries, options) {
  if (!exactKeys(stored, entries)) throw Error('RELEASE_MANIFEST_INVALID');
  for (const entry of entries) if (await fingerprint(root, entry, options) !== stored[entry]) throw Error('RELEASE_FINGERPRINT_MISMATCH');
}
export async function readManifest(release, { source = SOURCE, runtime = RUNTIME, requirePrefix = true } = {}) {
  const resolved = await fs.realpath(release);
  if (resolved !== path.resolve(release) || (requirePrefix && (path.dirname(resolved) !== RELEASE_PARENT || !path.basename(resolved).startsWith('vanly-mailer-release.')))) throw Error('RELEASE_PATH_INVALID');
  const manifest = JSON.parse(await fs.readFile(path.join(resolved, 'mailer-release.json'), 'utf8'));
  if (manifest.version !== 2 || manifest.source !== source || manifest.runtime !== runtime || JSON.stringify(manifest.managed) !== JSON.stringify(MANAGED) || JSON.stringify(manifest.migrations) !== JSON.stringify(MIGRATIONS)) throw Error('RELEASE_MANIFEST_INVALID');
  return manifest;
}
export async function verifyRelease(release, options = {}) {
  const source = options.source || SOURCE, runtime = options.runtime || RUNTIME;
  const manifest = await readManifest(release, options);
  await checkHashes(source, manifest.sourceHashes, MANAGED, sourceOptions);
  await checkHashes(source, manifest.sourceDependencies, DEPENDENCIES);
  await checkHashes(runtime, manifest.baseSources, MANAGED, sourceOptions);
  await checkHashes(runtime, manifest.baseArtifacts, ARTIFACTS, artifactOptions);
  await checkHashes(runtime, manifest.baseDependencies, DEPENDENCIES);
  await checkHashes(runtime, manifest.basePublic, PUBLIC_INPUTS);
  if (await fingerprint(runtime, '.env.local') !== manifest.baseEnv) throw Error('PRIVATE_ENV_CHANGED');
  await verifyContents(release, manifest);
  return manifest;
}
export async function verifyContents(release, manifest) {
  await checkHashes(release, manifest.releaseSources, MANAGED, sourceOptions);
  await checkHashes(release, manifest.releaseArtifacts, ARTIFACTS, artifactOptions);
  await checkHashes(release, manifest.releaseDependencies, DEPENDENCIES);
  if (await fingerprint(release, '.env.local') !== manifest.releaseEnv) throw Error('RELEASE_PRIVATE_ENV_CHANGED');
  const privateFile = await fs.lstat(path.join(release, '.env.local'));
  if (!privateFile.isFile() || (privateFile.mode & 0o077)) throw Error('RELEASE_PRIVATE_ENV_NOT_PROTECTED');
  if (Object.values(manifest.releaseSources).some(hash => hash === null) || Object.values(manifest.releaseArtifacts).some(hash => hash === null) || Object.values(manifest.releaseDependencies).some(hash => hash === null)) throw Error('RELEASE_INCOMPLETE');
  for (const entry of ['apps/api/dist/main.js', ...['frontoffice', 'camperfolks', 'heyvans'].map(app => 'apps/' + app + '/.next/BUILD_ID'), ...['owner', 'admin'].map(app => 'apps/' + app + '/dist/index.html')]) await fs.access(path.join(release, entry));
  for (const migration of MIGRATIONS) await fs.access(path.join(release, 'db/migrations', migration));
  if (!((await fs.stat(path.join(release, 'vanly'))).mode & 0o111)) throw Error('RELEASE_LAUNCHER_NOT_EXECUTABLE');
  await validateDependencyLinks(release);
}
export function runningServices() {
  const domain = 'gui/' + process.getuid();
  return SERVICES.filter(service => {
    try { execFileSync('/bin/launchctl', ['print', domain + '/local.vanly.portal.' + service], { stdio: 'pipe' }); return true; }
    catch { return false; }
  });
}
export async function checkStopped() {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (!runningServices().length) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error('RELEASE_SERVICES_NOT_STOPPED');
}
export async function backupRuntime(backup, { runtime = RUNTIME } = {}) {
  if (!(await fs.lstat(path.join(runtime, '.env.local'))).isFile()) throw Error('PRIVATE_ENV_REGULAR_FILE_REQUIRED');
  const entries = [...MANAGED, ...DEPENDENCIES];
  const presence = {};
  for (const entry of entries) presence[entry] = Boolean(await fs.lstat(path.join(runtime, entry)).catch(() => null));
  await fs.mkdir(backup, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(backup, 'presence.json'), JSON.stringify(presence), { mode: 0o600 });
  for (const entry of MANAGED) if (presence[entry]) await copyManaged(runtime, backup, [entry], PROTECTED_EXCLUDES);
  for (const entry of DEPENDENCIES) if (presence[entry]) {
    await fs.mkdir(path.join(backup, entry), { recursive: true });
    syncTree(path.join(runtime, entry), path.join(backup, entry));
  }
  await fs.copyFile(path.join(runtime, '.env.local'), path.join(backup, 'env.local'));
  await fs.chmod(path.join(backup, 'env.local'), 0o600);
}

async function requireDeploymentLock() {
  const lock = path.join(RUNTIME, '.local/deploy.lock');
  if (!(await fs.lstat(lock)).isDirectory() || (await fs.readFile(path.join(lock, 'pid'), 'utf8')).trim() !== String(process.ppid)) throw Error('DEPLOYMENT_LOCK_REQUIRED');
}
export async function installRelease(release, options = {}) {
  const runtime = options.runtime || RUNTIME;
  // The shell holds the deployment lock and has stopped all selected services.
  const manifest = await verifyRelease(release, options);
  await copyManaged(release, runtime, MANAGED, SOURCE_EXCLUDES);
  for (const entry of DEPENDENCIES) {
    await fs.mkdir(path.join(runtime, entry), { recursive: true });
    syncTree(path.join(release, entry), path.join(runtime, entry), { deleteExtra: true });
  }
  for (const entry of ARTIFACTS) {
    await fs.mkdir(path.join(runtime, entry), { recursive: true });
    syncTree(path.join(release, entry), path.join(runtime, entry), { excludes: entry.endsWith('/.next') ? ['/cache/'] : [], deleteExtra: true });
  }
  const temp = path.join(runtime, '.env.local.deploy-' + crypto.randomUUID());
  try {
    await fs.copyFile(path.join(release, '.env.local'), temp); await fs.chmod(temp, 0o600);
    if (await fingerprint(runtime, '.env.local') !== manifest.baseEnv) throw Error('PRIVATE_ENV_CHANGED');
    await fs.rename(temp, path.join(runtime, '.env.local'));
  } finally { await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  await checkHashes(runtime, manifest.releaseSources, MANAGED, sourceOptions);
  await checkHashes(runtime, manifest.releaseArtifacts, ARTIFACTS, artifactOptions);
  await checkHashes(runtime, manifest.releaseDependencies, DEPENDENCIES);
  if (await fingerprint(runtime, '.env.local') !== manifest.releaseEnv) throw Error('RELEASE_INSTALLED_ENV_MISMATCH');
  await validateDependencyLinks(runtime);
}
export async function restoreRuntime(backup, { runtime = RUNTIME } = {}) {
  const presence = JSON.parse(await fs.readFile(path.join(backup, 'presence.json'), 'utf8'));
  if (!exactKeys(presence, [...MANAGED, ...DEPENDENCIES])) throw Error('ROLLBACK_MANIFEST_INVALID');
  // Restore dependencies first. Then protected source copies preserve those
  // exact trees and private/public directories while removing new source files.
  for (const entry of DEPENDENCIES) {
    if (presence[entry]) {
      await fs.mkdir(path.join(runtime, entry), { recursive: true });
      syncTree(path.join(backup, entry), path.join(runtime, entry), { deleteExtra: true });
    } else await fs.rm(path.join(runtime, entry), { recursive: true, force: true });
  }
  for (const entry of MANAGED) {
    if (presence[entry]) await copyManaged(backup, runtime, [entry], PROTECTED_EXCLUDES);
    else await fs.rm(path.join(runtime, entry), { recursive: true, force: true });
  }
  const temp = path.join(runtime, '.env.local.rollback-' + crypto.randomUUID());
  try { await fs.copyFile(path.join(backup, 'env.local'), temp); await fs.chmod(temp, 0o600); await fs.rename(temp, path.join(runtime, '.env.local')); }
  finally { await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
export async function checkReadiness(services, { attempts = 45, delayMs = 1000 } = {}) {
  if (services.some(service => !SERVICES.includes(service))) throw Error('RELEASE_SERVICE_INVALID');
  const urls = { api: 'http://127.0.0.1:4100/api/v1/health', web: 'http://127.0.0.1:3100/', owner: 'http://127.0.0.1:8182/', admin: 'http://127.0.0.1:8183/', camperfolks: 'http://127.0.0.1:3104/', heyvans: 'http://127.0.0.1:3106/' };
  let stable = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let healthy = true;
    for (const service of services) {
      try {
        const state = execFileSync('/bin/launchctl', ['print', 'gui/' + process.getuid() + '/local.vanly.portal.' + service], { encoding: 'utf8', stdio: 'pipe' });
        if (!/state = running/.test(state) || !/pid = \d+/.test(state)) healthy = false;
        if (urls[service]) { const response = await fetch(urls[service], { redirect: 'manual', signal: AbortSignal.timeout(2000) }); if (response.status < 200 || response.status >= 400) healthy = false; await response.body?.cancel(); }
      } catch { healthy = false; }
    }
    stable = healthy ? stable + 1 : 0;
    if (stable >= 3) return;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  throw Error('RELEASE_SERVICES_NOT_READY');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [actionOrRelease, arg] = process.argv.slice(2);
    if (actionOrRelease === '--running-services') console.log(runningServices().join(' '));
    else if (actionOrRelease === '--stopped') await checkStopped();
    else if (actionOrRelease === '--backup') { await requireDeploymentLock(); await backupRuntime(arg); }
    else if (actionOrRelease === '--install') { await requireDeploymentLock(); await installRelease(arg); }
    else if (actionOrRelease === '--restore') { await requireDeploymentLock(); await restoreRuntime(arg); }
    else if (actionOrRelease === '--ready') await checkReadiness((arg || '').split(' ').filter(Boolean));
    else { await verifyRelease(actionOrRelease); console.log('Wydanie, zależności, kompilacja i stan instalacji zgodne.'); }
  } catch (error) { console.error(/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'RELEASE_OPERATION_FAILED'); process.exitCode = 1; }
}
