import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, copyFileSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';
import { actionsSelection } from '../verify/simulator-actions.mjs';
import { simulatorBudget, simulatorFlows } from '../verify/impact-plan.mjs';
import { fixtureAccounts, prepareRuntimeApp, selectFlows, validateRuntime } from './actions.mjs';

const root = resolve(import.meta.dirname, '../..');
const workflow = yaml.load(readFileSync(join(root, '.github/workflows/simulator.yml'), 'utf8'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GIT_|GITHUB_|FITSY_|EXPO_|CI$|NODE_OPTIONS$)/.test(key)));
const temporary = t => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-actions-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('hosted PR and main use affected journeys, retain bounded control smoke and fail closed on unknown impact', () => {
  for (const event of ['pull_request', 'push']) {
    for (const path of ['scripts/sim/ci.mjs', 'scripts/verify/impact-plan.mjs', '.github/workflows/simulator.yml'])
      assert.equal(actionsSelection([path], event, {}).scope, 'smoke');
    for (const path of ['apps/mobile/app/index.tsx', 'apps/mobile/new-unmapped.ts', 'package-lock.json'])
      assert.equal(actionsSelection([path], event, {}).scope, 'full');
    for (const path of ['apps/mobile/README.md', 'scripts/sim/actions.test.mjs', 'docs/ci-simulator.md'])
      assert.equal(actionsSelection([path], event, {}).scope, 'none');
    const selected = actionsSelection(['apps/mobile/app/notification-settings.tsx'], event, {});
    assert.equal(selected.scope, 'flow');
    assert.deepEqual(selected.flows, ['reminders']);
    assert.equal(actionsSelection(['apps/api/app/api/search/route.ts'], event, {}).scope, 'flow');
  }
  for (const label of ['full-sim', 'needs-sim'])
    assert.equal(actionsSelection(['docs/ci-simulator.md'], 'pull_request', { pull_request: { labels: [{ name: label }] } }).scope, 'full');
  assert.throws(() => actionsSelection(null, 'pull_request', {}), /comparison/);
  assert.throws(() => actionsSelection([], 'unavailable', {}), /context/);
});

test('validated selections couple short and long job budgets without changing their scope or journeys', () => {
  const catalog = simulatorFlows(root);
  assert(catalog.length >= 10);
  for (const [scope, flows, minutes] of [
    ['none', [], 30], ['smoke', [], 30], ['flow', catalog.slice(0, 1), 30],
    ['flow', catalog.slice(0, 3), 30], ['flow', catalog.slice(0, 4), 90],
    ['flow', catalog.slice(0, 10), 90], ['full', catalog, 90],
  ]) {
    const selection = { scope, flows }, before = structuredClone(selection);
    assert.deepEqual(simulatorBudget(selection), { timeoutMinutes: minutes, workerTimeoutSeconds: minutes * 60 });
    assert.deepEqual(selection, before);
  }
  for (const selection of [null, {}, { scope: 'unknown', flows: [] }, { scope: 'flow', flows: [] },
    { scope: 'flow', flows: 'map-search' }, { scope: 'flow', flows: ['missing'] },
    { scope: 'flow', flows: ['map-search', 'map-search'] }, { scope: 'flow', flows: [null] },
    { scope: 'smoke', flows: ['map-search'] }, { scope: 'none', flows: ['map-search'] },
    { scope: 'full', flows: ['missing'] }])
    assert.throws(() => simulatorBudget(selection), /Invalid simulator budget selection/);
});

