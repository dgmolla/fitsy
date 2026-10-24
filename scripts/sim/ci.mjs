#!/usr/bin/env node
// Additive hosted diagnostics. The local product-flow acceptance gate is separate.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { impactPlan, repository, simulatorFlows, gitEnv, isMain } from '../verify/impact-plan.mjs';
import { billingFixture, hostedConfiguration, hostedCoverage, hostedJourney, verifyBillingFixture } from './hosted-journeys.mjs';

export function simulatorTarget(inventory) {
  const runtime = inventory.runtimes.filter(item => item.isAvailable && item.identifier.includes('.iOS-'))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  const type = inventory.devicetypes.filter(item => item.productFamily === 'iPhone' &&
    (!item.minRuntimeVersionString || runtime?.version.localeCompare(item.minRuntimeVersionString, undefined, { numeric: true }) >= 0) &&
    (!item.maxRuntimeVersionString || runtime?.version.localeCompare(item.maxRuntimeVersionString, undefined, { numeric: true }) <= 0))
    .sort((a, b) => Number(b.name === 'iPhone 16 Pro') - Number(a.name === 'iPhone 16 Pro') ||
      b.name.localeCompare(a.name, undefined, { numeric: true }))[0];
  if (!runtime || !type) throw new Error('An available iOS runtime and compatible iPhone simulator are required');
  return { runtime: runtime.identifier, type: type.identifier };
}

export function renderSmoke(documents, selector) {
  const [header, commands] = documents;
  const renders = step => {
    const visible = step?.assertVisible ?? step?.extendedWaitUntil?.visible;
    return JSON.stringify(visible) === JSON.stringify(selector) ||
      (step?.retry?.commands || []).some(renders);
  };
  const end = Array.isArray(commands) ? commands.findIndex(renders) : -1;
  if (!header?.appId || end < 0) throw new Error('Render smoke checkpoint is missing from the maintained flow');
  return [header, [...commands.slice(0, end + 1), 'waitForAnimationToEnd',
    { assertVisible: selector }, { takeScreenshot: 'render' }]];
}

