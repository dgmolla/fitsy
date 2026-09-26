import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const moduleUrl = new URL('./local-db.mjs', `file://${resolve(__dirname, 'local-db.test.ts')}`).href;
function scenario(name: string) {
  const script = `
    import assert from 'node:assert/strict';
    import { mkdtempSync, rmSync, existsSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { databaseControl } from ${JSON.stringify(moduleUrl)};
    const root = mkdtempSync(join(tmpdir(), 'fitsy-db-boundary-'));
    const calls = [];
    const loopback = ['127', '0', '0', '1'].join('.');
    let container;
    let mode = ${JSON.stringify(name)};
    const command = (_file, args) => {
      calls.push(args);
      if (args[0] === 'inspect') {
        if (!container) { const error = new Error('missing'); error.code = 'ENOENT'; throw error; }
        return JSON.stringify([container]);
      }
      if (args[0] === 'run') { container = makeContainer(control.owner);
        if (mode === 'created_startup_failure') container.State.Running = false;
        return container.Id; }
      if (args[0] === 'start') { if (!mode.endsWith('startup_failure')) {
        container.State.Running = true;
        container.NetworkSettings.Ports = { '5432/tcp': [{ HostIp: loopback, HostPort: '55432' }] };
      } return container.Id; }
      if (args[0] === 'rm') { container = undefined; return ''; }
      if (args[0] === 'exec' && args[2] === 'bash' && mode === 'hijack_before_write') container.Config.Labels['fitsy.verify.owner'] = 'another-owner';
      if (args[0] === 'exec' && args[2] === 'bash' && mode === 'replacement_before_write') container.Id = 'replacement-id';
      return '';
    };
    function makeContainer(owner) {
      return { Id: 'owned-container-id', Image: 'sha256:image', Config: { Image: 'postgis/postgis:16-3.4',
        Labels: { 'fitsy.verify.owner': owner } }, State: { Running: true },
        NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: loopback, HostPort: '55432' }] } } };
    }
    const spawned = [];
    const control = databaseControl({ root, command, spawn: (_node, args, opts) => {
      spawned.push({ args, env: opts.env, resetBeforeSpawn: calls.some(call => call[0] === 'exec' && call.includes('psql')) });
      return { status: mode === 'migration_failure' && args[1] === 'migrate' ? 1 : 0 };
    }, disk: () => ({ bavail: mode === 'low_disk' ? 1 : 3 * 1024 ** 3, bsize: 1 }),
    assertLock: () => {}, env: { POSTGRES_PRISMA_URL: 'postgresql://external.example/prod',
      POSTGRES_URL_NON_POOLING: 'postgresql://external.example/prod' } });
    if (['wrong_owner', 'external_url', 'startup_failure', 'restart_stopped', 'hijack_before_write', 'replacement_before_write', 'existing_failure', 'stop_wrong_owner', 'stop_success', 'stop_stopped'].includes(mode)) container = makeContainer(control.owner);
    if (mode === 'wrong_owner' || mode === 'stop_wrong_owner') container.Config.Labels['fitsy.verify.owner'] = 'another-owner';
    if (mode === 'startup_failure') container.State.Running = false;
    if (mode === 'restart_stopped') { container.State.Running = false; container.NetworkSettings.Ports = null; }
    if (mode === 'stop_stopped') { container.State.Running = false; container.NetworkSettings.Ports = null; }
    if (mode === 'existing_failure') container.NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0';
    let error = '';
    try {
      if (mode === 'external_url') control.assert({ FITSY_VERIFY_OWNED_DB: container.Id,
        FITSY_VERIFY_DB_IMAGE: container.Image, POSTGRES_PRISMA_URL: 'postgresql://external.example/prod',
        POSTGRES_URL_NON_POOLING: 'postgresql://external.example/prod' });
      else if (mode.startsWith('stop_')) control.stop();
      else control.run(['--layer=2']);
    } catch (cause) { error = cause.message; }
    const result = { error, resetCalls: calls.filter(args => args[0] === 'exec' && args.includes('psql')),
      calls: calls.map(args => ['exec', 'rm'].includes(args[0]) ? args.slice(0, 3) : args.slice(0, 2)),
      spawned: spawned.map(item => ({ args: item.args, url: item.env.POSTGRES_PRISMA_URL,
        direct: item.env.POSTGRES_URL_NON_POOLING, id: item.env.FITSY_VERIFY_OWNED_DB,
        resetBeforeSpawn: item.resetBeforeSpawn })),
      lockExists: existsSync(join(root, '.evidence/verify/db.lock')), containerExists: !!container };
    process.stdout.write(JSON.stringify(result));
    rmSync(root, { recursive: true, force: true });
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as {
    error: string; calls: string[][]; resetCalls: string[][];
    spawned: { args: string[]; url: string; direct: string; id: string; resetBeforeSpawn: boolean }[];
    lockExists: boolean; containerExists: boolean;
  };
}

test.each(['wrong_owner', 'existing_failure', 'hijack_before_write', 'replacement_before_write'])('%s cannot reset a database', name => {
  const result = scenario(name);
  expect(result.error).toMatch(/ownership|loopback/);
  expect(result.calls.some(call => call.includes('psql'))).toBe(false);
  expect(result.spawned).toHaveLength(0);
  expect(result.lockExists).toBe(false);
});
test('external URLs are refused by the child ownership guard', () => {
  const result = scenario('external_url');
  expect(result.error).toMatch(/execution environment/);
  expect(result.calls).toEqual([['inspect', expect.stringMatching(/^fitsy-verify-/)]]);
});
test('startup failure preserves an existing owned container', () => {
  const result = scenario('startup_failure');
  expect(result.error).toMatch(/did not start/);
  expect(result.calls.some(call => call[0] === 'rm')).toBe(false);
  expect(result.containerExists).toBe(true);
  expect(result.lockExists).toBe(false);
});
test('a stopped owned container with no active port restarts before reset', () => {
  const result = scenario('restart_stopped');
  expect(result.error).toBe('');
  expect(result.calls.some(call => call[0] === 'start')).toBe(true);
  expect(result.calls.some(call => call.includes('psql'))).toBe(true);
  expect(result.spawned).toHaveLength(3);
});
test('startup failure retires a newly created container by its pinned ID', () => {
  const result = scenario('created_startup_failure');
  expect(result.error).toMatch(/did not start/);
  expect(result.calls).toContainEqual(['rm', '-f', 'owned-container-id']);
  expect(result.containerExists).toBe(false);
});
test('new container is retired after migration failure', () => {
  const result = scenario('migration_failure');
  expect(result.error).toMatch(/migration or seed failed/);
  expect(result.calls.some(call => call[0] === 'rm')).toBe(true);
  expect(result.containerExists).toBe(false);
  expect(result.spawned).toHaveLength(1);
});
test('low disk is rejected before Docker starts', () => {
  const result = scenario('low_disk');
  expect(result.error).toMatch(/2 GiB/);
  expect(result.calls).toHaveLength(0);
});
test('controlled flow overrides configured external URLs and checks ownership before each write', () => {
  const result = scenario('success');
  expect(result.error).toBe('');
  expect(result.spawned).toHaveLength(3);
  for (const child of result.spawned) {
    expect(child.url).toBe('postgresql://fitsy_test:fitsy_test@' + ['127', '0', '0', '1'].join('.') + ':55432/fitsy_verify');
    expect(child.direct).toBe(child.url);
    expect(child.id).toBe('owned-container-id');
  }
  expect(result.calls.filter(call => call[0] === 'inspect')).toHaveLength(6);
  expect(result.calls.some(call => call.includes('psql'))).toBe(true);
  expect(result.resetCalls).toEqual([['exec', 'owned-container-id', 'psql', '-U', 'fitsy_test', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-c', 'DROP DATABASE IF EXISTS fitsy_verify WITH (FORCE)',
    '-c', 'CREATE DATABASE fitsy_verify']]);
  expect(result.spawned.every(child => child.resetBeforeSpawn)).toBe(true);
  expect(result.lockExists).toBe(false);
});
test('explicit stop rejects a foreign container', () => {
  const result = scenario('stop_wrong_owner');
  expect(result.error).toMatch(/ownership/);
  expect(result.calls.some(call => call[0] === 'rm')).toBe(false);
});
test('explicit stop removes only the owned container ID', () => {
  const result = scenario('stop_success');
  expect(result.error).toBe('');
  expect(result.calls).toContainEqual(['rm', '-f', 'owned-container-id']);
  expect(result.containerExists).toBe(false);
});
test('explicit stop can retire an owned stopped container without an active port', () => {
  const result = scenario('stop_stopped');
  expect(result.error).toBe('');
  expect(result.calls).toContainEqual(['rm', '-f', 'owned-container-id']);
  expect(result.containerExists).toBe(false);
});

test('concurrent CLI attempts cannot reset DB, even when a coordinator dies with a live child', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'fitsy-db-flock-'));
  const lockScript = resolve(__dirname, 'db-lock.py');
  const marker = resolve(root, 'pids');
  const contender = () => spawnSync('python3', [lockScript, root, 'python3', '-c', 'print("acquired")'], { encoding: 'utf8' });
  const holderCode = `import os,subprocess,sys,time
child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(20)'],
  stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
open(${JSON.stringify(marker)},'w').write(f'{os.getpid()} {child.pid}')
time.sleep(20)`;
  const holder = spawn('python3', [lockScript, root, 'python3', '-c', holderCode], { stdio: 'ignore' });
  let workerPid = 0, childPid = 0;
  try {
    for (let i = 0; i < 40 && !existsSync(marker); i++) await new Promise(resolve => setTimeout(resolve, 25));
    expect(existsSync(marker)).toBe(true);
    workerPid = Number(readFileSync(marker, 'utf8').split(' ')[0]);
    childPid = Number(readFileSync(marker, 'utf8').split(' ')[1]);
    expect(contender().status).toBe(75);
    holder.kill('SIGKILL');
    expect(contender().status).toBe(75);
    process.kill(workerPid, 'SIGKILL');
    expect(() => process.kill(childPid, 0)).not.toThrow();
    expect(contender().status).toBe(75);
    process.kill(childPid, 'SIGTERM');
    let result = contender();
    for (let i = 0; i < 40 && result.status === 75; i++) {
      spawnSync('sleep', ['0.05']);
      result = contender();
    }
    expect(result.status).toBe(0);
  } finally {
    holder.kill('SIGTERM');
    try { process.kill(-workerPid, 'SIGKILL'); } catch { /* already exited */ }
    try { process.kill(childPid, 'SIGTERM'); } catch { /* already exited */ }
    rmSync(root, { recursive: true, force: true });
  }
});
