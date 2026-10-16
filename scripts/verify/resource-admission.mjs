#!/usr/bin/env node
import { parsePsIdentity, parsePsRuntime } from './docker-runtime.mjs';
import { existsSync, statfsSync, readFileSync, lstatSync, writeFileSync, renameSync, realpathSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { userInfo } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(import.meta.url);
export function admitResources({ root = resolve(dirname(file), '../..'), exists = existsSync,
  disk = statfsSync, env = process.env } = {}) {
  if (!exists(resolve(root, 'node_modules/js-yaml'))) {
    return { name: 'resource-admission', status: 'fail', summary: 'dependencies are missing',
      fix: 'install the locked dependencies before verification' };
  }
  if (env.FITSY_VERIFY_NEEDS_TEST_DEPS === '1' && !exists(resolve(root, 'node_modules/.bin/jest'))) {
    return { name: 'resource-admission', status: 'fail', summary: 'dependencies are missing',
      fix: 'install the locked dependencies before verification' };
  }
  const minimum = (env.FITSY_VERIFY_NEEDS_NATIVE === '1' ? 8 : 2) * 1024 ** 3;
  const space = disk(root);
  if (space.bavail * space.bsize < minimum) {
    return { name: 'resource-admission', status: 'fail', summary: `free disk is below the ${minimum / 1024 ** 3} GiB admission floor`,
      fix: 'release only task-owned disposable resources before the next build or test' };
  }
  return { name: 'resource-admission', status: 'pass', summary: 'dependency and resource admission passed', fix: '' };
}

// The DB phase is an opt-in part of the existing locked local verification
// route. Its authority lives beside the installed review operator, never in
// the candidate checkout or in a path supplied by the candidate environment.
const GIB = 1024 ** 3;
const HOST_RESERVE = 4 * GIB;
const HOST_STOP = Math.floor(4.25 * GIB);
const DISK_FLOOR = 12 * GIB;
const GIT = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const DOCKER = '/usr/local/bin/docker';
const SYSCTL = '/usr/sbin/sysctl';
const VM_STAT = '/usr/bin/vm_stat';

export function kernelPressure(raw) {
  const match = /^kern\.memorystatus_vm_pressure_level: *([0-9]+)$/.exec(raw.trim());
  return match?.[1] === '1' ? 'normal' : match?.[1] === '2' ? 'warning'
    : match?.[1] === '4' ? 'critical' : 'unknown';
}

function custodyAncestors(path, uid) {
  for (let parent = dirname(path); ; parent = dirname(parent)) {
    const value = lstatSync(parent);
    if (value.isSymbolicLink() || ![0, uid].includes(value.uid) || (value.mode & 0o022)) {
      throw Error('phase custody has a writable or unowned ancestor');
    }
    if (parent === dirname(parent)) break;
  }
}
function privateFile(path, uid, mode) {
  if (!isAbsolute(path)) throw Error('phase authority must have an absolute canonical path');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== uid || (stat.mode & 0o777) !== mode || realpathSync(path) !== path) {
    throw Error('phase authority or receipt has wrong custody');
  }
  custodyAncestors(path, uid);
  return stat;
}
function privateDirectory(path, uid) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o777) !== 0o700 || realpathSync(path) !== path) {
    throw Error('phase authority directory has wrong custody');
  }
  custodyAncestors(path, uid);
}
function hash(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function readGit(root, ...args) { return execFileSync(GIT, ['-C', root, ...args], {
  encoding: 'utf8', timeout: 15000,
  env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
}).trim(); }
export function hostSnapshot(command = (binary, args) => execFileSync(binary, args,
  { encoding: 'utf8', timeout: 15000 }), disk = statfsSync,
  root = resolve(dirname(file), '../..')) {
  const vm = command(VM_STAT, []);
  const page = Number(/page size of (\d+) bytes/.exec(vm)?.[1]);
  const pages = ['Pages free', 'Pages inactive', 'Pages speculative'].map(name =>
    Number(new RegExp(`^${name}:\\s*(\\d+)`, 'm').exec(vm)?.[1]));
  const swap = command(SYSCTL, ['vm.swapusage']);
  const usedSwap = Number(/used = ([\d.]+)M/.exec(swap)?.[1]);
  const pressureRaw = command(SYSCTL, ['kern.memorystatus_vm_pressure_level']);
  const filesystem = disk(root);
  if (![page, ...pages, usedSwap, filesystem.bavail, filesystem.bsize].every(Number.isFinite)) {
    throw Error('host memory, swap or disk observation is incomplete');
  }
  return { at: Date.now(), available_memory_bytes: pages.reduce((a, b) => a + b, 0) * page,
    free_disk_bytes: filesystem.bavail * filesystem.bsize, used_swap_mb: usedSwap,
    memory_pressure: kernelPressure(pressureRaw), pressure_raw: pressureRaw.trim() };
}
function requireHost(snapshot, native, reserve) {
  if (snapshot.available_memory_bytes < HOST_STOP) throw Error('host approached fixed 4.25 GiB stop');
  if (snapshot.free_disk_bytes < DISK_FLOOR) throw Error('host disk is below fixed 12 GiB floor');
  if (snapshot.used_swap_mb !== 0) throw Error('host swap is not flat zero');
  if (snapshot.memory_pressure !== 'normal') throw Error('normal kernel memory pressure is unverified');
  if (snapshot.available_memory_bytes < native + reserve) throw Error('phase native peak plus host reserve unavailable');
}
function daemonInfo(raw) {
  const fields = raw.trim().split('|');
  if (fields.length !== 4 || !fields[0] || !fields[1] ||
      !/^\d+$/.test(fields[2]) || !/^\d+$/.test(fields[3])) return null;
  return { id: fields[0], version: fields[1], memory_bytes: Number(fields[2]), cpus: Number(fields[3]) };
}
function dockerCall(args, command) { return command(DOCKER, args); }
function exactOwnedName(root) { return `fitsy-verify-${createHash('sha256').update(root).digest('hex').slice(0, 16)}`; }
function inspectDatabase(root, command) {
  let raw;
  try { raw = command(DOCKER, ['inspect', exactOwnedName(root)]); }
  catch (error) {
    if (/No such (object|container)/i.test(error.stderr?.toString() ?? '')) return null;
    throw Error('owned DB inspection is unavailable');
  }
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows) || rows.length !== 1) throw Error('owned DB inspection is malformed');
  return rows[0];
}
function assertPhaseLock(root) {
  const fd = Number(process.env.FITSY_VERIFY_DB_LOCK_FD);
  if (!Number.isSafeInteger(fd) || fd < 3) throw Error('actual inherited phase lock descriptor is missing');
  const checked = spawnSync('/Applications/Xcode.app/Contents/Developer/usr/bin/python3', ['-I',
    join(root, 'scripts/verify/db-lock.py'), '--assert-phase-lock', root, String(process.ppid)],
  { stdio: ['ignore', 'pipe', 'pipe', fd], encoding: 'utf8', timeout: 15000 });
  if (checked.error || checked.status !== 0) throw Error('actual inherited phase lock ownership is unverified');
}

