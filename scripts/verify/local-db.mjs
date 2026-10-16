#!/usr/bin/env node
// Only this worktree's labelled disposable Docker database is ever mutated.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { statfsSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { repository } from './impact-plan.mjs';
import { assertAdmittedDockerGuest } from './docker-runtime.mjs';

const image = 'postgis/postgis:16-3.4';
const runCommand = (file, args, options) => execFileSync(file, args, options);

// The explicit phase route is stronger than historical no-request CLI use.
// An inherited marker alone cannot authorize its first Docker inspection.
export function assertPhaseLock(root = repository, env = process.env) {
  if (!env.FITSY_VERIFY_DB_PHASE) return;
  const fd = Number(env.FITSY_VERIFY_DB_LOCK_FD);
  if (env.FITSY_VERIFY_DB_PHASE !== '1' || !Number.isSafeInteger(fd) || fd < 3) {
    throw Error('explicit DB phase requires an actual inherited lock descriptor');
  }
  const result = spawnSync('/Applications/Xcode.app/Contents/Developer/usr/bin/python3', ['-I',
    fileURLToPath(new URL('./db-lock.py', import.meta.url)), '--phase-context', root, String(process.ppid)],
  { env, stdio: ['ignore', 'pipe', 'pipe', fd], encoding: 'utf8', timeout: 15000 });
  if (result.error || result.status !== 0) throw Error('explicit DB phase lock ownership or canonical receipt was not verified');
  return JSON.parse(result.stdout);
}

function canonicalRuntimeContext(root, env, operation) {
  const argv = ['-I', fileURLToPath(new URL('./db-lock.py', import.meta.url)),
    operation === 'cleanup' ? '--phase-cleanup-runtime' : '--phase-reader-runtime', root];
  const options = { env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 15000 };
  if (operation === 'cleanup') {
    const fd = Number(env.FITSY_VERIFY_DB_LOCK_FD);
    if (!Number.isSafeInteger(fd) || fd < 3) throw Error('bound cleanup requires the actual inherited lock');
    argv.push(String(process.ppid));
    options.stdio.push(fd);
  }
  const result = spawnSync('/Applications/Xcode.app/Contents/Developer/usr/bin/python3', argv, options);
  if (result.error || result.status !== 0) throw Error('canonical admitted runtime context was not verified');
  return JSON.parse(result.stdout);
}