export async function runCI(args = process.argv.slice(2)) {
  if (args.some(arg => !['--scope=changed', '--scope=all', '--plan', '--preflight'].includes(arg)))
    throw new Error('Usage: ci.mjs [--scope=changed|all] [--plan|--preflight]');
  const plan = impactPlan();
  const selection = args.includes('--scope=all') ? { risk: 'high', scope: 'full', required: true, mode: 'e2e', smoke: [],
    flows: simulatorFlows(), reason: 'Explicit all scope requires the full flow set' } : plan.simulator;
  console.error(`Simulator scope: ${selection.scope} (risk: ${selection.risk}, mode: ${selection.mode}); ${selection.reason}; flows: ${selection.flows.join(', ') || 'none'}`);
  const coverage = hostedCoverage(selection.flows);
  console.error(`Hosted Test Store flows: ${coverage.hosted.join(', ') || 'none'}`);
  for (const obligation of coverage.acceptance)
    console.error(`Apple acceptance required separately: ${obligation.flow}; ${obligation.reason}; ${obligation.command}`);
  if ((process.env.FITSY_CI_SIM_SCOPE && process.env.FITSY_CI_SIM_SCOPE !== selection.scope) ||
      (process.env.FITSY_CI_SIM_FLOWS && process.env.FITSY_CI_SIM_FLOWS !== JSON.stringify(selection.flows)) ||
      (process.env.FITSY_CI_SIM_MODE && process.env.FITSY_CI_SIM_MODE !== selection.mode) ||
      (process.env.FITSY_CI_SIM_SMOKE && process.env.FITSY_CI_SIM_SMOKE !== JSON.stringify(selection.smoke)))
    throw new Error('Simulator selection drifted from CI classification; rerun Verify');
  if (args.includes('--plan')) return selection;
  if (!selection.required) return { name: 'mobile-e2e', status: 'skipped', ...selection };
  if (!selection.flows.length) throw new Error('Required simulator flow catalog is missing or empty');
  if (!coverage.hosted.length) throw new Error('No hosted journeys selected; complete the reported Apple acceptance through product-flow.mjs');
  const preflight = args.includes('--preflight');
  if (!preflight && (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted'))
    throw new Error('Native CI execution requires an isolated GitHub-hosted checkout; use product-flow.mjs locally');
  if (!preflight && process.platform !== 'darwin') throw new Error('Simulator execution requires macOS with Xcode');
  const { profile, accounts } = hostedConfiguration(coverage.hosted, process.env);
  // Use the maintained native recipe, dev-target protection, Test Store profile,
  // keychain entitlement checks and owned Metro lifecycle. No production tokens.
  const { environment, prepareNative, compileNative, startMetro, stopMetro } = await import('./product-flow.mjs');
  const { admitDisk } = await import('./runner-controls.mjs');
  environment();
  if (preflight) return { name: 'mobile-e2e-config', status: 'pass',
    summary: 'Simulator configuration is present and valid; no native flows executed' };
  const fixtures = [];
  for (const account of Object.values(accounts)) fixtures.push(await verifyBillingFixture(account));
  admitDisk(repository, 'Hosted native build');
  const command = (binary, argv, extra = {}) => execFileSync(binary, argv, { cwd: repository,
    env: gitEnv(), encoding: 'utf8', stdio: 'inherit', ...extra });
  const maestro = process.env.MAESTRO_BIN || 'maestro';
  command(maestro, ['--version']); // Missing tools fail before creating native resources.
  const inventory = JSON.parse(command('xcrun', ['simctl', 'list', '--json'], { stdio: ['ignore', 'pipe', 'inherit'] }));
  const target = simulatorTarget(inventory);
  const out = resolve(repository, '.evidence/mobile-e2e');
  mkdirSync(out, { recursive: true });
  mkdirSync(resolve(repository, '.evidence/product-build'), { recursive: true });
  writeFileSync(resolve(out, 'selection.json'), JSON.stringify({ ...selection, coverage, fixtures, comparison: plan.comparison }, null, 2) + '\n');
  const yaml = createRequire(import.meta.url)('js-yaml');
  const setup = coverage.hosted.some(billingFixture)
    ? yaml.loadAll(readFileSync(resolve(repository, 'apps/mobile/e2e/setup/billing-signin.yaml'), 'utf8')) : null;
  const journeys = selection.mode === 'render' ? selection.smoke.map((smoke, index) => {
    const source = resolve(repository, `apps/mobile/e2e/flows/${smoke.flow}.yaml`);
    const docs = renderSmoke(yaml.loadAll(readFileSync(source, 'utf8')), smoke.selector);
    const name = `render-${index}-${smoke.flow}`;
    const path = resolve(out, `${name}.yaml`);
    writeFileSync(path, docs.map(doc => yaml.dump(doc)).join('---\n'));
    return { name, path, fixture: 'never_subscribed' };
  }) : coverage.hosted.map(name => {
    const source = resolve(repository, `apps/mobile/e2e/flows/${name}.yaml`);
    const fixture = billingFixture(name);
    if (!fixture) return { name, path: source, fixture: 'never_subscribed' };
    const path = resolve(out, `${name}.yaml`);
    writeFileSync(path, hostedJourney(name, yaml.loadAll(readFileSync(source, 'utf8')), setup)
      .map(doc => yaml.dump(doc)).join('---\n'));
    return { name, path, fixture };
  });
  if (!journeys.length) throw new Error('Required simulator selection has no executable journeys');
  let udid;
  try {
    udid = command('xcrun', ['simctl', 'create', `fitsy-ci-${process.env.GITHUB_RUN_ID || process.pid}`, target.type, target.runtime],
      { stdio: ['ignore', 'pipe', 'inherit'] }).trim();
    if (!/^[a-f0-9-]{36}$/i.test(udid)) throw new Error('simctl did not return an owned simulator UDID');
    command('xcrun', ['simctl', 'boot', udid]);
    command('xcrun', ['simctl', 'bootstatus', udid, '-b']);
    const buildEnv = prepareNative(profile, true);
    const { app } = compileNative(profile, udid, buildEnv);
    command('xcrun', ['simctl', 'install', udid, app]);
    let activeFixture;
    for (const { name, path, fixture } of journeys) {
      const flowOut = resolve(out, name); mkdirSync(flowOut, { recursive: true });
      if (activeFixture !== fixture) {
        // Expo embeds EXPO_PUBLIC_* at bundle time. A new owned Metro process
        // is required when the fixture identity changes; app state resets in YAML.
        await stopMetro();
        process.env.EXPO_PUBLIC_DEV_LOGIN_EMAIL = accounts[fixture].email;
        process.env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD = accounts[fixture].password;
        await startMetro(profile);
        activeFixture = fixture;
      }
      if (billingFixture(name)) {
        const receipt = await verifyBillingFixture(accounts[fixture]);
        writeFileSync(resolve(flowOut, 'fixture.json'), JSON.stringify(receipt, null, 2) + '\n');
      }
      console.error(`Hosted journey: ${name}; fixture: ${fixture}`);
      try {
        command(maestro, ['--device', udid, 'test', '--format', 'junit', '--output', resolve(flowOut, 'report.xml'),
          '--test-output-dir', flowOut, path]);
      } finally {
        const metroLog = resolve(repository, '.evidence/product-build/metro.log');
        if (existsSync(metroLog)) copyFileSync(metroLog, resolve(flowOut, 'metro.log'));
      }
    }
    return { name: 'mobile-e2e', status: 'pass', ...selection, coverage, simulator: udid, storeMode: profile.storeMode };
  } finally {
    // Only the exact device created by this run and its owned Metro are retired.
    try { await stopMetro(); }
    finally {
      if (udid && /^[a-f0-9-]{36}$/i.test(udid)) {
        try { command('xcrun', ['simctl', 'io', udid, 'screenshot', resolve(out, 'last-screen.png')]); }
        catch { /* Maestro and build logs retain the original failure. */ }
        try { command('xcrun', ['simctl', 'shutdown', udid]); }
        finally { command('xcrun', ['simctl', 'delete', udid]); }
      }
    }
  }
}

if (isMain(import.meta.url)) {
  try {
    const result = await runCI(); console.log(JSON.stringify(result));
    if (result.status === 'skipped') process.exitCode = 2;
  } catch (error) {
    console.log(JSON.stringify({ name: 'mobile-e2e', status: 'fail', summary: error.message,
      fix: 'Configure the missing repository variables and secrets using docs/engineering/devops/shipping.md, then rerun Verify; inspect CI artifacts for journey failures' }));
    process.exitCode = 1;
  }
}
