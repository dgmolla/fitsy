#!/usr/bin/env node
// Only this worktree's labelled disposable Docker database is ever mutated.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { statfsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { repository } from './impact-plan.mjs';

const image = 'postgis/postgis:16-3.4';
// The launcher and every admitted ownership assertion share the same limits.
// Callers can request this stronger contract, but cannot select weaker values.
const databaseLimits = Object.freeze({ Memory: 768 * 1024 ** 2, MemorySwap: 1536 * 1024 ** 2,
  NanoCpus: 2 * 1000000000 });
function assertDatabaseEnvelope(container) {
  if (!container.Id || !container.Image || Object.entries(databaseLimits).some(
    ([key, expected]) => container.HostConfig?.[key] !== expected) ||
      (container.HostConfig.Binds != null && (!Array.isArray(container.HostConfig.Binds) || container.HostConfig.Binds.length)) ||
      !Array.isArray(container.Mounts) || container.Mounts.length) {
    throw Error('phase database effective limits or immutable identity changed');
  }
}
const runCommand = (file, args, options) => execFileSync(file, args, options);

export function databaseControl({ root = repository, command = runCommand, spawn = spawnSync,
  disk = statfsSync, env = process.env, assertLock = () => {
    if (env.FITSY_VERIFY_DB_LOCKED !== '1') throw new Error('owned verification database lock is missing');
  } } = {}) {
  const owner = createHash('sha256').update(root).digest('hex').slice(0, 16);
  const name = `fitsy-verify-${owner}`;
  const docker = argv => {
    return command('docker', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).trim();
  };
  const inspect = () => JSON.parse(docker(['inspect', name]))[0];
  function owned(container, expectedId, requireLoopback = true, expectedImage, requireLimits = false) {
    if (container.Config?.Labels?.['fitsy.verify.owner'] !== owner || container.Config?.Image !== image ||
        (expectedId && container.Id !== expectedId) || (expectedImage && container.Image !== expectedImage)) throw new Error('refusing a database container with different ownership or image');
    if (requireLimits) assertDatabaseEnvelope(container);
    if (!requireLoopback) return null;
    const binding = container.NetworkSettings?.Ports?.['5432/tcp'];
    if (binding?.length !== 1 || binding[0].HostIp !== '127.0.0.1' || !/^\d+$/.test(binding[0].HostPort)) {
      throw new Error('owned DB must bind only to loopback');
    }
    return binding[0].HostPort;
  }
  function assert(envToCheck = env, { requireLimits = false } = {}) {
    const container = inspect();
    const port = owned(container, envToCheck.FITSY_VERIFY_OWNED_DB, true,
      envToCheck.FITSY_VERIFY_DB_IMAGE, requireLimits);
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
    const container = inspect();
    owned(container, pinnedId, false, pinnedImage);
    docker(['rm', '-f', pinnedId || container.Id]);
  }
  function prepare() {
    assertLock();
    let createdId, createdImage;
    try {
      const space = disk(root);
      if (space.bavail * space.bsize < 2 * 1024 ** 3) throw new Error('local verification needs 2 GiB free before starting its disposable DB');
      let container;
      try { container = inspect(); }
      catch (error) {
        if (error.code !== 'ENOENT' && !/No such (object|container)/i.test(error.stderr?.toString() ?? '')) throw error;
        createdId = docker(['run', '-d', '--name', name, '--memory', String(databaseLimits.Memory),
          '--memory-swap', String(databaseLimits.MemorySwap), '--cpus', String(databaseLimits.NanoCpus / 1000000000), '--label', `fitsy.verify.owner=${owner}`,
          '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
          '--env', 'POSTGRES_USER=fitsy_test', '--env', 'POSTGRES_PASSWORD=fitsy_test',
          '--env', 'POSTGRES_DB=fitsy_test', image]);
        container = inspect();
      }
      owned(container, createdId, false);
      const pinnedId = container.Id;
      const pinnedImage = container.Image;
      if (createdId) createdImage = pinnedImage;
      const pinnedOwned = (value, loopback = true) => {
        return owned(value, pinnedId, loopback, pinnedImage);
      };
      pinnedOwned(container, false);
      if (!container.State?.Running) {
        docker(['start', pinnedId]);
        container = inspect();
      }
      let port = pinnedOwned(container);
      if (!container.State?.Running) throw new Error('owned database did not start');
      // The image's temporary initialization server accepts Unix sockets before
      // the published TCP server is ready for Prisma migrations.
      docker(['exec', pinnedId, 'bash', '-c', 'for i in {1..45}; do pg_isready -h 127.0.0.1 -U fitsy_test -d fitsy_test >/dev/null && exit 0; sleep 1; done; exit 1']);
      // Recheck the acquired ownership, envelope and network before reset.
      container = inspect();
      port = pinnedOwned(container);
      if (!container.State?.Running) throw new Error('owned database stopped before reset');
      const url = `postgresql://fitsy_test:fitsy_test@127.0.0.1:${port}/fitsy_verify`;
      const childEnv = { ...env, POSTGRES_PRISMA_URL: url, POSTGRES_URL_NON_POOLING: url,
        FITSY_VERIFY_CALLER_NON_POOLING_URL: env.POSTGRES_URL_NON_POOLING ?? '',
        FITSY_VERIFY_OWNED_DB: container.Id, FITSY_VERIFY_DB_IMAGE: container.Image, FITSY_LOCAL_DB: '1',
        FITSY_VERIFY_DB_HOST: container.NetworkSettings.Ports['5432/tcp'][0].HostIp };
      assert(childEnv);
      const guard = spawn(process.execPath, ['--import', 'tsx', 'scripts/lib/db-target-guard.ts', '--dev-only',
        '--env=POSTGRES_PRISMA_URL', '--env=POSTGRES_URL_NON_POOLING'], { cwd: root, env: childEnv, stdio: 'inherit' });
      if (guard.status !== 0) throw new Error('owned database target guard failed');
      docker(['exec', pinnedId, 'psql', '-U', 'fitsy_test', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'DROP DATABASE IF EXISTS fitsy_verify WITH (FORCE)', '-c', 'CREATE DATABASE fitsy_verify']);
      for (const commandArgs of [['node_modules/prisma/build/index.js', 'migrate', 'deploy'], ['node_modules/tsx/dist/cli.mjs', 'prisma/seed.ts', '--data-only']]) {
        assert(childEnv);
        const result = spawn(process.execPath, commandArgs, { cwd: root, env: childEnv, stdio: 'inherit' });
        if (result.status !== 0) throw new Error('owned database migration or seed failed');
      }
      assert(childEnv);
      return childEnv;
    } catch (error) {
      if (createdId) {
        try {
          owned(inspect(), createdId, false, createdImage);
          docker(['rm', '-f', createdId]);
        }
        catch { /* Preserve the original error and refuse to remove a changed owner. */ }
      }
      throw error;
    } finally { /* The supervisor releases its flock after this process group exits. */ }
  }
  function run(args, verify) {
    assertLock();
    // The CLI keeps one pipeline inside the existing supervised lock. Preparation
    // stays deferred until that pipeline has passed its safety/build phase.
    if (verify) return verify(args, prepare);
    const childEnv = prepare();
    return spawn(process.execPath, ['scripts/verify/run.mjs', ...args], { cwd: root, env: childEnv,
      stdio: 'inherit' }).status ?? 1;
  }
  return { assert, run, stop, name, owner };
}

export const assertOwnedDatabase = env => databaseControl().assert(env);
export function withOwnedLock(operation, args = []) {
  const result = spawnSync('python3', [fileURLToPath(new URL('./db-lock.py', import.meta.url)), repository,
    process.execPath, fileURLToPath(new URL('./local-db.mjs', import.meta.url)), operation, ...args], { stdio: 'inherit' });
  if (result.status === 75) throw new Error('owned verification database is busy');
  if (result.error || result.status == null) throw result.error || new Error('owned database lock runner failed');
  return result.status;
}
export const runWithLocalDatabase = args => withOwnedLock('--locked-run', args);