export function databaseControl({ root = repository, command = runCommand, spawn = spawnSync,
  disk = statfsSync, env = process.env, runtimeContext = canonicalRuntimeContext,
  runtimeCheck = assertAdmittedDockerGuest, assertLock = () => {
    if (env.FITSY_VERIFY_DB_LOCKED !== '1') throw new Error('owned verification database lock is missing');
  } } = {}) {
  const owner = createHash('sha256').update(root).digest('hex').slice(0, 16);
  const name = `fitsy-verify-${owner}`;
  let admittedRuntime;
  let runtimeRequired = Boolean(env.FITSY_VERIFY_DB_PHASE);
  const docker = argv => {
    if (env.FITSY_VERIFY_DB_PHASE && env.FITSY_VERIFY_DB_PHASE !== '1') throw Error('invalid explicit DB phase');
    if (!admittedRuntime && runtimeRequired) admittedRuntime = runtimeContext(root, env, 'reader');
    if (runtimeRequired) runtimeCheck(admittedRuntime);
    return command('docker', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).trim();
  };
  const inspect = () => JSON.parse(docker(['inspect', name]))[0];
  function owned(container, expectedId, requireLoopback = true, expectedImage) {
    if (container.Config?.Labels?.['fitsy.verify.owner'] !== owner || container.Config?.Image !== image ||
        (expectedId && container.Id !== expectedId) || (expectedImage && container.Image !== expectedImage)) throw new Error('refusing a database container with different ownership or image');
    if (!requireLoopback) return null;
    const binding = container.NetworkSettings?.Ports?.['5432/tcp'];
    if (binding?.length !== 1 || binding[0].HostIp !== '127.0.0.1' || !/^\d+$/.test(binding[0].HostPort)) {
      throw new Error('owned DB must bind only to loopback');
    }
    return binding[0].HostPort;
  }
  function assert(envToCheck = env) {
    const container = inspect();
    const port = owned(container, envToCheck.FITSY_VERIFY_OWNED_DB);
    const url = `postgresql://fitsy_test:fitsy_test@127.0.0.1:${port}/fitsy_verify`;
    if (!container.State?.Running || !envToCheck.FITSY_VERIFY_OWNED_DB ||
        container.Image !== envToCheck.FITSY_VERIFY_DB_IMAGE ||
        envToCheck.POSTGRES_PRISMA_URL !== url || envToCheck.POSTGRES_URL_NON_POOLING !== url) {
      throw new Error('database execution environment does not match this worktree\'s disposable owner');
    }
  }
  function stop() {
    assertLock();
    const pinnedId = env.FITSY_VERIFY_OWNED_DB;
    const pinnedImage = env.FITSY_VERIFY_DB_IMAGE;
    if (Boolean(pinnedId) !== Boolean(pinnedImage)) throw Error('bound stop requires both acquired ID and image');
    if (pinnedId) {
      runtimeRequired = true;
      admittedRuntime = runtimeContext(root, env, 'cleanup');
    }
    const container = inspect();
    owned(container, pinnedId, false, pinnedImage);
    docker(['rm', '-f', pinnedId || container.Id]);
  }
  function run(args) {
    assertLock();
    const phase = assertPhaseLock(root, env);
    if (phase) admittedRuntime = phase.receipt.readiness?.identity;
    let createdId;
    try {
      const space = disk(root);
      if (space.bavail * space.bsize < 2 * 1024 ** 3) throw new Error('local verification needs 2 GiB free before starting its disposable DB');
      let container;
      try { container = inspect(); }
      catch (error) {
        if (error.code !== 'ENOENT' && !/No such (object|container)/i.test(error.stderr?.toString() ?? '')) throw error;
        if (phase && phase.receipt.readiness?.owned_db?.state !== 'absent') {
          throw Error('admitted existing database disappeared before mutation');
        }
        createdId = docker(['run', '-d', '--name', name, '--memory', '768m', '--cpus', '2', '--label', `fitsy.verify.owner=${owner}`,
          '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
          '--env', 'POSTGRES_USER=fitsy_test', '--env', 'POSTGRES_PASSWORD=fitsy_test',
          '--env', 'POSTGRES_DB=fitsy_test', image]);
        container = inspect();
      }
      const admitted = phase?.receipt.readiness?.owned_db;
      if (phase && ((admitted?.state !== 'absent' && admitted?.state !== 'owned') ||
          (admitted.state === 'absent' && !createdId) ||
          (admitted.state === 'owned' && (createdId || container.Id !== admitted.id || container.Image !== admitted.image_id)))) {
        throw Error('database identity differs from the canonical phase admission');
      }
      owned(container, createdId || admitted?.id, false, admitted?.image_id);
      const pinnedId = container.Id;
      const pinnedImage = container.Image;
      const pinnedOwned = (value, loopback = true) => {
        const port = owned(value, pinnedId, loopback, pinnedImage);
        if (phase && (!pinnedId || !pinnedImage || value.HostConfig?.Memory !== 805306368 ||
            value.HostConfig?.MemorySwap !== 1610612736 || value.HostConfig?.NanoCpus !== 2000000000 ||
            value.HostConfig?.Binds?.length || value.Mounts?.length)) {
          throw Error('phase database effective limits or immutable identity changed');
        }
        return port;
      };
      pinnedOwned(container, false);
      if (!container.State?.Running) {
        docker(['start', pinnedId]);
        container = inspect();
      }
      let port = pinnedOwned(container);
      if (!container.State?.Running) throw new Error('owned database did not start');
      if (phase) {
        const acquisition = { ...phase.receipt, state: 'phase-acquired', at: Date.now() / 1000,
          admission_sha256: phase.admission_sha256, container: { id: pinnedId, image_id: pinnedImage } };
        writeFileSync(`${phase.acquisition_path}.tmp`, JSON.stringify(acquisition) + '\n', { flag: 'wx', mode: 0o600 });
        renameSync(`${phase.acquisition_path}.tmp`, phase.acquisition_path);
      }
      // The image's temporary initialization server accepts Unix sockets before
      // the published TCP server is ready for Prisma migrations.
      docker(['exec', pinnedId, 'bash', '-c', 'for i in {1..45}; do pg_isready -h 127.0.0.1 -U fitsy_test -d fitsy_test >/dev/null && exit 0; sleep 1; done; exit 1']);
      // Recheck the owner and network immediately before the destructive reset.
      container = inspect();
      port = pinnedOwned(container);
      if (!container.State?.Running) throw new Error('owned database stopped before reset');
      docker(['exec', pinnedId, 'psql', '-U', 'fitsy_test', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'DROP DATABASE IF EXISTS fitsy_verify WITH (FORCE)', '-c', 'CREATE DATABASE fitsy_verify']);
      const url = `postgresql://fitsy_test:fitsy_test@127.0.0.1:${port}/fitsy_verify`;
      const childEnv = { ...env, POSTGRES_PRISMA_URL: url, POSTGRES_URL_NON_POOLING: url,
        FITSY_VERIFY_CALLER_NON_POOLING_URL: env.POSTGRES_URL_NON_POOLING ?? '',
        FITSY_VERIFY_OWNED_DB: container.Id, FITSY_VERIFY_DB_IMAGE: container.Image, FITSY_LOCAL_DB: '1',
        FITSY_VERIFY_DB_HOST: container.NetworkSettings.Ports['5432/tcp'][0].HostIp };
      for (const commandArgs of [['node_modules/prisma/build/index.js', 'migrate', 'deploy'], ['node_modules/tsx/dist/cli.mjs', 'prisma/seed.ts', '--data-only']]) {
        assert(childEnv);
        const result = spawn(process.execPath, commandArgs, { cwd: root, env: childEnv, stdio: 'inherit' });
        if (result.status !== 0) throw new Error('owned database migration or seed failed');
      }
      assert(childEnv);
      return spawn(process.execPath, ['scripts/verify/run.mjs', ...args], { cwd: root, env: childEnv,
        stdio: 'inherit' }).status ?? 1;
    } catch (error) {
      if (createdId) {
        try { owned(inspect(), createdId); docker(['rm', '-f', createdId]); }
        catch { /* Preserve the original error and refuse to remove a changed owner. */ }
      }
      throw error;
    } finally { /* The supervisor releases its flock after this process group exits. */ }
  }
  return { assert, run, stop, name, owner };
}

