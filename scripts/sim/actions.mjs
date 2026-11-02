#!/usr/bin/env node
// GitHub owns scheduling and check publication; reuse native/Metro/Maestro helpers.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain, repository, simulatorFlows } from '../verify/impact-plan.mjs';

const controlDirectory = fileURLToPath(new URL('.', import.meta.url));
const buildDirectory = join(repository, '.evidence/product-build');
const app = join(buildDirectory, 'Build/Products/Debug-iphonesimulator/Fitsy.app');
const profile = { configuration: 'Debug', storeMode: 'test-store', buildMode: 'owned-metro-test-store', metroPort: 8099 };
const smoke = ['cold-start-welcome', 'signin-options', 'paywall-access'];
const command = (binary, args) => execFileSync(binary, args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }).trim();
const devices = () => Object.values(JSON.parse(command('xcrun', ['simctl', 'list', 'devices', 'available', '--json'])).devices).flat();

export function selectFlows(scope, catalog) {
  if (!['smoke', 'full'].includes(scope)) throw new Error('Simulator scope must be smoke or full');
  const selected = scope === 'smoke' ? smoke : Object.keys(catalog).filter(name => {
    const stores = (catalog[name].tags || []).filter(tag => tag.startsWith('store:'));
    return !stores.length || stores.includes('store:test-store');
  }).sort();
  if (!selected.length || selected.some(name => !catalog[name])) throw new Error('Required Maestro flows are missing');
  return selected;
}

export function fixtureAccounts(names, catalog, json) {
  let accounts;
  try { accounts = JSON.parse(json); } catch { throw new Error('SIM_E2E_FIXTURES must contain the documented account JSON'); }
  const required = new Set(['unsubscribed-dev']);
  for (const name of names) for (const tag of catalog[name].tags || []) if (tag.startsWith('fixture:')) required.add(tag.slice(8));
  for (const name of required) {
    const account = accounts?.[name];
    if (!['unsubscribed-dev', 'entitled-dev', 'empty-store', 'expired-subscription'].includes(name) ||
        typeof account?.email !== 'string' || !account.email.endsWith('@fitsy.dev') ||
        typeof account.password !== 'string' || !account.password.trim())
      throw new Error(`Missing disposable DEV credentials for ${name}`);
  }
  if (new Set([...required].map(name => accounts[name].email.toLowerCase())).size !== required.size)
    throw new Error('Each billing fixture requires a distinct DEV account');
  return accounts;
}

export function validateRuntime(env) {
  if (env.EXPO_PUBLIC_API_URL !== 'https://dev.fitsy.org' ||
      env.EXPO_PUBLIC_SUPABASE_URL !== 'https://kegycybiruksmrzvniha.supabase.co')
    throw new Error('Simulator CI requires the Fitsy DEV API and Supabase project');
  if (!env.EXPO_PUBLIC_SUPABASE_ANON_KEY || !env.EXPO_PUBLIC_REVENUECAT_TEST_KEY?.startsWith('test_'))
    throw new Error('DEV anon key and RevenueCat Test Store key are required');
  const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (key.startsWith('eyJ')) {
    let role;
    try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role; } catch { /* rejected below */ }
    if (role !== 'anon') throw new Error('Simulator CI requires an anon key, never a service key');
  } else if (!key.startsWith('sb_publishable_')) throw new Error('Simulator CI requires a public Supabase key');
}

// JSON secrets need individual masks before tools can render an account value.
const mask = value => console.log(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);

export function prepareRuntimeApp(cached, target, execute = command) {
  cpSync(cached, target, { recursive: true });
  const bundle = join(target, 'EXConstants.bundle');
  if (!existsSync(join(bundle, 'app.config'))) throw new Error('Native app is missing the Expo Constants configuration');
  // RevenueCat reads Constants, not process.env. Regenerate only the disposable
  // copy's public config with Expo's own build helper; leave the cache keyless.
  const require = createRequire(join(repository, 'apps/mobile/package.json'));
  execute(process.execPath, [join(dirname(require.resolve('expo-constants/package.json')), 'scripts/getAppConfig.js'), join(repository, 'apps/mobile'), bundle]);
  execute('codesign', ['--force', '--sign', '-', '--preserve-metadata=entitlements', target]);
  return target;
}