test('local runner preflight checks real CLI inventory without confusing missing capacity with denied access', t => {
  const dir = temporary(t), bin = join(dir, 'bin'), calls = join(dir, 'calls');
  mkdirSync(bin);
  const runner = (status, labels = workflow.jobs.mac['runs-on']) => ({ id: 1, status, busy: true,
    labels: labels.map(name => ({ name })) });
  const cases = [
    { pages: [{ total_count: 0, runners: [] }], success: false, message: /No online runner.*registered=0/ },
    { pages: [{ total_count: 1, runners: [runner('offline')] }], success: false, message: /No online runner.*matching=1/ },
    { pages: [{ total_count: 1, runners: [runner('online', ['self-hosted', 'Linux', 'fitsy-sim'])] }], success: false, message: /No online runner.*matching=0/ },
    { pages: [{ total_count: 2, runners: [runner('offline')] }, { total_count: 2, runners: [{ ...runner('online'), id: 2 }] }], success: true, message: /online=1.*busy=1/ },
    { pages: { message: 'denied' }, status: 1, success: false, message: /Runner inventory unavailable.*Administration read/ },
    { pages: [{ total_count: 1, runners: [] }], success: false, message: /Runner inventory is incomplete or invalid/ },
  ];
  for (const item of cases) {
    writeFileSync(join(bin, 'gh'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(calls)},JSON.stringify(process.argv.slice(2))+'\\n');\nconsole.log(${JSON.stringify(JSON.stringify(item.pages))});\nprocess.exit(${item.status || 0});\n`, { mode: 0o755 });
    const result = spawnSync(process.execPath, [join(root, 'scripts/verify/simulator-actions.mjs'), '--preflight'], {
      cwd: root, env: { ...env, PATH: `${bin}:${env.PATH}` }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status === 0, item.success, result.stderr);
    assert.match(result.stdout + result.stderr, item.message);
    assert.doesNotMatch(result.stdout + result.stderr, /"message":"denied"/);
  }
  const commands = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(commands.length, cases.length);
  for (const args of commands) assert.deepEqual(args, ['api', '--paginate', '--slurp', 'repos/dgmolla/fitsy/actions/runners?per_page=100']);
});

test('the real selector sees a mobile deletion beyond 300 unrelated changed files', t => {
  const dir = temporary(t);
  const git = args => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], { cwd: dir, env, stdio: 'pipe', encoding: 'utf8' }).trim();
  mkdirSync(join(dir, 'scripts/verify'), { recursive: true });
  for (const name of ['impact-plan.mjs', 'simulator-actions.mjs']) copyFileSync(join(root, 'scripts/verify', name), join(dir, 'scripts/verify', name));
  mkdirSync(join(dir, 'apps/mobile'), { recursive: true });
  writeFileSync(join(dir, 'apps/mobile/deleted.ts'), 'old source');
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.test']);
  git(['add', '.']); git(['-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'base']);
  const base = git(['rev-parse', 'HEAD']);
  rmSync(join(dir, 'apps/mobile/deleted.ts'));
  mkdirSync(join(dir, 'docs'));
  for (let i = 0; i < 310; i++) writeFileSync(join(dir, 'docs', `${i}.md`), 'documentation');
  git(['add', '.']); git(['-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'head']);
  const event = join(dir, 'event.json'), output = join(dir, 'output');
  writeFileSync(event, JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: git(['rev-parse', 'HEAD']) } } }));
  const result = spawnSync(process.execPath, [join(dir, 'scripts/verify/simulator-actions.mjs')], {
    cwd: dir, env: { ...env, CI: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(output, 'utf8'), 'required=true\nscope=full\ntimeout_minutes=90\nworker_timeout_seconds=5400\n');
  // The real runner recomputes source impact before any native command. A
  // stale/tampered smoke output cannot hide this unknown deleted dependency.
  const work = join(dir, 'fitsy-simulator-12-1');
  mkdirSync(work); writeFileSync(join(work, 'device.json'), '{}');
  const rejected = spawnSync(process.execPath, [join(root, 'scripts/sim/actions.mjs'), 'run'], {
    cwd: dir, encoding: 'utf8', env: { ...env, CI: 'true', FITSY_PRODUCT_ROOT: dir,
      GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: event, GITHUB_ACTIONS: 'true', GITHUB_WORKSPACE: dir,
      RUNNER_OS: 'macOS', RUNNER_TEMP: dir, GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '1',
      FITSY_XCTEST_SIM_UDID: '11111111-1111-1111-1111-111111111111', SIM_SCOPE: 'smoke',
      EXPO_PUBLIC_API_URL: 'https://dev.fitsy.org', EXPO_PUBLIC_SUPABASE_URL: 'https://kegycybiruksmrzvniha.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_synthetic', EXPO_PUBLIC_REVENUECAT_TEST_KEY: 'test_synthetic' },
  });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /scope does not match the current source impact/);
});

test('the actual required-check shell never converts a failed, cancelled or missing Mac run to success', () => {
  const script = workflow.jobs.simulator.steps[0].run;
  for (const [required, selected, mac, success] of [
    ['false', 'success', 'skipped', true], ['true', 'success', 'success', true],
    ['true', 'success', 'failure', false], ['true', 'success', 'cancelled', false],
    ['true', 'success', 'skipped', false], ['false', 'failure', 'skipped', false],
    ['', 'success', 'skipped', false], ['false', 'success', 'failure', false],
  ]) {
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], { env: { ...env, REQUIRED: required, SELECT_RESULT: selected, MAC_RESULT: mac } });
    assert.equal(result.status === 0, success, `${required}/${selected}/${mac}`);
  }
});

test('workflow isolates PR cancellation from the single Mac queue and always cleans up', () => {
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
  assert.equal(workflow.concurrency.group, 'simulator-pr-${{ github.event.pull_request.number || github.sha }}');
  assert.deepEqual(workflow.jobs.mac.concurrency, { group: 'fitsy-simulator', 'cancel-in-progress': false, queue: 'max' });
  assert.deepEqual(workflow.jobs.mac['runs-on'], ['self-hosted', 'macOS', 'fitsy-sim']);
  assert.equal(workflow.jobs.select.outputs.timeout_minutes, '${{ steps.plan.outputs.timeout_minutes }}');
  assert.equal(workflow.jobs.select.outputs.worker_timeout_seconds, '${{ steps.plan.outputs.worker_timeout_seconds }}');
  assert.equal(workflow.jobs.mac['timeout-minutes'], '${{ fromJSON(needs.select.outputs.timeout_minutes) }}');
  assert.equal(workflow.jobs.mac.env.FITSY_DISPATCH_WORKER_TIMEOUT_SECONDS,
    '${{ needs.select.outputs.worker_timeout_seconds }}');
  assert.match(workflow.jobs.mac.steps.at(-1).if, /always\(\)/);
  assert.match(workflow.jobs.simulator.if, /always\(\)/);
  assert.equal(workflow.on.pull_request.paths, undefined);
  assert.equal(workflow.jobs.mac.steps.some(step => step['continue-on-error']), false);
  const secretSteps = workflow.jobs.mac.steps.filter(step => JSON.stringify(step).includes('secrets.'));
  assert.deepEqual(secretSteps.map(step => step.run), ['node scripts/sim/actions.mjs run']);
});

test('only the dedicated Mac job executes native work, without GitHub write credentials or fork code', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.jobs).sort(), ['mac', 'select', 'simulator']);
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.equal(workflow.jobs.select['runs-on'], 'ubuntu-latest');
  assert.equal(workflow.jobs.simulator['runs-on'], 'ubuntu-latest');
  assert.equal(workflow.jobs.mac.if.trim(), "needs.select.outputs.required == 'true' && (github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository)");
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.equal(job.permissions, undefined, name);
    assert.equal(job['continue-on-error'], undefined, name);
    for (const step of job.steps) {
      if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
      assert.doesNotMatch(JSON.stringify(step), /github\.token|secrets\.GITHUB_TOKEN|GH_TOKEN|GITHUB_TOKEN/);
    }
    if (name !== 'mac') assert.doesNotMatch(JSON.stringify(job), /secrets\.|FITSY_(?:CI_)?SIM_|sim\/(?:ci|actions)\.mjs|maestro|simctl|iphonesimulator|macos-15/);
  }
});

test('full Test Store selection includes maintained failures and rejects incomplete account setup', () => {
  const catalog = Object.fromEntries(['cold-start-welcome', 'signin-options', 'paywall-access', 'chain-menu-serving', 'new-flow', 'apple'].map(name => [name, {
    tags: name === 'apple' ? ['store:apple-simulator'] : name === 'new-flow' ? ['fixture:expired-subscription', 'store:test-store'] : ['fixture:unsubscribed-dev'],
  }]));
  assert.deepEqual(selectFlows('smoke', catalog), ['cold-start-welcome', 'signin-options', 'paywall-access']);
  assert.deepEqual(selectFlows('full', catalog), ['chain-menu-serving', 'cold-start-welcome', 'new-flow', 'paywall-access', 'signin-options']);
  assert.deepEqual(selectFlows('full', catalog, [{ flow: 'apple', status: 'EXCEPTED' }]),
    ['apple', 'chain-menu-serving', 'cold-start-welcome', 'new-flow', 'paywall-access', 'signin-options']);
  assert.deepEqual(selectFlows('flow', catalog, [], ['chain-menu-serving']), ['chain-menu-serving']);
  assert.deepEqual(selectFlows('flow', catalog, [], ['apple', 'chain-menu-serving']), ['chain-menu-serving']);
  for (const flows of [[], ['missing'], ['chain-menu-serving', 'chain-menu-serving']])
    assert.throws(() => selectFlows('flow', catalog, [], flows), /missing or ambiguous/);
  assert.throws(() => selectFlows('flow', catalog, [], ['apple']), /compatible store/);
  assert.throws(() => selectFlows('none', catalog));
  const accounts = { 'unsubscribed-dev': { email: 'seed-test@fitsy.dev', password: 'synthetic' } };
  assert.doesNotThrow(() => fixtureAccounts(selectFlows('smoke', catalog), catalog, JSON.stringify(accounts)));
  assert.throws(() => fixtureAccounts(selectFlows('full', catalog), catalog, JSON.stringify(accounts)), /expired-subscription/);
  accounts['expired-subscription'] = accounts['unsubscribed-dev'];
  assert.throws(() => fixtureAccounts(selectFlows('full', catalog), catalog, JSON.stringify(accounts)), /distinct/);
});

test('runtime target and keys reject production, unrelated projects and privileged keys', () => {
  const config = { EXPO_PUBLIC_API_URL: 'https://dev.fitsy.org', EXPO_PUBLIC_SUPABASE_URL: 'https://kegycybiruksmrzvniha.supabase.co',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_synthetic', EXPO_PUBLIC_REVENUECAT_TEST_KEY: 'test_synthetic' };
  validateRuntime(config);
  for (const patch of [{ EXPO_PUBLIC_API_URL: 'https://api.fitsy.org' }, { EXPO_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' },
    { EXPO_PUBLIC_REVENUECAT_TEST_KEY: 'appl_synthetic' }, { EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_synthetic' },
    { EXPO_PUBLIC_SUPABASE_ANON_KEY: `eyJ.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature` }])
    assert.throws(() => validateRuntime({ ...config, ...patch }));
});

test('Expo regenerates runtime RevenueCat config without changing the cached app or embedding fixture credentials', t => {
  const dir = temporary(t), cached = join(dir, 'cached.app'), runtime = join(dir, 'runtime.app');
  mkdirSync(join(cached, 'EXConstants.bundle'), { recursive: true });
  writeFileSync(join(cached, 'EXConstants.bundle/app.config'), '{"extra":{}}');
  let signed = false;
  prepareRuntimeApp(cached, runtime, (binary, args) => {
    if (binary === 'codesign') { assert.equal(args.at(-1), runtime); signed = true; return ''; }
    return execFileSync(binary, args, { cwd: root, encoding: 'utf8', env: { ...env, EXPO_NO_DOTENV: '1', NODE_ENV: 'development',
      EXPO_PUBLIC_REVENUECAT_TEST_KEY: 'test_synthetic', EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'must-not-be-cached' } });
  });
  const config = readFileSync(join(runtime, 'EXConstants.bundle/app.config'), 'utf8');
  assert.equal(JSON.parse(config).extra.revenueCat.test, 'test_synthetic');
  assert.equal(config.includes('must-not-be-cached'), false);
  assert.equal(readFileSync(join(cached, 'EXConstants.bundle/app.config'), 'utf8'), '{"extra":{}}');
  assert.equal(signed, true);
});

for (const [name, selection, leaseMinutes] of [
  ['short', actionsSelection(['apps/mobile/app/notification-settings.tsx'], 'push', {}), 35],
  ['ten', { scope: 'flow', flows: simulatorFlows(root).slice(0, 10) }, 95],
  ['full', actionsSelection(['apps/mobile/new-unmapped.ts'], 'push', {}), 95],
]) test(`CLI boot consumes the ${name} selection's ${leaseMinutes}-minute lease and cleans up only its device on failure`, t => {
  const { workerTimeoutSeconds: workerSeconds } = simulatorBudget(selection);
  const dir = temporary(t), bin = join(dir, 'bin'), work = join(dir, 'fitsy-simulator-12-1'), log = join(dir, 'calls');
  mkdirSync(bin); mkdirSync(join(dir, 'apps/mobile'), { recursive: true });
  const udid = '11111111-1111-1111-1111-111111111111';
  const executable = `#!${process.execPath}\nconst fs=require('node:fs'); const args=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');
if(args.includes('list')) console.log(JSON.stringify({devices:{ios:[{udid:${JSON.stringify(udid)},state:'Shutdown',deviceTypeIdentifier:'com.apple.CoreSimulator.SimDeviceType.iPhone-15'}]}}));
if(args.includes('boot')) process.exit(1);\n`;
  for (const name of ['bash', 'xcrun']) writeFileSync(join(bin, name), executable, { mode: 0o755 });
  const run = action => spawnSync(process.execPath, [join(root, 'scripts/sim/actions.mjs'), action], { cwd: dir, encoding: 'utf8',
    env: { ...env, PATH: `${bin}:${env.PATH}`, FITSY_PRODUCT_ROOT: dir, GITHUB_WORKSPACE: dir, GITHUB_ACTIONS: 'true', RUNNER_OS: 'macOS',
      RUNNER_TEMP: dir, GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '1', FITSY_XCTEST_SIM_UDID: udid,
      FITSY_SIM_OWNER: 'actions-12-1', FITSY_DISPATCH_WORKER_TIMEOUT_SECONDS: String(workerSeconds) } });
  assert.equal(run('boot').status, 1);
  assert.equal(existsSync(join(work, 'device.json')), true);
  assert.equal(run('cleanup').status, 0);
  assert.equal(existsSync(work), false);
  const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert(calls.some(args => args.slice(-3).join(' ') === `claim --minutes ${leaseMinutes}`));
  assert(calls.some(args => args.join(' ') === `simctl erase ${udid}`));
  assert(calls.some(args => args.at(-1) === 'release'));
  assert.equal(calls.some(args => args.includes('all') || args.includes('delete')), false);
});

test('CLI boot pre-dismisses the iOS slide-to-type sheet after the device is ready', t => {
  const dir = temporary(t), bin = join(dir, 'bin'), log = join(dir, 'calls');
  mkdirSync(bin); mkdirSync(join(dir, 'apps/mobile'), { recursive: true });
  const udid = '11111111-1111-1111-1111-111111111111';
  const executable = `#!${process.execPath}\nconst fs=require('node:fs'); const args=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');
if(args.includes('list')) console.log(JSON.stringify({devices:{ios:[{udid:${JSON.stringify(udid)},state:'Shutdown',deviceTypeIdentifier:'com.apple.CoreSimulator.SimDeviceType.iPhone-15'}]}}));\n`;
  for (const name of ['bash', 'xcrun']) writeFileSync(join(bin, name), executable, { mode: 0o755 });
  const result = spawnSync(process.execPath, [join(root, 'scripts/sim/actions.mjs'), 'boot'], { cwd: dir, encoding: 'utf8',
    env: { ...env, PATH: `${bin}:${env.PATH}`, FITSY_PRODUCT_ROOT: dir, GITHUB_WORKSPACE: dir, GITHUB_ACTIONS: 'true', RUNNER_OS: 'macOS',
      RUNNER_TEMP: dir, GITHUB_RUN_ID: '13', GITHUB_RUN_ATTEMPT: '1', FITSY_XCTEST_SIM_UDID: udid,
      FITSY_SIM_OWNER: 'actions-13-1', FITSY_DISPATCH_WORKER_TIMEOUT_SECONDS: '1800' } });
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const bootIndex = calls.findIndex(args => args.join(' ') === `simctl boot ${udid}`);
  const statusIndex = calls.findIndex(args => args.join(' ') === `simctl bootstatus ${udid} -b`);
  const defaultsIndex = calls.findIndex(args =>
    args.join(' ') === `simctl spawn ${udid} defaults write com.apple.keyboard.preferences DidShowContinuousPathIntroduction -bool true`);
  assert(bootIndex >= 0 && statusIndex >= 0 && defaultsIndex >= 0, JSON.stringify(calls));
  assert(bootIndex < statusIndex && statusIndex < defaultsIndex, 'the keyboard default must be written only after the device reports fully booted');
});

test('real cleanup retains failed Maestro bytes privately and fails closed when retention is unavailable', t => {
  const dir = temporary(t), checkout = join(dir, 'checkout'), temp = join(dir, 'runner-temp');
  mkdirSync(checkout); mkdirSync(temp);
  const archive = join(dir, 'fitsy-simulator-failures');
  const cleanup = attempt => spawnSync(process.execPath, [join(root, 'scripts/sim/actions.mjs'), 'cleanup'], {
    cwd: checkout, encoding: 'utf8', env: { ...env, FITSY_PRODUCT_ROOT: checkout, GITHUB_WORKSPACE: checkout,
      GITHUB_ACTIONS: 'true', RUNNER_OS: 'macOS', RUNNER_TEMP: temp, GITHUB_RUN_ID: '24', GITHUB_RUN_ATTEMPT: String(attempt) },
  });
  const failure = JSON.stringify({ flow: 'paywall-access', source: 'a'.repeat(40), configHash: 'b'.repeat(64) });
  const raw = 'original command receipt with synthetic-password and synthetic-session-token';
  const prepare = attempt => {
    const work = join(temp, `fitsy-simulator-24-${attempt}`);
    mkdirSync(join(work, 'paywall-access'), { recursive: true });
    writeFileSync(join(work, 'failure.json'), failure);
    writeFileSync(join(work, 'paywall-access/commands-paywall-access.json'), raw);
    return work;
  };
  const work = prepare(1), result = cleanup(1), retained = join(archive, '24-1');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(work), false);
  assert.equal(readFileSync(join(retained, 'failure.json'), 'utf8'), failure);
  assert.equal(readFileSync(join(retained, 'paywall-access/commands-paywall-access.json'), 'utf8'), raw);
  assert.equal(statSync(archive).mode & 0o077, 0);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-password|synthetic-session-token/);
  assert.match(result.stdout, /Private failed-flow evidence retained/);
  assert.equal(cleanup(1).status, 0); // Repeated cleanup does not replace the retained attempt.
  const next = prepare(2);
  writeFileSync(join(archive, '24-2'), 'existing evidence must not be replaced');
  const refused = cleanup(2);
  assert.equal(refused.status, 1);
  assert.equal(readFileSync(join(next, 'paywall-access/commands-paywall-access.json'), 'utf8'), raw);
  assert.equal(readFileSync(join(archive, '24-2'), 'utf8'), 'existing evidence must not be replaced');
  assert.doesNotMatch(refused.stdout + refused.stderr, /synthetic-password|synthetic-session-token/);
  const unsafe = prepare(3);
  chmodSync(archive, 0o755);
  const publicDirectory = cleanup(3);
  assert.equal(publicDirectory.status, 1);
  assert.match(publicDirectory.stderr, /private and owned/);
  assert.equal(readFileSync(join(unsafe, 'paywall-access/commands-paywall-access.json'), 'utf8'), raw);
  assert.equal(existsSync(join(archive, '24-3')), false);
});