export const assertOwnedDatabase = env => databaseControl().assert(env);
function withOwnedLock(operation, args = []) {
  const result = spawnSync('python3', [fileURLToPath(new URL('./db-lock.py', import.meta.url)), repository,
    process.execPath, fileURLToPath(import.meta.url), operation, ...args], { stdio: 'inherit' });
  if (result.status === 75) throw new Error('owned verification database is busy');
  if (result.error || result.status == null) throw result.error || new Error('owned database lock runner failed');
  return result.status;
}
export const runWithLocalDatabase = args => withOwnedLock('--locked-run', args);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv[2] === '--assert-owned-db') assertOwnedDatabase();
    else if (process.argv[2] === '--stop-owned-db') process.exitCode = withOwnedLock('--locked-stop');
    else if (process.argv[2] === '--locked-stop') { databaseControl().stop(); console.log('Stopped this worktree\'s owned verification database.'); }
    else if (process.argv[2] === '--locked-run') process.exitCode = databaseControl().run(process.argv.slice(3));
  } catch (error) {
    if (process.argv[2] === '--locked-run') console.log(JSON.stringify({ name: 'local-database', status: 'fail',
      summary: error.message, fix: 'repair the owned disposable database and rerun verification' }));
    else console.error(error.message);
    process.exitCode = 1;
  }
}