export async function admitOwnedDatabasePhase({ root = resolve(dirname(file), '../..'),
  command = (binary, args) => execFileSync(binary, args, { encoding: 'utf8', timeout: 60000 }),
  disk = statfsSync, inspect = inspectDatabase,
  sessionCheck = () => spawnSync(join(root, 'scripts/verify/shipping-session.mjs'), ['--check'],
    { cwd: root, env: process.env, stdio: 'ignore', timeout: 30000 }),
  sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } = {}) {
  if (process.env.FITSY_VERIFY_DB_PHASE !== '1' || process.env.FITSY_VERIFY_DB_LOCKED !== '1') {
    throw Error('owned DB phase requires the locked route');
  }
  assertPhaseLock(root);
  const session = sessionCheck();
  if (session.error || session.status !== 0) throw Error('live shipping and canonical review assertion failed');
  const uid = process.getuid();
  const account = userInfo();
  if (process.env.HOME !== account.homedir || realpathSync(root) !== root) throw Error('noncanonical account or candidate root');
  const admin = join(account.homedir, '.fitsy-review');
  const operators = join(admin, 'operators');
  const completed = join(admin, 'completed');
  privateDirectory(admin, uid);
  privateDirectory(operators, uid);
  privateDirectory(completed, uid);
  const bindingPath = join(root, '.evidence/delivery/binding.json');
  const issue = JSON.parse(readFileSync(bindingPath, 'utf8')).issue;
  if (!Number.isSafeInteger(issue) || issue < 1) throw Error('current delivery issue is invalid');
  const authorityPath = join(operators, `issue-${issue}-phase-admission.json`);
  privateFile(authorityPath, uid, 0o600);
  const authority = JSON.parse(readFileSync(authorityPath, 'utf8'));
  const keys = ['version', 'issue', 'candidate_root', 'source_sha', 'base_sha', 'selected_package_path', 'selected_package_sha',
    'completed_manifest_sha256', 'review_ledger_sha256', 'review_control_sha', 'native_peak_bytes',
    'cold_required_bytes', 'receipt_directory', 'execution_id', 'files_sha256'];
  if (Object.keys(authority).sort().join('|') !== keys.sort().join('|') || authority.issue !== issue ||
      authority.version !== 1 || authority.candidate_root !== root ||
      !/^[0-9a-f-]{36}$/.test(authority.execution_id) || !Number.isSafeInteger(authority.native_peak_bytes) ||
      authority.native_peak_bytes <= 0 || !Number.isSafeInteger(authority.cold_required_bytes) ||
      authority.cold_required_bytes < authority.native_peak_bytes + HOST_RESERVE) {
    throw Error('private phase authority schema or fixed budget is invalid');
  }
  for (const key of ['source_sha', 'base_sha', 'selected_package_sha', 'review_control_sha']) {
    if (!/^[0-9a-f]{40}$/.test(authority[key])) throw Error('phase revision identity is invalid');
  }
  for (const key of ['completed_manifest_sha256', 'review_ledger_sha256']) {
    if (!/^[0-9a-f]{64}$/.test(authority[key])) throw Error('phase evidence identity is invalid');
  }
  if (readGit(root, 'rev-parse', 'HEAD') !== authority.source_sha ||
      readGit(root, 'rev-parse', 'origin/main') !== authority.base_sha ||
      readGit(root, 'status', '--porcelain', '--untracked-files=all')) {
    throw Error('source changed before owned DB phase admission');
  }
  const packageRoot = authority.selected_package_path;
  if (!isAbsolute(packageRoot) || packageRoot === root ||
      readGit(packageRoot, 'rev-parse', 'HEAD') !== authority.selected_package_sha ||
      readGit(packageRoot, 'status', '--porcelain', '--untracked-files=all')) {
    throw Error('selected package changed before owned DB phase admission');
  }
  const manifestPath = join(completed, `issue-${issue}.json`);
  privateFile(manifestPath, uid, 0o600);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const ledgerPath = join(account.homedir, '.cache/fitsy-review/budgets', `issue-${issue}.jsonl`);
  privateFile(ledgerPath, uid, 0o600);
  if (hash(ledgerPath) !== authority.review_ledger_sha256 ||
      hash(manifestPath) !== authority.completed_manifest_sha256 ||
      manifest.source_sha !== authority.source_sha || manifest.base_sha !== authority.base_sha ||
      manifest.control_sha !== authority.review_control_sha) {
    throw Error('current canonical independent review changed before DB phase');
  }
  const directory = authority.receipt_directory;
  if (!isAbsolute(directory) || !relative(root, directory).startsWith('..') ||
      !relative(packageRoot, directory).startsWith('..') || !relative(admin, directory).startsWith('..')) {
    throw Error('phase receipt destination overlaps candidate or operator custody');
  }
  privateDirectory(directory, uid);
  const expectedFiles = [join(root, 'scripts/verify/db-lock.py'), file, join(root, 'scripts/verify/local-db.mjs'), join(root, 'scripts/verify/docker-runtime.mjs'),
    join(directory, 'run.py'), join(directory, 'task.sh'), join(directory, 'db_observation.py')].sort();
  if (Object.keys(authority.files_sha256 ?? {}).sort().join('|') !== expectedFiles.join('|')) throw Error('phase caller/helper binding is incomplete');
  for (const path of expectedFiles) {
    if (realpathSync(path) !== path || hash(path) !== authority.files_sha256[path]) throw Error('phase caller/helper bytes changed');
  }
  const processRows = command('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,lstart=,command=']).split('\n').map(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/.exec(line);
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]),
      lstart: match[4].trim(), command: match[5] } : null;
  }).filter(Boolean);
  const ancestors = [];
  let parent = process.ppid;
  for (let count = 0; parent > 1 && count < 30; count++) {
    const row = processRows.find(item => item.pid === parent);
    if (!row || ancestors.some(item => item.pid === parent)) break;
    ancestors.push(row); parent = row.ppid;
  }
  const task = ancestors.find(row => row.command === `/bin/bash ${join(directory, 'task.sh')}`);
  const shipping = ancestors.find(row => row.command.endsWith(`scripts/verify/shipping-session.mjs -- /bin/bash ${join(directory, 'task.sh')}`));
  const launcher = ancestors.find(row => row.command.endsWith(` ${join(directory, 'run.py')}`));
  if (!task || !shipping || !launcher || task.ppid !== shipping.pid || shipping.ppid !== launcher.pid ||
      !ancestors[0] || ancestors[0].pid !== process.ppid || ancestors[0].pgid !== shipping.pgid) {
    throw Error('phase request is not descended from the exact owned full caller');
  }
  const receipt = join(directory, `phase-admission-${process.ppid}.json`);
  const intent = join(directory, `phase-intent-${process.ppid}.json`);
  if (existsSync(receipt) || existsSync(intent)) throw Error('phase attempt already exists; preserve prior attempt');
  const native = authority.native_peak_bytes;
  const reserve = HOST_RESERVE;
  const before = hostSnapshot(command, disk, root);
  if (before.available_memory_bytes < HOST_STOP || before.free_disk_bytes < DISK_FLOOR ||
      before.used_swap_mb !== 0 || before.memory_pressure !== 'normal') {
    throw Error('fixed host disk, swap, pressure or stop guard refused DB phase');
  }
  const ownGroup = Number(command('/bin/ps', ['-p', String(process.pid), '-o', 'pgid=']).trim());
  const competitors = command('/bin/ps', ['-axo', 'pid=,pgid=,command=']).split('\n').filter(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    return match && Number(match[2]) !== ownGroup &&
      /scripts\/verify\/(?:run|shipping-session)\.mjs|node_modules\/(?:\.bin\/)?jest|\bxcodebuild\b|\bgradle\b|docker (?:run|build)/.test(match[3]);
  });
  if (!Number.isSafeInteger(ownGroup) || ownGroup <= 0 || competitors.length) throw Error('external heavy execution or owned group identity is unverified');
  const identity = () => parsePsIdentity(command('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,command=']));
  const observeRuntime = () => parsePsRuntime(command('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,command=']));
  const firstRuntime = observeRuntime();
  sleep(250);
  const secondRuntime = observeRuntime();
  if (firstRuntime.state === 'unverified' || JSON.stringify(firstRuntime) !== JSON.stringify(secondRuntime)) {
    throw Error('initial Docker runtime is unknown or unstable');
  }
  const warm = firstRuntime.state === 'live';
  if (before.available_memory_bytes < authority.cold_required_bytes &&
      !(warm && before.available_memory_bytes >= native + reserve)) {
    throw Error('cold startup budget unavailable and no stable exact warm guest exists');
  }
  const exactWarm = before.available_memory_bytes < authority.cold_required_bytes;
  // Capacity mode does not release custody of an already observed live guest.
  let runtimeIdentity = firstRuntime.identity;
  let startupAttempt;
  const startupObservations = [];
  const context = { issue, source_sha: authority.source_sha, selected_package_sha: authority.selected_package_sha,
    completed_manifest_sha256: authority.completed_manifest_sha256, review_ledger_sha256: authority.review_ledger_sha256,
    execution_id: authority.execution_id, authority_sha256: hash(authorityPath), lock_pid: process.ppid,
    lock_identity: ancestors[0], shipping_identity: shipping, launcher_identity: launcher,
    task_identity: task, helper_pid: process.pid, at: Date.now() / 1000 };
  const publish = (path, value) => {
    writeFileSync(`${path}.tmp`, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(`${path}.tmp`, path);
  };
  publish(intent, { ...context, state: 'phase-acquiring', before, exact_warm: exactWarm,
    initial_runtime: firstRuntime });
  function bindStartedRuntime(observed) {
    runtimeIdentity = observed.identity;
    const restart = Error('cold startup guest observed; restart complete runtime-bound readiness');
    restart.restartBoundReadiness = true;
    throw restart;
  }
  const checkedDocker = args => {
    const observed = observeRuntime();
    if (runtimeIdentity) {
      if (observed.state !== 'live' || JSON.stringify(observed.identity) !== JSON.stringify(runtimeIdentity)) {
        throw Error('admitted Docker backend or guest changed before API call');
      }
    } else {
      if (observed.state === 'unverified' || JSON.stringify(observed.backend) !== JSON.stringify(firstRuntime.backend)) {
        throw Error('cold startup Docker backend or guest is unknown or changed');
      }
      if (observed.state === 'live') bindStartedRuntime(observed);
    }
    const preliminary = !runtimeIdentity ? { operation: args[0], at: Date.now() / 1000, result: 'attempted' } : null;
    if (preliminary) startupAttempt.operations.push(preliminary);
    try {
      const result = dockerCall(args, command);
      if (preliminary) preliminary.result = 'completed';
      return result;
    } catch (error) {
      if (preliminary) preliminary.result = 'failed';
      throw error;
    }
  };
  const priorInvocations = readdirSync(directory).filter(name => /^phase-admission-\d+\.json$/.test(name)).map(name => {
    const path = join(directory, name); privateFile(path, uid, 0o600);
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value.state === 'phase-ready' && value.execution_id === authority.execution_id &&
      value.authority_sha256 === context.authority_sha256 && value.source_sha === authority.source_sha &&
      value.shipping_identity?.pid === shipping.pid && value.shipping_identity?.lstart === shipping.lstart
      ? { ...value, admission_sha256: hash(path) } : null;
  }).filter(Boolean);
  const priorAcquisitions = priorInvocations.map(value => {
    const path = join(directory, `phase-acquisition-${value.lock_pid}.json`);
    if (!existsSync(path)) return null;
    privateFile(path, uid, 0o600);
    const acquired = JSON.parse(readFileSync(path, 'utf8'));
    return acquired.state === 'phase-acquired' && acquired.admission_sha256 === value.admission_sha256 &&
      acquired.execution_id === value.execution_id && acquired.authority_sha256 === value.authority_sha256 &&
      acquired.source_sha === value.source_sha && acquired.lock_pid === value.lock_pid &&
      JSON.stringify(acquired.lock_identity) === JSON.stringify(value.lock_identity) &&
      JSON.stringify(acquired.shipping_identity) === JSON.stringify(value.shipping_identity) &&
      acquired.at >= value.at && acquired.container?.id && acquired.container?.image_id
      ? { admission: value, container: acquired.container } : null;
  }).filter(Boolean);
  const deadline = Date.now() + (exactWarm ? 0 : 60000);
  let ready;
  do {
    const bindingAtStart = runtimeIdentity;
    startupAttempt = { at: Date.now() / 1000, operations: [] };
    try {
      if (checkedDocker(['context', 'show']).trim() !== 'desktop-linux') throw Error('selected Docker context unavailable');
      startupAttempt.context = 'desktop-linux';
      const daemon = daemonInfo(checkedDocker(['info', '--format', '{{.ID}}|{{.ServerVersion}}|{{.MemTotal}}|{{.NCPU}}']));
      startupAttempt.daemon = daemon;
      if (!daemon || daemon.memory_bytes < 1610612736 || daemon.cpus < 2) throw Error('Docker daemon identity or effective limits unavailable');
      // Every API retains observed live custody, regardless of capacity mode.
      const existing = inspect(root, (_binary, args) => checkedDocker(args));
      if (existing) {
        if (!priorAcquisitions.some(value => value.container.id === existing.Id && value.container.image_id === existing.Image) ||
            !existing.State?.Running || !existing.Image) throw Error('existing DB lacks current session acquired identity, ownership or effective limits');
        const port = existing.NetworkSettings?.Ports?.['5432/tcp']?.[0]?.HostPort;
        const url = `postgresql://fitsy_test:fitsy_test@127.0.0.1:${port}/fitsy_verify`;
        const { databaseControl } = await import('./local-db.mjs');
        databaseControl({ root, command: (_binary, args) => checkedDocker(args), env: {
          FITSY_VERIFY_OWNED_DB: existing.Id, FITSY_VERIFY_DB_IMAGE: existing.Image,
          POSTGRES_PRISMA_URL: url, POSTGRES_URL_NON_POOLING: url,
        } }).assert(undefined, { requireLimits: true });
      }
      const running = checkedDocker(['ps', '--no-trunc', '--format', '{{.ID}}|{{.Names}}|{{.Status}}']).trim().split('\n').filter(Boolean);
      if (running.length !== (existing ? 1 : 0) || (existing && !running[0].startsWith(`${existing.Id}|${exactOwnedName(root)}|`))) {
        throw Error('running Docker container inventory has an unrelated consumer');
      }
      const observed = observeRuntime();
      if (!runtimeIdentity) {
        if (observed.state === 'unverified' || JSON.stringify(observed.backend) !== JSON.stringify(firstRuntime.backend)) {
          throw Error('cold startup Docker backend or guest is unknown or changed');
        }
        if (observed.state === 'live') bindStartedRuntime(observed);
        throw Error('positive Docker backend and guest ancestry unavailable');
      }
      if (observed.state !== 'live' || JSON.stringify(observed.identity) !== JSON.stringify(runtimeIdentity)) {
        throw Error('admitted Docker backend or guest changed after API observations');
      }
      const currentIdentity = runtimeIdentity;
      if (existing && !priorAcquisitions.some(({ admission: value, container }) => container.id === existing.Id && container.image_id === existing.Image && JSON.stringify(value.readiness?.identity) === JSON.stringify(currentIdentity) &&
          value.readiness?.daemon?.id === daemon.id && value.readiness?.daemon?.version === daemon.version)) {
        throw Error('existing DB runtime differs from this session acquisition');
      }
      ready = { daemon, daemon_raw: `${daemon.id}|${daemon.version}|${daemon.memory_bytes}|${daemon.cpus}`,
        identity: currentIdentity, context: 'desktop-linux', owned_db: existing ? { state: 'owned', id: existing.Id,
          image_id: existing.Image } : { state: 'absent' }, running_containers: running };
      break;
    } catch (error) {
      if (!bindingAtStart) startupObservations.push({ ...startupAttempt, state: 'preliminary', reason: error.message });
      error.startupObservations = startupObservations;
      if (error.restartBoundReadiness && Date.now() < deadline) continue;
      if (Date.now() >= deadline || !/daemon identity or effective limits unavailable|positive Docker backend and guest ancestry unavailable/.test(error.message)) throw error;
      sleep(2000);
    }
  } while (Date.now() < deadline);
  if (!ready) throw Error('Docker readiness deadline expired');
  const warmFirst = hostSnapshot(command, disk, root);
  sleep(1000);
  const warmSecond = hostSnapshot(command, disk, root);
  requireHost(warmFirst, native, reserve);
  requireHost(warmSecond, native, reserve);
  if (JSON.stringify(identity()) !== JSON.stringify(ready.identity)) throw Error('Docker guest changed after warm admission');
  // Revalidate immutable source, evidence and callers immediately before release
  // to the first local-db API. A readiness response cannot approve source drift.
  if (readGit(root, 'rev-parse', 'HEAD') !== authority.source_sha ||
      readGit(root, 'rev-parse', 'origin/main') !== authority.base_sha ||
      readGit(root, 'status', '--porcelain', '--untracked-files=all') ||
      readGit(packageRoot, 'rev-parse', 'HEAD') !== authority.selected_package_sha ||
      readGit(packageRoot, 'status', '--porcelain', '--untracked-files=all') ||
      hash(manifestPath) !== authority.completed_manifest_sha256 || hash(ledgerPath) !== authority.review_ledger_sha256 ||
      hash(authorityPath) !== context.authority_sha256 || expectedFiles.some(path => hash(path) !== authority.files_sha256[path])) {
    throw Error('source, authority or evidence changed during DB readiness');
  }
  const result = { ...context, state: 'phase-ready', authority_path: authorityPath,
    receipt_path: receipt, at: Date.now() / 1000, before, warm_first: warmFirst,
    warm_second: warmSecond, readiness: ready, startup_observations: startupObservations,
    budget: { native_peak_bytes: native, host_reserve_bytes: reserve,
      cold_required_bytes: authority.cold_required_bytes, host_stop_bytes: HOST_STOP, disk_floor_bytes: DISK_FLOOR } };
  publish(receipt, result);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === file) {
  const result = process.argv[2] === '--host-snapshot'
    ? hostSnapshot()
    : process.argv[2] === '--owned-db-phase'
    ? await (async () => { try { return await admitOwnedDatabasePhase(); }
      catch (error) { return { state: 'refused', reason: error.message,
        ...(error.startupObservations?.length ? { startup_observations: error.startupObservations } : {}) }; } })()
    : admitResources();
  console.log(JSON.stringify(result));
  process.exitCode = process.argv[2] === '--host-snapshot' || result.status === 'pass' || result.state === 'phase-ready' ? 0 : 1;
}