async function runFlows(udid, work) {
  validateRuntime(process.env);
  const { default: yaml } = await import('js-yaml');
  const catalog = Object.fromEntries(simulatorFlows().map(name => [name,
    yaml.loadAll(readFileSync(join(repository, 'apps/mobile/e2e/flows', `${name}.yaml`), 'utf8'))[0]]));
  const names = selectFlows(process.env.SIM_SCOPE, catalog);
  const accounts = fixtureAccounts(names, catalog, process.env.SIM_E2E_FIXTURES);
  for (const account of Object.values(accounts)) { mask(account.email); mask(account.password); }
  delete process.env.SIM_E2E_FIXTURES;
  const { startMetro, stopMetro, prepareEntitledEvidence } = await import('./product-flow.mjs');
  const { runOwnedMaestro } = await import('./runner-controls.mjs');
  const { assertFlowCommands } = await import('../verify/product-flow.mjs');
  const { requireScreenRecognition, inspectScreenshotDirectory } = await import('./screen-guard.mjs');
  requireScreenRecognition();
  command('xcrun', ['simctl', 'install', udid, prepareRuntimeApp(app, join(work, 'Fitsy.app'))]);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const runFlow = async (name, path, extra = []) => {
    if (controller.signal.aborted) throw new Error('Simulator run interrupted');
    const dir = join(work, name); mkdirSync(dir, { recursive: true });
    const loginArgs = ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_DEV_LOGIN_EMAIL', 'EXPO_PUBLIC_DEV_LOGIN_PASSWORD']
      .flatMap(key => ['-e', `${key}=${process.env[key]}`]);
    const result = await runOwnedMaestro(process.env.MAESTRO_BIN || 'maestro', ['--device', udid, 'test', ...loginArgs, ...extra,
      '--format', 'junit', '--output', join(dir, 'report.xml'), '--debug-output', dir, '--test-output-dir', dir, path], {
      cwd: repository, dir, timeline: join(work, 'timeline.jsonl'), flow: readFileSync(path, 'utf8'), signal: controller.signal,
      env: { ...process.env, PATH: `${controlDirectory}${delimiter}${process.env.PATH}`,
        FITSY_XCTEST_CAPTURE_RECEIPT: join(dir, 'capture.jsonl') },
      diagnostic: () => command('xcrun', ['simctl', 'io', udid, 'screenshot', join(dir, 'failure.png')]),
    });
    if (result.code !== 0 || result.reason) throw new Error(`Maestro failed: ${name}`);
    const reports = readdirSync(dir, { recursive: true }).filter(file => /(?:^|\/)commands-.*\.json$/.test(file));
    if (reports.length !== 1) throw new Error(`Missing Maestro command report: ${name}`);
    assertFlowCommands(readFileSync(path), JSON.parse(readFileSync(join(dir, reports[0]), 'utf8')), name);
    // Setup may intentionally reach the expired screen; its maintained target
    // flow validates that screen after setup, including pixel checks.
    if (!name.endsWith('-signin')) inspectScreenshotDirectory(dir, readFileSync(path));
  };
  try {
    console.log(`Running ${names.length} ${process.env.SIM_SCOPE} flows; Apple receipt-history acceptance remains manual.`);
    for (const name of names) {
      const fixture = (catalog[name].tags || []).find(tag => tag.startsWith('fixture:'))?.slice(8) || 'unsubscribed-dev';
      process.env.EXPO_PUBLIC_DEV_LOGIN_EMAIL = accounts[fixture].email;
      process.env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD = accounts[fixture].password;
      try {
        await startMetro(profile, { maxWorkers: 1 });
        if (fixture === 'entitled-dev') await prepareEntitledEvidence(profile, udid, join(work, `${name}-active-setup`));
        if (['empty-store', 'expired-subscription'].includes(fixture))
          await runFlow(`${name}-signin`, join(repository, 'apps/mobile/e2e/helpers/ci-signin.yaml'),
            ['-e', `DESTINATION=${fixture === 'empty-store' ? 'paywall-restore' : 'resubscribe-restore'}`]);
        await runFlow(name, join(repository, 'apps/mobile/e2e/flows', `${name}.yaml`));
        console.log(`Passed: ${name}`);
      } finally { await stopMetro(); }
    }
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  }
}

