import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, constants, cpSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, statfsSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fixtureProcess, signalFixtureProcess, type FixtureProcess } from './lock-fixture-process';

const source = resolve(__dirname, '../..');
type DatabaseCase = { name: string; hijack: boolean; deny: boolean; unlocked: boolean;
  checkFailure: boolean; devDrift: boolean; focused?: boolean; missing?: boolean;
  scriptFocused?: boolean; wholeGroup?: string; delegation?: boolean; canonical?: boolean; standalone?: boolean;
  cheapFailure?: boolean; missingCheap?: boolean; repeat?: boolean };
test.each<DatabaseCase>([
  { name: 'full delegation preserves cheap checks and fresh database focus', delegation: true, focused: true,
    hijack: false, deny: false, unlocked: false, checkFailure: false, devDrift: false },
  ...[
    { name: 'canonical full delegation builds before DB preparation', standalone: false },
    { name: 'standalone locked full delegation keeps safety and fresh reset evidence', standalone: true, repeat: true },
    { name: 'standalone locked full delegation stops at failed cheap work', standalone: true, cheapFailure: true },
    { name: 'canonical full delegation stops at missing cheap work', standalone: false, missingCheap: true },
  ].map(options => ({ ...options, delegation: true, focused: true, canonical: true,
    hijack: false, deny: false, unlocked: false, checkFailure: false, devDrift: false })),
  ...['api', 'scripts', 'mobile'].map(wholeGroup => ({ name: `whole ${wholeGroup} group`, wholeGroup,
    hijack: false, deny: false, unlocked: false, checkFailure: false, devDrift: false })),
  { name: 'whole scripts with changed owner', wholeGroup: 'scripts', hijack: true, deny: false, unlocked: false, checkFailure: false, devDrift: false },
  { name: 'failed whole scripts group', wholeGroup: 'scripts', hijack: false, deny: false, unlocked: false, checkFailure: true, devDrift: false },
  { name: 'focused script without caller URL', scriptFocused: true, focused: true, missing: true, hijack: false, deny: false, unlocked: false, checkFailure: false, devDrift: false },
  { name: 'focused script with caller URL', scriptFocused: true, focused: true, missing: false, hijack: false, deny: false, unlocked: false, checkFailure: false, devDrift: false },
  { name: 'focused API with caller URL', focused: true, missing: false, hijack: false, deny: false, unlocked: false, checkFailure: false, devDrift: false },
  { name: 'focused API without caller URL', focused: true, missing: true, hijack: false, deny: false, unlocked: false, checkFailure: false, devDrift: false },
  { name: 'healthy', hijack: false, deny: false, unlocked: false, checkFailure: false, devDrift: false },
  { name: 'owner changed', hijack: true, deny: false, unlocked: false, checkFailure: false, devDrift: false },
  { name: 'preflight failed', hijack: false, deny: true, unlocked: false, checkFailure: false, devDrift: false },
  { name: 'without OS lock', hijack: false, deny: false, unlocked: true, checkFailure: false, devDrift: false },
  { name: 'failing database check', hijack: false, deny: false, unlocked: false, checkFailure: true, devDrift: false },
  { name: 'dev drift retains caller URL', hijack: false, deny: false, unlocked: false, checkFailure: false, devDrift: true },
])('local database runner $name owns admission, URL and post-seed identity', ({ hijack, deny, unlocked, checkFailure, devDrift, focused = false, missing = false, scriptFocused = false, wholeGroup = '', delegation = false, canonical = false, standalone = false, cheapFailure = false, missingCheap = false, repeat = false }) => {
  const directory = mkdtempSync(join(tmpdir(), 'fitsy-db-cli-'));
  const write = (path: string, value: string) => {
    const target = join(directory, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value);
  };
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(GIT_|GITHUB_|FITSY_DIFF_|FITSY_RUNS$|CI$|PR_NUMBER$)/.test(key) &&
    !key.startsWith('FITSY_VERIFY_') && key !== 'FITSY_LOCAL_DB'));
  // Runtime data must not become unknown changed source in group selection.
  const data = wholeGroup || delegation ? join(directory, '.evidence') : directory;
  mkdirSync(data, { recursive: true });
  const state = join(data, 'docker-state.json');
  const reset = join(data, 'reset');
  const devUrl = join(data, 'dev-url');
  const seed = join(data, 'seed');
  const events = join(data, 'events.jsonl');
  const loopback = ['127', '0', '0', '1'].join('.');
  const owner = createHash('sha256').update(realpathSync(directory)).digest('hex').slice(0, 16);
  Object.assign(env, { PATH: `${join(directory, 'bin')}:${env.PATH}`, FITSY_TEST_STATE: state,
    FITSY_TEST_RESET: reset, FITSY_TEST_OWNER: owner, FITSY_TEST_HIJACK: hijack ? '1' : '0',
    FITSY_TEST_DENY: deny ? '1' : '0', FITSY_TEST_CHECK_FAIL: checkFailure ? '1' : '0', FITSY_TEST_DEV_URL: devUrl,
    ...(delegation ? { FITSY_TEST_SEED: seed, FITSY_TEST_EVENTS: events } : {}),
    POSTGRES_PRISMA_URL: 'postgresql://external.example/prod',
    POSTGRES_URL_NON_POOLING: 'postgresql://external.example/prod' });
  if (missing) { delete env.POSTGRES_PRISMA_URL; delete env.POSTGRES_URL_NON_POOLING; }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, env, encoding: 'utf8' }).trim();
  try {
    for (const file of ['run.mjs', 'impact-plan.mjs', 'local-db.mjs', 'local-db-control.mjs', 'db-lock.py', 'docker-runtime.mjs', 'receipt-cache.mjs']) {
      const target = `scripts/verify/${file}`;
      write(target, readFileSync(join(source, target), 'utf8'));
    }
    write('scripts/verify/registry.yml', 'checks:\n  - name: admission\n    script: admission.sh\n    layer: 0\n    blocking: true\n    preflight: true\n  - name: db-fixture\n    script: fixture.sh\n    layer: 2\n    blocking: true\n    database: true\n');
    if (wholeGroup) {
      write('scripts/verify/registry.yml', readFileSync(join(directory, 'scripts/verify/registry.yml'), 'utf8')
        .replace('name: db-fixture', 'name: test').replace('script: fixture.sh', 'script: test.sh'));
      write('scripts/verify/test.sh', readFileSync(join(source, 'scripts/verify/test.sh'), 'utf8'));
      const quote = (value: string) => "'" + value.replace(/'/g, "'\"'\"'") + "'";
      const python = execFileSync('/usr/bin/which', ['python3'], { env, encoding: 'utf8' }).trim();
      write('bin/node', `#!/bin/sh
if [ "$1" != --test ]; then exec ${quote(process.execPath)} "$@"; fi
echo scripts-node >> .evidence/groups
[ "$FITSY_TEST_CHECK_FAIL" != 1 ]
`);
      write('bin/python3', `#!/bin/sh
case "$1" in *.test.py) echo scripts-python >> .evidence/groups; [ "$FITSY_TEST_CHECK_FAIL" != 1 ] ;; *) exec ${quote(python)} "$@" ;; esac
`);
      write('bin/npm', `#!/bin/sh
[ "$FITSY_VERIFY_DB_LOCKED" = 1 ] && [ -f "$FITSY_TEST_RESET" ] &&
  [ "$POSTGRES_PRISMA_URL" = 'postgresql://fitsy_test:fitsy_test@${loopback}:55432/fitsy_verify' ] &&
  [ "$POSTGRES_URL_NON_POOLING" = "$POSTGRES_PRISMA_URL" ] || exit 1
case "$*" in *--workspace=apps/api*) group=api ;; *--workspace=@fitsy/scripts*) group=scripts ;; *--workspace=@fitsy/mobile*) group=mobile ;; *) exit 1 ;; esac
echo "$group" >> .evidence/groups
[ "$FITSY_TEST_CHECK_FAIL" != 1 ]
`);
      for (const name of ['node', 'python3', 'npm']) chmodSync(join(directory, 'bin', name), 0o755);
    }
    if (focused) {
      write('scripts/verify/registry.yml', readFileSync(join(directory, 'scripts/verify/registry.yml'), 'utf8').replace('name: db-fixture', 'name: focused-tests').replace('layer: 2', 'layer: 1'));
      write('.evidence/verify/focused-tests.json', JSON.stringify({ version: 1, tests: [scriptFocused ? 'scripts/hex-resume.test.ts' : 'apps/api/fixture.test.ts'] }));
    }
    if (delegation) {
      write('scripts/verify/registry.yml', readFileSync(join(directory, 'scripts/verify/registry.yml'), 'utf8') +
        '  - name: structural\n    script: cheap.sh\n    layer: 0\n    blocking: true\n    cache: true\n' +
        '  - name: db-fixture\n    script: database.sh\n    layer: 2\n    blocking: true\n    database: true\n');
      // Observe actual subprocess effects, retaining the caller and owned DB URLs.
      write('.evidence/event.mjs', `import fs from 'node:fs';
const read = path => fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : null;
fs.appendFileSync(process.env.FITSY_TEST_EVENTS, JSON.stringify({
  check: process.argv[2], generation: read(process.env.FITSY_TEST_RESET), seed: read(process.env.FITSY_TEST_SEED),
  locked: process.env.FITSY_VERIFY_DB_LOCKED, owned: process.env.FITSY_VERIFY_OWNED_DB ?? null,
  pooled: process.env.POSTGRES_PRISMA_URL ?? null, direct: process.env.POSTGRES_URL_NON_POOLING ?? null,
}) + '\\n');
`);
      if (!missingCheap) write('scripts/verify/cheap.sh', '#!/bin/sh\nnode .evidence/event.mjs cheap\n' + (cheapFailure ? 'exit 1\n' : ''));
      if (canonical) {
        write('scripts/verify/registry.yml', readFileSync(join(directory, 'scripts/verify/registry.yml'), 'utf8') +
          '  - name: review-admission\n    script: review.sh\n    layer: 0\n    stage: acceptance\n    blocking: true\n    preflight: true\n' +
          '  - name: build\n    script: build.sh\n    layer: 3\n    blocking: true\n');
        // Protected review is the external boundary; selection and source guards
        // stay in the real copied runner and receipt-cache implementation.
        write('scripts/verify/review.sh', '#!/bin/sh\nnode .evidence/event.mjs review\n');
        write('scripts/verify/build.sh', '#!/bin/sh\n' +
          '[ -z "$FITSY_VERIFY_DB_LOCKED$FITSY_VERIFY_OWNED_DB$POSTGRES_PRISMA_URL$POSTGRES_URL_NON_POOLING" ] || exit 1\n' +
          'node .evidence/event.mjs build\n');
      }
      write('scripts/verify/database.sh', '#!/bin/sh\nnode .evidence/event.mjs database\n');
    }
    if (devDrift) {
      write('scripts/verify/registry.yml', readFileSync(join(directory, 'scripts/verify/registry.yml'), 'utf8') +
        '  - name: dev-drift\n    script: dev-drift.sh\n    layer: 3\n    blocking: shadow\n');
      write('scripts/verify/dev-drift.sh', '#!/bin/sh\nprintf "%s" "$POSTGRES_URL_NON_POOLING" > "$FITSY_TEST_DEV_URL"\necho \'{"summary":"dev drift checked"}\'\n');
    }
    write('scripts/verify/admission.sh', '#!/bin/sh\n[ "$FITSY_TEST_DENY" != 1 ] || exit 1\n' +
      (delegation ? 'node .evidence/event.mjs admission\n' : ''));
    write('scripts/verify/fixture.sh', `#!/bin/sh\n[ "$FITSY_VERIFY_DB_LOCKED" = 1 ] && [ -f "$FITSY_TEST_RESET" ] &&
  [ "$POSTGRES_PRISMA_URL" = 'postgresql://fitsy_test:fitsy_test@${loopback}:55432/fitsy_verify' ] &&
  [ "$POSTGRES_URL_NON_POOLING" = "$POSTGRES_PRISMA_URL" ] || exit 1
printf '%s\\n' '{"summary":"owned database check executed"}'\n`);
    if (delegation) write('scripts/verify/fixture.sh', readFileSync(join(directory, 'scripts/verify/fixture.sh'), 'utf8') + 'node .evidence/event.mjs focused\n');
    if (checkFailure) write('scripts/verify/fixture.sh', readFileSync(join(directory, 'scripts/verify/fixture.sh'), 'utf8') + 'exit 1\n');
    write('bin/docker', `#!/usr/bin/env node
const fs=require('node:fs'); const args=process.argv.slice(2); const state=process.env.FITSY_TEST_STATE;
if(args[0]==='inspect') { if(!fs.existsSync(state)) { process.stderr.write('No such object'); process.exit(1); }
  process.stdout.write(JSON.stringify([JSON.parse(fs.readFileSync(state,'utf8'))])+'\\n'); }
else if(args[0]==='run') { fs.writeFileSync(state,JSON.stringify({Id:'owned-id',Image:'sha256:fixture',
  Config:{Image:'postgis/postgis:16-3.4',Labels:{'fitsy.verify.owner':process.env.FITSY_TEST_OWNER}},
  State:{Running:true},NetworkSettings:{Ports:{'5432/tcp':[{HostIp:'${loopback}',HostPort:'55432'}]}}}));
  process.stdout.write('owned-id\\n'); }
else if(args[0]==='exec') { if(args.includes('psql')) { const file=process.env.FITSY_TEST_RESET;
  fs.writeFileSync(file,process.env.FITSY_TEST_EVENTS ? String(Number(fs.existsSync(file) ? fs.readFileSync(file,'utf8') : 0)+1) : 'reset'); } }
else process.exit(1);
`);
    chmodSync(join(directory, 'bin/docker'), 0o755);
    mkdirSync(join(directory, 'node_modules'), { recursive: true });
    symlinkSync(join(source, 'node_modules/js-yaml'), join(directory, 'node_modules/js-yaml'));
    write('node_modules/prisma/build/index.js', "process.exit(0);\n");
    write('node_modules/tsx/dist/cli.mjs', `import fs from 'node:fs';
if (process.env.FITSY_TEST_EVENTS) {
  fs.writeFileSync(process.env.FITSY_TEST_SEED, fs.readFileSync(process.env.FITSY_TEST_RESET));
}
if (process.env.FITSY_TEST_HIJACK === '1') {
  const state = JSON.parse(fs.readFileSync(process.env.FITSY_TEST_STATE, 'utf8'));
  state.Config.Labels['fitsy.verify.owner'] = 'another-owner';
  fs.writeFileSync(process.env.FITSY_TEST_STATE, JSON.stringify(state));
}
`);
    write('.gitignore', 'node_modules\n.evidence\n');
    git('init', '-q'); git('config', 'user.name', 'CLI test'); git('config', 'user.email', 'test@example.test');
    git('add', '-A'); git('commit', '-qm', 'fixture'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    if (wholeGroup) {
      write(wholeGroup === 'scripts' ? 'scripts/review/example.py' : `apps/${wholeGroup}/lib/example.ts`, 'changed = true\n');
      git('add', '-A'); git('commit', '-qm', 'group candidate');
    }
    const verifyArgs = [canonical ? '--only=build,db-fixture'
      : `--only=admission,${delegation ? 'structural,focused-tests,db-fixture' : wholeGroup ? 'test' : focused ? 'focused-tests' : 'db-fixture'}${devDrift ? ',dev-drift' : ''}`,
      '--runs=local', ...(delegation ? ['--stage=full', '--reuse'] : [])];
    const command = standalone ? 'python3' : process.execPath;
    const argv = standalone
      ? ['scripts/verify/db-lock.py', directory, process.execPath, join(directory, 'scripts/verify/local-db.mjs'), '--locked-run', ...verifyArgs]
      : unlocked ? ['scripts/verify/local-db.mjs', '--locked-run', '--only=admission,db-fixture', '--runs=local']
        : ['scripts/verify/run.mjs', ...verifyArgs];
    const run = () => spawnSync(command, argv, { cwd: directory, env, encoding: 'utf8', timeout: 15000 });
    const result = run();
    const expectedStatus = hijack || deny || unlocked || checkFailure || cheapFailure || missingCheap ? 1 : 0;
    expect({ status: result.status, error: result.error?.message,
      diagnostics: result.status === expectedStatus ? '' : `${result.stdout}\n${result.stderr}` })
      .toEqual({ status: expectedStatus, error: undefined, diagnostics: '' });
    if (cheapFailure || missingCheap) {
      expect(existsSync(state)).toBe(false);
      expect(existsSync(reset)).toBe(false);
      const reported = result.stdout.trim().split('\n').map(line => JSON.parse(line));
      const failed = reported.filter(line => line.status === 'fail');
      expect(failed).toHaveLength(1);
      expect(failed[0]).toEqual(expect.objectContaining({ name: 'structural', status: 'fail', blocking: true }));
      if (missingCheap) expect(result.stdout).toContain('registry entry has no script cheap.sh');
      const observed = readFileSync(events, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      expect(observed.map(event => event.check)).toEqual(cheapFailure ? ['admission', 'cheap'] : ['admission']);
    } else if (unlocked) {
      expect(existsSync(state)).toBe(false);
      expect(existsSync(reset)).toBe(false);
      expect(result.stdout).toContain('owned verification database lock is missing');
    } else if (deny) {
      expect(existsSync(state)).toBe(false);
      expect(existsSync(reset)).toBe(false);
      expect(result.stdout).toContain('preflight failed');
    } else if (hijack) {
      expect(existsSync(reset)).toBe(true);
      expect(result.stdout).toContain('refusing a database container with different ownership or image');
      expect(result.stdout).not.toContain('owned database check executed');
      if (wholeGroup) expect(existsSync(join(directory, '.evidence/groups'))).toBe(false);
    } else {
      expect(existsSync(reset)).toBe(true);
      if (delegation) {
        const observed = readFileSync(events, 'utf8').trim().split('\n').map(line => JSON.parse(line));
        const cheap = observed.filter(event => event.check === 'cheap');
        const focusedChecks = observed.filter(event => event.check === 'focused');
        const database = observed.filter(event => event.check === 'database');
        expect(database).toHaveLength(1);
        for (const event of [...database, ...focusedChecks]) {
          expect(event.locked).toBe('1');
          expect(event.owned).toBe('owned-id');
          expect(Number(event.generation)).toBeGreaterThan(0);
          expect(event.seed).toBe(event.generation);
          expect(event.pooled).toBe(`postgresql://fitsy_test:fitsy_test@${loopback}:55432/fitsy_verify`);
          expect(event.direct).toBe(event.pooled);
        }
        expect(focusedChecks.length).toBeGreaterThan(0);
        // A reset invalidates DB observations even when the owned URL is unchanged.
        expect(new Set(focusedChecks.map(event => event.generation)).size).toBe(focusedChecks.length);
        expect(focusedChecks.at(-1).generation).toBe(database[0].generation);
        expect(cheap).toHaveLength(1);
        expect(cheap[0].owned).toBeNull();
        expect(cheap[0].pooled).toBe('postgresql://external.example/prod');
        const reported = result.stdout.trim().split('\n').map(line => JSON.parse(line));
        expect(reported.filter(line => line.name === 'structural' && line.status === 'pass')).toHaveLength(1);
        expect(reported.filter(line => line.name === 'focused-tests' && line.status === 'pass')).toHaveLength(1);
        expect(reported.filter(line => line.name === 'db-fixture' && line.status === 'pass')).toHaveLength(1);
        expect(observed.filter(event => event.check === 'admission')).toHaveLength(1);
        if (canonical) {
          expect(observed.map(event => event.check)).toEqual(['admission', 'cheap', 'review', 'build', 'focused', 'database']);
          expect(observed.find(event => event.check === 'build').generation).toBeNull();
          expect(reported.filter(line => line.name === 'review-admission' && line.status === 'pass')).toHaveLength(1);
          expect(reported.filter(line => line.name === 'build' && line.status === 'pass')).toHaveLength(1);
        }
        if (repeat) {
          writeFileSync(events, '');
          const next = run();
          expect({ status: next.status, stderr: next.status === 0 ? '' : next.stderr }).toEqual({ status: 0, stderr: '' });
          const nextEvents = readFileSync(events, 'utf8').trim().split('\n').map(line => JSON.parse(line));
          const fresh = nextEvents.filter(event => event.check === 'focused');
          expect(fresh).toHaveLength(1);
          expect(Number(fresh[0].generation)).toBeGreaterThan(Number(database[0].generation));
          expect(fresh[0].seed).toBe(fresh[0].generation);
          expect(fresh[0].owned).toBe('owned-id');
          expect(nextEvents.filter(event => event.check === 'database').map(event => event.generation)).toEqual([fresh[0].generation]);
          expect(nextEvents.filter(event => event.check === 'cheap').length).toBeLessThanOrEqual(1);
        }
      } else if (wholeGroup) {
        const groups = readFileSync(join(directory, '.evidence/groups'), 'utf8').trim().split('\n');
        expect(groups.filter(group => ['api', 'scripts', 'mobile'].includes(group))).toEqual([wholeGroup]);
        expect(groups.includes('scripts-node')).toBe(wholeGroup === 'scripts');
        expect(groups.includes('scripts-python')).toBe(wholeGroup === 'scripts');
        expect(result.stdout).toContain(`"name":"test","status":"${checkFailure ? 'fail' : 'pass'}"`);
      } else {
        expect(result.stdout).toContain('owned database check executed');
        if (checkFailure) expect(result.stdout).toContain('"name":"db-fixture","status":"fail"');
      }
      if (devDrift) expect(readFileSync(devUrl, 'utf8')).toBe('postgresql://external.example/prod');
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

// This adds real ordinary Linux DB evidence, not the protected macOS phase.
// Unsupported callers see an explicit skipped case, never a fabricated pass.
const realLinuxDatabase = process.platform === 'linux' && process.env.CI === 'true' ? test : test.skip;
realLinuxDatabase('real Linux CI database delegation resets seeded state without repeating cheap work', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'fitsy-real-db-cli-')));
  const owner = createHash('sha256').update(directory).digest('hex').slice(0, 16);
  const name = `fitsy-verify-${owner}`;
  const loopback = ['127', '0', '0', '1'].join('.');
  const evidence = join(source, '.evidence/verify/real-db-ci', owner);
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const write = (path: string, value: string) => {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value);
  };
  const digest = (path: string) => {
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024), fd = openSync(path, 'r');
    try { for (let bytes; (bytes = readSync(fd, buffer)) > 0;) hash.update(buffer.subarray(0, bytes)); }
    finally { closeSync(fd); }
    return hash.digest('hex');
  };
  const docker = realpathSync(execFileSync('/usr/bin/which', ['docker'], { encoding: 'utf8' }).trim());
  const python = realpathSync(execFileSync('/usr/bin/which', ['python3'], { encoding: 'utf8' }).trim());
  mkdirSync(join(directory, '.evidence/home'), { recursive: true, mode: 0o700 });
  mkdirSync(join(directory, '.evidence/tmp'), { mode: 0o700 });
  mkdirSync(join(directory, '.evidence/docker'), { mode: 0o700 });
  const cidfile = join(directory, '.evidence/docker/container.cid');
  const observerFault = join(directory, '.evidence/docker/fail-observer-after-create');
  const env = { HOME: join(directory, '.evidence/home'), TMPDIR: join(directory, '.evidence/tmp'),
    PATH: `${join(directory, 'bin')}:${dirname(process.execPath)}:${dirname(docker)}:${dirname(python)}:/usr/bin:/bin`,
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NODE_OPTIONS: '--max-old-space-size=512',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
    POSTGRES_PRISMA_URL: 'postgresql://caller.invalid/do-not-touch',
    POSTGRES_URL_NON_POOLING: 'postgresql://caller.invalid/do-not-touch' };
  const exec = (binary: string, args: string[], timeout = 15000) => execFileSync(binary, args,
    { cwd: directory, env, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 }).trim();
  const git = (...args: string[]) => exec('git', args);
  const realDocker = (...args: string[]) => exec(docker, args);
  const inspect = (target: string) => JSON.parse(realDocker('inspect', target))[0];
  const known = new Map<string, FixtureProcess>();
  const runs: { pid: number; status: number | null; signal: NodeJS.Signals | null;
    timedOut: boolean; seconds: number; stdout: string; stderr: string }[] = [];
  let acquired: { id: string; image: string } | undefined;
  let image = '', context = '', daemon = '';
  let acquisitionAttempted = false, observerFailureReached = false;
  let recoveredAfterObserverFailure: string | undefined;
  let failure: unknown;
  const capacity = () => {
    const available = Number(/^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1]) * 1024;
    const maximum = readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    const current = Number(readFileSync('/sys/fs/cgroup/memory.current', 'utf8').trim());
    const remaining = maximum === 'max' ? available : Number(maximum) - current;
    const fs = statfsSync(directory);
    // 1536MiB container envelope + 512MiB child heap + 1024MiB reserve.
    // The existing CI service/Jest worker are already charged in these fresh readings.
    expect(Math.min(available, remaining)).toBeGreaterThanOrEqual(3 * 1024 ** 3);
    expect(fs.bavail * fs.bsize).toBeGreaterThanOrEqual(2 * 1024 ** 3);
    return { available, cgroupMaximum: maximum, cgroupCurrent: current,
      remaining, required: 3 * 1024 ** 3, disk: fs.bavail * fs.bsize };
  };
  const validate = (container: ReturnType<typeof inspect>) => {
    expect(container.Name).toBe(`/${name}`);
    expect(container.Config.Labels['fitsy.verify.owner']).toBe(owner);
    expect(container.Config.Image).toBe('postgis/postgis:16-3.4');
    expect(container.Image).toBe(image);
    expect(container.HostConfig).toEqual(expect.objectContaining({ Memory: 768 * 1024 ** 2,
      MemorySwap: 1536 * 1024 ** 2, NanoCpus: 2 * 1000000000 }));
    expect(container.Mounts.every((mount: { Type: string }) => mount.Type === 'tmpfs')).toBe(true);
    expect(container.HostConfig.Binds ?? []).toEqual([]);
    expect(container.NetworkSettings.Ports['5432/tcp']).toEqual([
      expect.objectContaining({ HostIp: loopback, HostPort: expect.stringMatching(/^\d+$/) })]);
    if (acquired) expect(container.Id).toBe(acquired.id);
  };
  const creationIdentity = () => {
    // Docker writes the actual acquisition ID before its observer can lose stdout.
    const fd = openSync(cidfile, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(fd);
      expect(before.isFile() && before.nlink === 1 && before.uid === process.getuid?.() &&
        !(before.mode & 0o022)).toBe(true);
      const id = readFileSync(fd, 'utf8').trim();
      expect(id).toMatch(/^[a-f0-9]{64}$/);
      const after = lstatSync(cidfile);
      expect([after.dev, after.ino, after.uid, after.mode, after.nlink])
        .toEqual([before.dev, before.ino, before.uid, before.mode, before.nlink]);
      return { id, device: before.dev, inode: before.ino };
    } finally { closeSync(fd); }
  };
  const removeOwnedContainer = () => {
    expect(realDocker('context', 'show')).toBe(context);
    expect(realDocker('info', '--format', '{{.ID}}')).toBe(daemon);
    const creation = existsSync(cidfile) ? creationIdentity() : undefined;
    if (acquired) expect(creation?.id).toBe(acquired.id);
    const state = spawnSync(docker, ['inspect', creation?.id ?? name], { env, encoding: 'utf8', timeout: 15000 });
    if (state.status === 0) {
      const container = JSON.parse(state.stdout)[0]; validate(container);
      // Name/labels alone cannot establish an acquisition or authorize removal.
      if (!creation) throw Error('owned container has no durable Docker creation identity');
      expect(container.Id).toBe(creation.id);
      if (acquired) expect(container.Image).toBe(acquired.image);
      expect(realDocker('context', 'show')).toBe(context);
      expect(realDocker('info', '--format', '{{.ID}}')).toBe(daemon);
      realDocker('rm', '-f', creation.id);
      const gone = spawnSync(docker, ['inspect', creation.id], { env, encoding: 'utf8', timeout: 15000 });
      expect(gone.status).not.toBe(0); expect(gone.stderr).toMatch(/No such (object|container)/i);
    } else expect(state.stderr).toMatch(/No such (object|container)/i);
    if (creation) {
      const current = lstatSync(cidfile);
      expect([current.dev, current.ino]).toEqual([creation.device, creation.inode]);
      unlinkSync(cidfile);
    }
    return creation?.id;
  };
  const census = (root?: FixtureProcess) => {
    const rows = exec('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,lstart=']).split('\n').map(line => line.trim().split(/\s+/));
    const same = (expected: FixtureProcess, actual?: FixtureProcess) => actual?.pid === expected.pid &&
      actual.pgid === expected.pgid && actual.started === expected.started;
    const live = new Map<number, FixtureProcess>();
    // Neither a numeric root PID nor its replacement can establish ownership.
    for (const identity of [...known.values(), ...(root ? [root] : [])]) {
      if (same(identity, fixtureProcess(identity.pid))) live.set(identity.pid, identity);
    }
    for (let changed = true; changed;) {
      changed = false;
      for (const row of rows) {
        const parent = live.get(Number(row[1]));
        if (!parent || live.has(Number(row[0]))) continue;
        const snapshot = { pid: Number(row[0]), pgid: Number(row[2]), started: row.slice(3).join(' ') };
        const actual = fixtureProcess(snapshot.pid, parent.pid);
        // Revalidate both live identities before adopting this actual descendant.
        if (!same(parent, fixtureProcess(parent.pid)) || !same(snapshot, actual)) continue;
        live.set(snapshot.pid, snapshot);
        known.set(`${snapshot.pid}:${snapshot.started}:${snapshot.pgid}`, snapshot);
        changed = true;
      }
    }
    return rows;
  };
  const invoke = async (expectObserverFailure = false) => {
    capacity();
    expect(realDocker('context', 'show')).toBe(context);
    expect(JSON.parse(realDocker('info', '--format', '{{json .}}')).ID).toBe(daemon);
    const at = Date.now();
    acquisitionAttempted = true;
    const child = spawn(process.execPath, ['scripts/verify/run.mjs', '--stage=full', '--runs=local',
      '--only=build,db-fixture', '--reuse'], { cwd: directory, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (!child.pid || !child.stdout || !child.stderr) throw Error('real CLI did not acquire its pipes/PID');
    const identity = fixtureProcess(child.pid); expect(identity?.pgid).toBe(child.pid);
    if (!identity) throw Error('real CLI start identity unavailable');
    known.set(`${identity.pid}:${identity.started}:${identity.pgid}`, identity);
    let stdout = '', stderr = '', timedOut = false, samplingFailure: unknown;
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const sample = setInterval(() => {
      try { census(identity); }
      catch (error) { samplingFailure = error; signalFixtureProcess(identity, 'SIGTERM', true); }
    }, 100);
    const commandTimeout = expectObserverFailure ? 60000 : 180000;
    const timeout = setTimeout(() => { timedOut = true; signalFixtureProcess(identity, 'SIGTERM', true); }, commandTimeout);
    const kill = setTimeout(() => {
      for (const acquired of known.values()) signalFixtureProcess(acquired, 'SIGKILL', acquired.pid === acquired.pgid);
    }, commandTimeout + 5000);
    try {
      const result = await new Promise<{ status: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (status, signal) => resolve({ status, signal }));
      });
      runs.push({ pid: identity.pid, ...result, timedOut, seconds: (Date.now() - at) / 1000, stdout, stderr });
      writeFileSync(join(evidence, `run-${runs.length}.stdout`), stdout);
      writeFileSync(join(evidence, `run-${runs.length}.stderr`), stderr);
      if (samplingFailure) throw samplingFailure;
      expect({ ...result, timedOut, diagnostics: result.status === 0 ? '' : stdout + stderr })
        .toEqual({ status: expectObserverFailure ? 1 : 0, signal: null, timedOut: false,
          diagnostics: expectObserverFailure ? stdout + stderr : '' });
    } finally { clearInterval(sample); clearTimeout(timeout); clearTimeout(kill); }
  };
  try {
    for (const file of ['run.mjs', 'impact-plan.mjs', 'local-db.mjs', 'local-db-control.mjs', 'db-lock.py',
      'docker-runtime.mjs', 'receipt-cache.mjs', 'resource-admission.mjs']) {
      write(`scripts/verify/${file}`, readFileSync(join(source, 'scripts/verify', file), 'utf8'));
    }
    for (const path of ['prisma/schema.prisma', 'prisma/seed.ts', 'prisma/migrations']) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      cpSync(join(source, path), join(directory, path), { recursive: true });
    }
    write('scripts/dev/lib/guard.ts', readFileSync(join(source, 'scripts/dev/lib/guard.ts'), 'utf8'));
    symlinkSync(join(source, 'node_modules'), join(directory, 'node_modules'));
    write('.gitignore', 'node_modules\n.evidence\n');
    write('scripts/verify/registry.yml', `checks:
  - name: resource-admission
    script: admission.sh
    layer: 0
    blocking: true
    preflight: true
  - name: structural
    script: cheap.sh
    layer: 0
    blocking: true
  - name: review-admission
    script: review.sh
    layer: 0
    stage: acceptance
    blocking: true
    preflight: true
  - name: build
    script: build.sh
    layer: 3
    blocking: true
  - name: db-fixture
    script: query.sh
    layer: 2
    database: true
    blocking: true
`);
    write('scripts/verify/admission.sh', '#!/bin/sh\nnode scripts/verify/resource-admission.mjs\n');
    write('.evidence/event.cjs', `const fs=require('node:fs');
fs.appendFileSync('.evidence/events.jsonl',JSON.stringify({check:process.argv[2],
  locked:process.env.FITSY_VERIFY_DB_LOCKED,owned:process.env.FITSY_VERIFY_OWNED_DB,
  pooled:process.env.POSTGRES_PRISMA_URL,direct:process.env.POSTGRES_URL_NON_POOLING})+'\\n');
`);
    write('scripts/verify/cheap.sh', '#!/bin/sh\nnode .evidence/event.cjs cheap\n');
    write('scripts/verify/review.sh', '#!/bin/sh\nnode .evidence/event.cjs review\n');
    write('scripts/verify/build.sh', '#!/bin/sh\nset -eu\n' +
      '[ -z "${FITSY_VERIFY_DB_LOCKED-}${FITSY_VERIFY_OWNED_DB-}${POSTGRES_PRISMA_URL-}${POSTGRES_URL_NON_POOLING-}" ]\nnode .evidence/event.cjs build\n');
    write('scripts/verify/query.sh', '#!/bin/sh\nnode .evidence/query.cjs\n');
    write('.evidence/query.cjs', `const fs=require('node:fs');const assert=require('node:assert/strict');
const {PrismaClient}=require('@prisma/client');
const url=process.env.POSTGRES_URL_NON_POOLING;
const address=new URL(url);
assert.equal(address.protocol,'postgresql:');assert.equal(address.hostname,${JSON.stringify(loopback)});
assert.equal(address.username,'fitsy_test');assert.equal(address.password,'fitsy_test');
assert.equal(address.pathname,'/fitsy_verify');assert.ok(Number(address.port)>0);
assert.equal(process.env.POSTGRES_PRISMA_URL,url);assert.equal(process.env.FITSY_VERIFY_DB_LOCKED,'1');
assert.ok(process.env.FITSY_VERIFY_OWNED_DB);
const db=new PrismaClient({datasources:{db:{url}}});
(async()=>{try{
 assert.ok(await db.brand.findUnique({where:{slug:'seed-bowl-co'}}));
 assert.ok(await db.restaurant.count()>0);
 const migrations=await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL');
 assert.ok(migrations[0].n>0);
 const old=await db.$queryRawUnsafe("SELECT to_regclass('public.fitsy_reset_sentinel')::text AS old");
 assert.equal(old[0].old,null);
 const oid=await db.$queryRawUnsafe('SELECT oid::text AS oid FROM pg_database WHERE datname=current_database()');
 await db.$executeRawUnsafe('CREATE TABLE fitsy_reset_sentinel (id integer PRIMARY KEY)');
 await db.$executeRawUnsafe('INSERT INTO fitsy_reset_sentinel VALUES (1)');
 fs.appendFileSync('.evidence/events.jsonl',JSON.stringify({check:'database',oid:oid[0].oid,
  owned:process.env.FITSY_VERIFY_OWNED_DB,pooled:url,direct:process.env.POSTGRES_PRISMA_URL,
  migrations:migrations[0].n,seeded:true,priorSentinelAbsent:true})+'\\n');
 process.stdout.write(JSON.stringify({summary:'real owned database seeded and reset'})+String.fromCharCode(10));
}finally{await db.$disconnect();}})().catch(error=>{console.error(error);process.exitCode=1;});
`);
    const admission = capacity();
    context = realDocker('context', 'show');
    expect(realDocker('context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}')).toBe('unix:///var/run/docker.sock');
    const info = JSON.parse(realDocker('info', '--format', '{{json .}}'));
    expect(info.ID).toBeTruthy(); expect(info.ServerVersion).toBeTruthy(); expect(info.OSType).toBe('linux');
    expect(info.MemTotal).toBeGreaterThanOrEqual(3 * 1024 ** 3); expect(info.NCPU).toBeGreaterThanOrEqual(2);
    daemon = info.ID;
    image = realDocker('image', 'inspect', 'postgis/postgis:16-3.4', '--format', '{{.Id}}');
    expect(image).toMatch(/^sha256:[a-f0-9]{64}$/);
    const absent = spawnSync(docker, ['inspect', name], { env, encoding: 'utf8', timeout: 15000 });
    expect(absent.status).not.toBe(0); expect(absent.stderr).toMatch(/No such (object|container)/i);
    const dockerHash = digest(docker);
    // Only native Docker's durable cidfile is added to creation argv.
    // Other arguments/status/stdio and all Docker effects remain real.
    write('bin/docker', `#!${process.execPath}
const fs=require('node:fs'),crypto=require('node:crypto'),cp=require('node:child_process');
const binary=${JSON.stringify(docker)},hash=crypto.createHash('sha256'),buffer=Buffer.alloc(1048576),fd=fs.openSync(binary,'r');
try{for(let n;(n=fs.readSync(fd,buffer))>0;)hash.update(buffer.subarray(0,n));}finally{fs.closeSync(fd);}
if(hash.digest('hex')!==${JSON.stringify(dockerHash)})throw Error('real Docker binary changed');
const original=process.argv.slice(2);
const args=original[0]==='run'?['run','--cidfile',${JSON.stringify(cidfile)},...original.slice(1)]:original;
fs.appendFileSync('.evidence/events.jsonl',JSON.stringify({check:'docker',args})+'\\n');
const r=cp.spawnSync(binary,args,{stdio:['inherit','pipe','pipe'],env:process.env,maxBuffer:4194304});
// Reproduce loss of observer stdout/trace after actual successful creation.
if(args[0]==='run'&&r.status===0&&fs.existsSync(${JSON.stringify(observerFault)}))process.exit(97);
if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);
fs.appendFileSync('.evidence/events.jsonl',JSON.stringify({check:'docker-exit',args,status:r.status,signal:r.signal,
  createdId:args[0]==='run'&&r.status===0?r.stdout.toString().trim():null})+String.fromCharCode(10));
if(r.error)throw r.error;if(r.signal)process.kill(process.pid,r.signal);else process.exit(r.status);
`);
    chmodSync(join(directory, 'bin/docker'), 0o755);
    git('init', '-q'); git('config', 'user.name', 'DB integration fixture'); git('config', 'user.email', 'test@example.test');
    git('add', '-A'); git('commit', '-qm', 'real DB fixture'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    writeFileSync(join(evidence, 'admission.json'), JSON.stringify({ ...admission, context, daemon,
      docker, dockerHash, image, root: directory, owner, name, noMacPhaseAuthority: true }) + '\n');
    for (let generation = 0; generation < 2; generation++) {
      write('.evidence/events.jsonl', '');
      await invoke();
      const container = inspect(name); validate(container);
      expect(creationIdentity().id).toBe(container.Id);
      if (!acquired) acquired = { id: container.Id, image: container.Image };
      const observed = readFileSync(join(directory, '.evidence/events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      writeFileSync(join(evidence, `run-${generation + 1}-events.json`), JSON.stringify(observed, null, 2));
      expect(observed.filter(event => event.check === 'cheap')).toHaveLength(1);
      expect(observed.filter(event => ['cheap', 'review', 'build', 'database'].includes(event.check)).map(event => event.check))
        .toEqual(['cheap', 'review', 'build', 'database']);
      const build = observed.findIndex(event => event.check === 'build');
      expect(observed.findIndex(event => event.check === 'docker')).toBeGreaterThan(build);
      const database = observed.find(event => event.check === 'database');
      const url = `postgresql://fitsy_test:fitsy_test@${loopback}:${container.NetworkSettings.Ports['5432/tcp'][0].HostPort}/fitsy_verify`;
      expect(database).toEqual(expect.objectContaining({ owned: acquired.id, pooled: url, direct: url,
        seeded: true, priorSentinelAbsent: true }));
      const completed = runs[generation];
      if (!completed) throw Error('completed real DB invocation evidence is missing');
      const reported = completed.stdout.trim().split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
      for (const check of ['structural', 'build', 'db-fixture']) {
        expect(reported.filter(result => result.name === check && result.status === 'pass')).toHaveLength(1);
      }
      if (generation) {
        const previous = JSON.parse(readFileSync(join(evidence, 'run-1-events.json'), 'utf8'));
        expect(database.oid).not.toBe(previous.find((event: { check: string }) => event.check === 'database').oid);
        expect(observed.filter(event => event.check === 'docker' && event.args[0] === 'run')).toHaveLength(0);
      }
      for (const event of observed.filter(event => event.check === 'docker' && event.args[0] === 'exec')) {
        expect(event.args[1]).toBe(acquired.id);
      }
      expect(realDocker('info', '--format', '{{.ID}}')).toBe(daemon);
      expect(digest(docker)).toBe(dockerHash);
    }
    // Keep both successful reset/seed invocations, then exercise lost observer
    // evidence on a fresh creation through the same canonical runner and lock.
    const previousId = acquired?.id;
    expect(removeOwnedContainer()).toBe(previousId);
    acquired = undefined;
    writeFileSync(observerFault, 'fail after native Docker creation\n', { flag: 'wx', mode: 0o600 });
    write('.evidence/events.jsonl', '');
    await invoke(true);
    const faultEvents = readFileSync(join(directory, '.evidence/events.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    writeFileSync(join(evidence, 'observer-failure-events.json'), JSON.stringify(faultEvents, null, 2));
    expect(faultEvents.filter(event => event.check === 'docker' && event.args[0] === 'run')).toHaveLength(1);
    expect(faultEvents.filter(event => event.check === 'docker-exit' && event.args[0] === 'run')).toHaveLength(0);
    const created = creationIdentity();
    expect(created.id).not.toBe(previousId);
    validate(inspect(created.id));
    observerFailureReached = true;
  } catch (error) { failure = error; }
  finally {
    const cleanupErrors: string[] = [];
    try {
      census();
      for (const acquired of known.values()) signalFixtureProcess(acquired, 'SIGTERM', acquired.pid === acquired.pgid);
      for (let attempt = 0; attempt < 40 && [...known.values()].some(p => fixtureProcess(p.pid)?.started === p.started); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      for (const acquired of known.values()) signalFixtureProcess(acquired, 'SIGKILL', acquired.pid === acquired.pgid);
      let rows = census();
      for (let attempt = 0; attempt < 40 && rows.some(row => [...known.values()].some(p => Number(row[2]) === p.pgid)); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50)); rows = census();
      }
      expect(rows.filter(row => [...known.values()].some(p => Number(row[2]) === p.pgid))).toEqual([]);
    } catch (error) { cleanupErrors.push(String(error)); }
    try {
      // Do not contact Docker after a failed pre-acquisition resource/readiness check.
      if (acquisitionAttempted) {
        recoveredAfterObserverFailure = removeOwnedContainer();
        if (observerFailureReached) expect(recoveredAfterObserverFailure).toMatch(/^[a-f0-9]{64}$/);
      }
    } catch (error) { cleanupErrors.push(String(error)); }
    writeFileSync(join(evidence, 'closeout.json'), JSON.stringify({ root: directory, owner, name, acquired,
      runs: runs.map(({ stdout, stderr, ...run }) => ({ ...run, stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr) })),
      knownProcesses: [...known.values()], observerFailureReached, recoveredAfterObserverFailure, cleanupErrors, failure: failure ? String(failure) : null,
      hardWorkerKillLimitation: 'JS finally cannot guarantee cleanup after worker SIGKILL; hosted CI runner disposal remains required.' }, null, 2));
    if (!cleanupErrors.length) rmSync(directory, { recursive: true, force: true });
    if (cleanupErrors.length) throw Error(`real DB cleanup failed: ${cleanupErrors.join('; ')}; original: ${String(failure ?? '')}; evidence: ${evidence}`);
  }
  if (failure) throw failure;
}, 480000);
