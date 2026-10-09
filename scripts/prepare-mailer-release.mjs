import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { SOURCE, RUNTIME, RELEASE_PARENT, MANAGED, MIGRATIONS, DEPENDENCIES, ARTIFACTS, PUBLIC_INPUTS, sourceOptions, artifactOptions, hashPaths, fingerprint, copyManaged, stageDependencies } from './release-fingerprint.mjs';
import { configureMailerLocal } from './configure-mailer-local.mjs';
import { verifyContents } from './verify-mailer-release.mjs';

export async function prepareRelease({ source = SOURCE, runtime = RUNTIME, build = true } = {}) {
  if (source !== SOURCE || runtime !== RUNTIME) throw Error('RELEASE_TARGET_INVALID');
  const createdAt = new Date().toISOString();
  const release = await fs.mkdtemp(path.join(RELEASE_PARENT, 'vanly-mailer-release.'));
  console.log('Przygotowanie odrębnego wydania: ' + release);
  const manifest = {
    version: 2, source, runtime, createdAt, managed: MANAGED, migrations: MIGRATIONS,
    sourceHashes: await hashPaths(source, MANAGED, sourceOptions),
    sourceDependencies: await hashPaths(source, DEPENDENCIES),
    baseSources: await hashPaths(runtime, MANAGED, sourceOptions),
    baseArtifacts: await hashPaths(runtime, ARTIFACTS, artifactOptions),
    baseDependencies: await hashPaths(runtime, DEPENDENCIES),
    basePublic: await hashPaths(runtime, PUBLIC_INPUTS), baseEnv: await fingerprint(runtime, '.env.local'),
  };
  if (Object.values(manifest.sourceHashes).some(hash => hash === null) || Object.values(manifest.sourceDependencies).some(hash => hash === null)) throw Error('RELEASE_SOURCE_INCOMPLETE');
  await copyManaged(source, release);
  if (JSON.stringify(await hashPaths(release, MANAGED, sourceOptions)) !== JSON.stringify(manifest.sourceHashes)) throw Error('RELEASE_SOURCE_COPY_MISMATCH');
  console.log('Przygotowanie zależności z lokalnego cache i nowych bibliotek.');
  await stageDependencies(source, runtime, release);
  if (JSON.stringify(await hashPaths(release, DEPENDENCIES)) !== JSON.stringify(manifest.sourceDependencies)) throw Error('RELEASE_DEPENDENCY_COPY_MISMATCH');
  for (const entry of PUBLIC_INPUTS) await fs.symlink(path.join(runtime, entry), path.join(release, entry));
  if (!(await fs.lstat(path.join(runtime, '.env.local'))).isFile()) throw Error('PRIVATE_ENV_REGULAR_FILE_REQUIRED');
  await fs.copyFile(path.join(runtime, '.env.local'), path.join(release, '.env.local'));
  await fs.chmod(path.join(release, '.env.local'), 0o600);
  await configureMailerLocal(path.join(release, '.env.local'), { now: new Date(createdAt) });
  // Import transports, PDF and worker runtime without starting a worker or a DB.
  const smoke = `await import('./packages/mailer/index.mjs'); await import('./packages/documents/service.mjs'); await import('./scripts/worker/runtime.mjs');`;
  try { execFileSync(process.execPath, ['--input-type=module', '-e', smoke], { cwd: release, stdio: 'pipe' }); }
  catch { throw Error('RELEASE_WORKER_DEPENDENCY_IMPORT_FAILED'); }
  if (build) {
    // App configuration is loaded from the staged private file. Ambient shell
    // overrides must not become untracked build inputs or leak into the build.
    const buildEnv = { PATH: path.dirname(process.execPath) + ':/opt/homebrew/bin:/usr/bin:/bin', HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };
    console.log('Kompilacja API i pięciu portali.');
    execFileSync(process.execPath, [release + '/apps/api/node_modules/typescript/bin/tsc', '-p', release + '/apps/api/tsconfig.json'], { cwd: release, env: buildEnv, stdio: 'inherit' });
    for (const app of ['frontoffice', 'camperfolks', 'heyvans']) execFileSync(process.execPath, [release + '/apps/' + app + '/node_modules/next/dist/bin/next', 'build', release + '/apps/' + app, '--webpack'], { cwd: release, env: buildEnv, stdio: 'inherit' });
    for (const app of ['owner', 'admin']) execFileSync(process.execPath, [release + '/apps/' + app + '/node_modules/vite/bin/vite.js', 'build'], { cwd: release + '/apps/' + app, env: buildEnv, stdio: 'inherit' });
  }
  if (JSON.stringify(await hashPaths(source, MANAGED, sourceOptions)) !== JSON.stringify(manifest.sourceHashes)) throw Error('RELEASE_SOURCE_CHANGED_DURING_BUILD');
  if (JSON.stringify(await hashPaths(source, DEPENDENCIES)) !== JSON.stringify(manifest.sourceDependencies)) throw Error('RELEASE_DEPENDENCIES_CHANGED_DURING_BUILD');
  manifest.releaseSources = await hashPaths(release, MANAGED, sourceOptions);
  manifest.releaseArtifacts = await hashPaths(release, ARTIFACTS, artifactOptions);
  manifest.releaseDependencies = await hashPaths(release, DEPENDENCIES);
  manifest.releaseEnv = await fingerprint(release, '.env.local');
  await verifyContents(release, manifest);
  await fs.writeFile(path.join(release, 'mailer-release.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log('Sprawdzone wydanie: ' + release);
  return release;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await prepareRelease(); }
  catch (error) { console.error(/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'RELEASE_PREPARATION_FAILED'); process.exitCode = 1; }
}