test('CLI cleanup fails and retains ownership when an owned Metro ignores SIGTERM', async t => {
  const dir = temporary(t), bin = join(dir, 'bin'), build = join(dir, '.evidence/product-build');
  mkdirSync(bin); mkdirSync(build, { recursive: true });
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); console.log("ready"); setInterval(()=>{},1000);'], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await once(child.stdout, 'data');
    const receipt = join(build, 'metro.json');
    writeFileSync(receipt, JSON.stringify({ pid: child.pid, processIdentity: 'owned fixture process' }));
    writeFileSync(join(bin, 'ps'), `#!${process.execPath}\ntry { process.kill(${child.pid},0); console.log('owned fixture process'); } catch { process.exit(1); }\n`, { mode: 0o755 });
    const result = spawnSync(process.execPath, [join(root, 'scripts/sim/actions.mjs'), 'cleanup'], { cwd: dir, encoding: 'utf8', timeout: 20000,
      env: { ...env, PATH: `${bin}:${env.PATH}`, FITSY_PRODUCT_ROOT: dir, GITHUB_WORKSPACE: dir, GITHUB_ACTIONS: 'true', RUNNER_OS: 'macOS',
        RUNNER_TEMP: dir, GITHUB_RUN_ID: '13', GITHUB_RUN_ATTEMPT: '1' } });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Owned Metro did not stop/);
    assert.equal(existsSync(receipt), true);
    assert.doesNotThrow(() => process.kill(child.pid, 0));
  } finally {
    const ended = once(child, 'exit');
    child.kill('SIGKILL');
    await ended;
  }
});