export async function main(action) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'macOS' ||
      resolve(process.env.GITHUB_WORKSPACE || '.') !== repository)
    throw new Error('Use this runner only in its GitHub Actions macOS checkout');
  if (!process.env.RUNNER_TEMP || !/^\d+$/.test(process.env.GITHUB_RUN_ID || '') || !/^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT || ''))
    throw new Error('Missing job-owned temporary directory');
  const work = join(resolve(process.env.RUNNER_TEMP), `fitsy-simulator-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`);
  const marker = join(work, 'device.json');
  if (action === 'cleanup') {
    let metroStopped = false;
    try {
      if (existsSync(join(buildDirectory, 'metro.json'))) await (await import('./product-flow.mjs')).stopMetro();
      metroStopped = true;
    } finally {
      if (existsSync(marker)) {
        const { udid } = JSON.parse(readFileSync(marker, 'utf8'));
        try {
          if (devices().find(device => device.udid === udid)?.state !== 'Shutdown') command('xcrun', ['simctl', 'shutdown', udid]);
          command('xcrun', ['simctl', 'erase', udid]);
        } finally { command('bash', [join(controlDirectory, 'sim'), 'release']); }
      }
      // stopMetro deliberately retains ownership evidence when termination fails.
      // Keep its files and temporary data until the live consumer is recovered.
      if (metroStopped) for (const dir of [work, buildDirectory, join(repository, 'apps/mobile/ios'), join(repository, 'apps/mobile/.expo')])
        rmSync(dir, { recursive: true, force: true });
    }
    return;
  }
  if (action === 'fingerprint') {
    const { nativeFingerprint } = await import('../deploy/native-fingerprint.mjs');
    const { fingerprint } = await nativeFingerprint(repository);
    const { recipeIdentity } = await import('./product-flow.mjs');
    const tools = createHash('sha256').update(command('xcodebuild', ['-version']) + command('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-build-version']) + recipeIdentity().hash).digest('hex').slice(0, 16);
    appendFileSync(process.env.GITHUB_OUTPUT, `key=${fingerprint.hash}-${tools}\n`);
    return;
  }
  const udid = process.env.FITSY_XCTEST_SIM_UDID;
  if (!/^[A-F0-9-]{36}$/i.test(udid || '')) throw new Error('Set FITSY_SIM_UDID to the dedicated iPhone 15');
  if (action === 'boot') {
    const inventory = devices();
    const device = inventory.find(item => item.udid === udid);
    if (device?.deviceTypeIdentifier !== 'com.apple.CoreSimulator.SimDeviceType.iPhone-15') throw new Error('FITSY_SIM_UDID must select an available iPhone 15');
    if (inventory.some(item => item.state === 'Booted')) throw new Error('A simulator is already booted; release its current owner first');
    mkdirSync(work, { recursive: true, mode: 0o700 });
    command('bash', [join(controlDirectory, 'sim'), 'claim', '--minutes', '35']);
    writeFileSync(marker, JSON.stringify({ udid }));
    command('xcrun', ['simctl', 'boot', udid]);
    command('xcrun', ['simctl', 'bootstatus', udid, '-b']);
    return;
  }
  if (!existsSync(marker)) throw new Error('Simulator has not been claimed by this job');
  mkdirSync(join(work, 'tmp'), { recursive: true });
  process.env.TMPDIR = join(work, 'tmp');
  process.env.JAVA_TOOL_OPTIONS = `-Djava.io.tmpdir=${process.env.TMPDIR}`;
  if (action === 'build') {
    const { prepareNative, compileNative } = await import('./product-flow.mjs');
    mkdirSync(buildDirectory, { recursive: true });
    // This step receives no runtime secrets. Only current-source Metro gets them.
    const env = prepareNative(profile, true);
    compileNative(profile, udid, env, 1);
  } else if (action === 'run') await runFlows(udid, work);
  else throw new Error('Usage: actions.mjs fingerprint|boot|build|run|cleanup');
}

if (isMain(import.meta.url)) {
  try { await main(process.argv[2]); }
  catch (error) {
    // Child errors can embed argv/environment; never print those to Actions.
    console.error(error.code || error.status ? 'Simulator command failed; check runner setup and preceding step.' : error.message);
    process.exitCode = 1;
  }
}
