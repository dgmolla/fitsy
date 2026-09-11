#!/usr/bin/env node
// Local-only runner. Build and command receipts are generated, never hand-stamped.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, openSync, closeSync } from 'node:fs';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { resolve, relative, join } from 'node:path';
import { createRequire } from 'node:module';
import { root, inputHash, changedPaths, impact, digest, validate, baseline, repoEnv } from '../verify/product-flow.mjs';
import { backendRevision } from './backend-identity.mjs';
import { buildProfile, bundleDelegate, fixtureLabel, metroRoute } from './build-profile.mjs';
const yaml = createRequire(import.meta.url)('js-yaml');
const out = resolve(root, '.evidence/product-flow');
const buildDir = resolve(root, '.evidence/product-build');
const mobile = resolve(root, 'apps/mobile');
const recipeHash = () => digest(['product-flow.mjs', 'build-profile.mjs'].map(f => readFileSync(join(root, 'scripts/sim', f))).join('\0'));
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const assert = (ok, why) => { if (!ok) throw new Error(why); };
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', env: repoEnv(), maxBuffer: 32 * 1024 * 1024, ...opts })?.trim() || '';
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]).sort();
}
function treeHash(dir) {
  const hash = createHash('sha256');
  for (const f of files(dir)) hash.update(relative(dir, f) + '\0').update(readFileSync(f));
  return hash.digest('hex');
}
function environment() {
  const entries = Object.entries(process.env).filter(([key]) => key.startsWith('EXPO_PUBLIC_')).sort(([a], [b]) => a.localeCompare(b));
  assert(process.env.EXPO_PUBLIC_API_URL === 'https://dev.fitsy.org', 'Load the mobile dev environment; this runner refuses production');
  assert(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, 'Dev Supabase configuration is required');
  assert(!process.env.EXPO_PUBLIC_SUPABASE_URL.includes('zaxkmjqozvmbifiwbxps'), 'Production Supabase is forbidden');
  return { backend: process.env.EXPO_PUBLIC_API_URL, configHash: digest(JSON.stringify(entries)) };
}
function backend() {
  const d = JSON.parse(run('vercel', ['api', '/v13/deployments/dev.fitsy.org', '--raw']));
  const revision = backendRevision(d);
  // A different backend revision is safe only if its API/shared/schema contents match.
  const diff = run('git', ['diff', '--name-only', revision, '--', 'apps/api', 'packages/shared', 'prisma', 'package.json', 'package-lock.json']);
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard', '--', 'apps/api', 'packages/shared', 'prisma']);
  assert(!diff && !untracked, 'Deploy candidate backend/shared/schema changes to dev before running product flows');
  return { backendRevision: revision, backendDeployment: d.id };
}
function device(udid) {
  assert(/^[A-F0-9-]{36}$/i.test(udid || ''), 'Pass an explicit simulator UDID');
  const devices = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'booted', '--json'])).devices;
  const found = Object.entries(devices).find(([, list]) => list.some(d => d.udid === udid && d.state === 'Booted'));
  assert(found, 'The selected simulator is not booted');
  return { simulator: udid, os: found[0] };
}
function claim() {
  assert(process.env.FITSY_SIM_OWNER, 'Set FITSY_SIM_OWNER for simulator coordination');
  run('bash', ['scripts/sim/sim', 'claim', '--minutes', '60'], { stdio: 'inherit' });
}
const release = () => run('bash', ['scripts/sim/sim', 'release'], { stdio: 'inherit' });
const metroFile = join(buildDir, 'metro.json');
const processIdentity = pid => run('ps', ['-p', String(pid), '-o', 'lstart=,command=']);
async function stopMetro() {
  if (!existsSync(metroFile)) return;
  const m = read(metroFile);
  let current;
  try { current = processIdentity(m.pid); } catch { current = ''; }
  if (current === m.processIdentity) {
    process.kill(m.pid, 'SIGTERM');
    for (let attempt = 0; attempt < 100; attempt++) {
      await new Promise(done => setTimeout(done, 50));
      try { current = processIdentity(m.pid); } catch { current = ''; }
      if (!current) break;
    }
    assert(!current, 'Owned Metro did not stop; retaining its receipt for cleanup');
  }
  else assert(!current, 'Owned Metro PID was reused; inspect before stopping it');
  rmSync(metroFile);
}
async function metroBundle(m) {
  assert(processIdentity(m.pid) === m.processIdentity, 'The identified Metro process is no longer running');
  assert(m.nativeSourceHash === inputHash(root, true) && m.configHash === environment().configHash, 'Metro source/configuration changed; start a fresh run');
  const response = await fetch(`http://localhost:${m.port}${metroRoute}`, { signal: AbortSignal.timeout(120_000) });
  assert(response.ok, `Metro bundle failed: HTTP ${response.status}`);
  return digest(Buffer.from(await response.arrayBuffer()));
}
async function startMetro(r) {
  await stopMetro();
  // Refuse a busy port; never attach to or terminate another task's server.
  await new Promise((resolvePort, reject) => {
    const server = createServer(); server.once('error', reject);
    server.listen(r.metroPort, '127.0.0.1', () => server.close(resolvePort));
  });
  const fd = openSync(join(buildDir, 'metro.log'), 'w');
  const child = spawn(process.execPath, [join(root, 'node_modules/expo/bin/cli'), 'start', '--dev-client', '--localhost', '--port', String(r.metroPort)], {
    cwd: mobile, detached: true, stdio: ['ignore', fd, fd],
    env: { ...repoEnv(), CI: '1', EXPO_NO_DOTENV: '1', NODE_ENV: 'development', EXPO_OFFLINE: '1' },
  });
  closeSync(fd);
  await new Promise((ready, reject) => { child.once('spawn', ready); child.once('error', reject); });
  child.unref();
  const m = { pid: child.pid, port: r.metroPort, processIdentity: processIdentity(child.pid), nativeSourceHash: r.nativeSourceHash, configHash: r.configHash };
  save(metroFile, m);
  for (let attempt = 0; attempt < 120; attempt++) {
    let ready = false;
    try {
      const response = await fetch(`http://localhost:${m.port}/status`, { signal: AbortSignal.timeout(1000) });
      ready = await response.text() === 'packager-status:running';
    } catch { /* startup only; failure below remains blocking */ }
    if (ready) return { ...m, bundleHash: await metroBundle(m) };
    assert(processIdentity(m.pid) === m.processIdentity, 'Owned Metro exited during startup; inspect metro.log');
    await new Promise(done => setTimeout(done, 500));
  }
  throw new Error('Owned Metro did not become ready; inspect metro.log');
}
async function checkBundle(report) {
  if (report.buildMode === 'owned-metro-test-store') {
    assert(report.metro && report.bundleHash === await metroBundle(report.metro), 'Metro served a different bundle after testing');
  }
}
function receipt() {
  const r = read(join(buildDir, 'receipt.json'));
  assert(r.buildRecipeHash === recipeHash(), 'Rebuild: the simulator build recipe changed');
  assert(r.nativeSourceHash === inputHash(root, true), 'Rebuild: mobile inputs changed');
  assert(r.configHash === environment().configHash, 'Rebuild: public configuration changed');
  assert(r.appHash === treeHash(r.app), 'Rebuild: app bundle changed');
  return r;
}
async function build(udid, testStore) {
  const config = environment(), identity = device(udid), source = inputHash(root, true);
  const profile = buildProfile(testStore, process.env), buildRecipeHash = recipeHash();
  claim();
  try {
    mkdirSync(buildDir, { recursive: true });
    // Keyless Release is useful for baseline navigation, but cannot verify billing.
    const env = { ...repoEnv(), EXPO_NO_DOTENV: '1', NODE_ENV: testStore ? 'development' : 'production', FITSY_ALLOW_MISSING_PUBLIC_ENV: '1', CI: '1', FORCE_BUNDLING: '1', SKIP_BUNDLING: '' };
    const packageFile = join(mobile, 'package.json'), packageBefore = readFileSync(packageFile);
    try {
      run('npx', ['expo', 'prebuild', '--platform', 'ios', '--no-install'], { cwd: mobile, env, stdio: 'inherit' });
    } finally {
      // Expo rewrites only start scripts here. Reject unexpected dependency changes.
      const before = JSON.parse(packageBefore), after = read(packageFile);
      after.scripts = before.scripts;
      assert(JSON.stringify(after) === JSON.stringify(before), 'Prebuild changed dependencies; inspect package.json before retrying');
      writeFileSync(packageFile, packageBefore);
    }
    // Pin the embedded candidate; cached/downloaded OTA updates cannot replace it.
    run('/usr/libexec/PlistBuddy', ['-c', 'Set :EXUpdatesEnabled false', join(mobile, 'ios/Fitsy/Supporting/Expo.plist')]);
    // Test Store needs Debug + Expo's dev server. Release stays embedded.
    const delegate = join(mobile, 'ios/Fitsy/AppDelegate.swift');
    const delegateSource = readFileSync(delegate, 'utf8');
    writeFileSync(delegate, bundleDelegate(delegateSource, profile));
    const podfile = join(mobile, 'ios/Podfile'), pods = readFileSync(podfile, 'utf8');
    assert(/^\s*use_expo_modules!.*$/m.test(pods), 'Unrecognized Expo autolinking setup');
    writeFileSync(podfile, pods.replace(/^\s*use_expo_modules!.*$/m, testStore
      ? "  use_expo_modules!({ exclude: ['expo-dev-client', 'expo-dev-launcher', 'expo-dev-menu'] })"
      : '  use_expo_modules!'));
    const project = join(mobile, 'ios/Fitsy.xcodeproj/project.pbxproj');
    writeFileSync(project, readFileSync(project, 'utf8').replaceAll('export SKIP_BUNDLING=1', 'export FORCE_BUNDLING=1'));
    run('pod', ['install'], { cwd: join(mobile, 'ios'), env, stdio: 'inherit' });
    const log = join(buildDir, 'build.log');
    const fd = openSync(log, 'w');
    try {
      run('xcodebuild', ['-workspace', 'ios/Fitsy.xcworkspace', '-scheme', 'Fitsy', '-configuration', profile.configuration, '-sdk', 'iphonesimulator', '-destination', `id=${udid}`, '-derivedDataPath', buildDir, '-jobs', '4', 'ONLY_ACTIVE_ARCH=YES', 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', 'build'], { cwd: mobile, env, stdio: ['ignore', fd, fd] });
    } finally { closeSync(fd); }
    const app = join(buildDir, `Build/Products/${profile.configuration}-iphonesimulator/Fitsy.app`);
    // Xcode embeds these simulated entitlements in the Mach-O image; unsigned
    // builds omitted them and SecureStore failed with ERR_KEY_CHAIN.
    const entitlementsFile = join(buildDir, `Build/Intermediates.noindex/Fitsy.build/${profile.configuration}-iphonesimulator/Fitsy.build/Fitsy.app-Simulated.xcent`);
    const entitlements = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', entitlementsFile]));
    assert(entitlements['application-identifier']?.endsWith('.com.fitsy.mobile'), 'Simulator keychain application entitlement is missing');
    assert(source === inputHash(root, true), 'Build changed source inputs; inspect changes and rebuild');
    assert(buildRecipeHash === recipeHash(), 'Build recipe changed during compilation');
    const bundleHash = digest(readFileSync(join(app, 'main.jsbundle')));
    save(join(buildDir, 'receipt.json'), { ...config, ...identity, nativeSourceHash: source, app, appHash: treeHash(app), bundleHash,
      ...profile, buildRecipeHash, simulatorApplicationIdentifier: entitlements['application-identifier'], builtAt: new Date().toISOString() });
    console.log('Built identified simulator app. Next: run <UDID> [flow names].');
  } finally { release(); }
}
async function execute(udid, names) {
  const r = receipt(), identity = device(udid), server = backend();
  const fixture = fixtureLabel(process.env.FITSY_FIXTURE, process.env.FITSY_SIM_RESET_KEYCHAIN === udid);
  const hash = inputHash(), plan = impact(changedPaths(process.env.FITSY_DIFF_BASE));
  assert(!plan.categories.includes('billing') || r.storeMode !== 'unconfigured', 'Billing evidence requires a configured store');
  const selected = [...new Set([...baseline, ...names])];
  const flowSources = selected.map(name => {
    assert(/^[a-z0-9-]+$/.test(name), 'Invalid flow name');
    const source = `apps/mobile/e2e/flows/${name}.yaml`;
    const bytes = readFileSync(join(root, source));
    return { name, source, sourceHash: digest(bytes), tags: yaml.load(bytes.toString().split(/^---\s*$/m)[0]).tags || [] };
  });
  for (const c of plan.categories) assert(flowSources.some(f => !baseline.includes(f.name) && f.tags.includes(c)), `Add/select a deterministic scenario tagged ${c}`);
  claim();
  try {
    // A new run invalidates all previous receipts, including after a failed command.
    rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
    const { app, ...buildIdentity } = r;
    const report = { version: 1, ...buildIdentity, ...identity, ...server, inputHash: hash, result: 'running', startedAt: new Date().toISOString(),
      fixture, keychainReset: false, maestroVersion: run(process.env.MAESTRO_BIN || 'maestro', ['--version']), flows: [], exploration: [] };
    save(join(out, 'report.json'), report);
    if (process.env.FITSY_SIM_RESET_KEYCHAIN) {
      assert(process.env.FITSY_SIM_RESET_KEYCHAIN === udid, 'Keychain reset must explicitly name the selected disposable simulator');
      run('xcrun', ['simctl', 'keychain', udid, 'reset']);
      report.keychainReset = true;
      save(join(out, 'report.json'), report);
    }
    if (r.buildMode === 'owned-metro-test-store') {
      report.metro = await startMetro(r);
      report.bundleHash = report.metro.bundleHash;
      save(join(out, 'report.json'), report);
    }
    run('xcrun', ['simctl', 'install', udid, app]);
    for (const flow of flowSources) {
      const dir = join(out, flow.name); mkdirSync(dir);
      run(process.env.MAESTRO_BIN || 'maestro', ['test', '--udid', udid, join(root, flow.source), '--format', 'junit', '--output', join(dir, 'junit.xml'), '--debug-output', dir, '--test-output-dir', dir], { stdio: 'inherit' });
      const commands = files(dir).filter(f => /commands-.*\.json$/.test(f));
      assert(commands.length === 1, `Expected exactly one command report: ${flow.name}`);
      const screenshot = join(dir, 'outcome.png');
      run('xcrun', ['simctl', 'io', udid, 'screenshot', screenshot]);
      report.flows.push({ ...flow, commands: relative(out, commands[0]), sha256: digest(readFileSync(commands[0])), screenshot: relative(out, screenshot), screenshotHash: digest(readFileSync(screenshot)) });
      save(join(out, 'report.json'), report);
    }
    assert(hash === inputHash() && r.appHash === treeHash(app), 'Candidate changed during tests');
    assert(server.backendDeployment === backend().backendDeployment, 'Dev deployment changed during tests');
    await checkBundle(report);
    report.result = 'awaiting-walkthrough'; report.maestroFinishedAt = new Date().toISOString();
    save(join(out, 'report.json'), report);
    console.log('Maestro complete. Capture affected primary/recovery flows through Mobile MCP, then finish <walkthrough.json>.');
  } finally { release(); }
}
async function finish(walkthrough) {
  const report = read(join(out, 'report.json')), r = receipt();
  assert(report.result === 'awaiting-walkthrough', 'A completed deterministic run is required');
  assert(report.inputHash === inputHash() && report.appHash === r.appHash, 'Candidate changed after tests');
  assert(report.backendDeployment === backend().backendDeployment, 'Backend changed after tests');
  await checkBundle(report);
  // Walkthrough JSON: array of category/expected/observed/branches/result/trace.
  // trace paths must already be inside the run evidence directory; no secrets.
  report.exploration = walkthrough ? read(resolve(walkthrough)) : [];
  for (const o of report.exploration) {
    assert(typeof o.trace === 'string' && !o.trace.includes('..') && !o.trace.startsWith('/'), 'Trace must be a relative artifact path');
    o.sha256 = digest(readFileSync(join(out, o.trace)));
  }
  report.result = 'pass'; report.finishedAt = new Date().toISOString();
  const result = validate(report, impact(changedPaths(process.env.FITSY_DIFF_BASE)), inputHash(), out);
  save(join(out, 'report.json'), report); console.log(JSON.stringify(result));
}
async function check() {
  const report = read(join(out, 'report.json')), r = receipt();
  assert(report.appHash === r.appHash && report.configHash === r.configHash, 'Build/configuration changed after tests');
  assert(report.backendDeployment === backend().backendDeployment, 'Dev deployment changed after tests');
  await checkBundle(report);
}
try {
  const [command, ...args] = process.argv.slice(2);
  if (['build', 'run'].includes(command) && process.platform === 'darwin') {
    const awake = spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
    awake.on('error', error => console.error(`Could not prevent idle sleep: ${error.message}`));
    awake.unref();
  }
  if (command === 'build') {
    assert(args.length === 1 || (args.length === 2 && args[1] === '--test-store'), 'build UDID [--test-store]');
    await build(args[0], args[1] === '--test-store');
  }
  else if (command === 'run') await execute(args[0], args.slice(1));
  else if (command === 'finish') await finish(args[0]);
  else if (command === 'check') await check();
  else if (command === 'stop-metro') await stopMetro();
  else throw new Error('Usage: node --env-file=apps/mobile/.env.development.local scripts/sim/product-flow.mjs build UDID | run UDID [flow names] | finish [walkthrough.json]');
} catch (e) { console.error(e.message); process.exitCode = 1; }
