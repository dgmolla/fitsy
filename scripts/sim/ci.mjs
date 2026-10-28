#!/usr/bin/env node
// Retained CLI path for the maintainer's local sim-review poller. Never runs in CI.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { impactPlan, repository, simulatorFlows, gitEnv, isMain } from '../verify/impact-plan.mjs';
import { journeyFixture, withFixtureEnvironment, prepareJourney, assertJourneyStore } from './journey-fixtures.mjs';
import { withSlackVideo } from './slack-video.mjs';
import { maestroApiArgs } from './backend-identity.mjs';

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

export function localSelection(args, plan = impactPlan()) {
  const options = {};
  for (const arg of args) {
    const match = /^--(scope|flows|udid)=(.*)$|^--(plan|record-video)$/.exec(arg);
    if (!match || Object.hasOwn(options, match[1] || match[3]))
      throw new Error('Usage: ci.mjs [--scope=none|smoke|flow|full|changed|all] [--flows=name,...] [--udid=UDID] [--plan] [--record-video]');
    options[match[1] || match[3]] = match[1] ? match[2] : true;
  }
  const scope = options.scope === 'all' ? 'full' : !options.scope || options.scope === 'changed' ? plan.simulator.scope : options.scope;
  if (!['none', 'smoke', 'flow', 'full'].includes(scope)) throw new Error(`Unknown simulator scope: ${scope}`);
  const all = simulatorFlows();
  const flows = options.flows === undefined ? (scope === 'full' ? all : scope === 'none' ? [] : plan.simulator.flows)
    : options.flows === '' || options.flows === '-' ? [] : [...new Set(options.flows.split(','))].sort();
  if (flows.some(name => !/^[a-z0-9-]+$/.test(name) || !all.includes(name))) throw new Error('Unknown simulator flow');
  if ((scope === 'none') !== (flows.length === 0)) throw new Error('Required scope needs flows; none scope cannot run flows');
  if (scope === 'full' && JSON.stringify(flows) !== JSON.stringify(all)) throw new Error('Full scope must include every maintained flow');
  const rank = { none: 0, smoke: 1, flow: 2, full: 3 };
  if (rank[scope] < rank[plan.simulator.scope] || plan.simulator.flows.some(flow => !flows.includes(flow)))
    throw new Error('Explicit scope cannot omit affected journeys or their required assertions');
  const smoke = scope === 'smoke' ? plan.simulator.smoke.filter(item => flows.includes(item.flow)) : [];
  if (scope === 'smoke' && flows.some(flow => !smoke.some(item => item.flow === flow)))
    throw new Error('Smoke scope requires classified render checkpoints; set the matching comparison range');
  return { ...options, selection: { ...plan.simulator, scope, required: scope !== 'none',
    risk: scope === 'full' ? 'high' : scope === 'none' ? 'low' : 'medium',
    mode: scope === 'none' ? 'none' : scope === 'smoke' ? 'render' : 'e2e', flows, smoke,
    omitted: all.filter(flow => !flows.includes(flow)).map(flow => ({ flow, reason: 'Unaffected by the mapped change; no shared or ambiguous impact' })),
    reason: options.scope && options.scope !== 'changed' ? `Explicit local ${scope} scope` : plan.simulator.reason } };
}

export async function runLocal(args = process.argv.slice(2)) {
  const plan = impactPlan();
  const options = localSelection(args, plan), { selection } = options;
  console.error(`Simulator scope: ${selection.scope} (mode: ${selection.mode}); ${selection.reason}; flows: ${selection.flows.join(', ') || 'none'}`);
  if (options.plan) return selection;
  if (!selection.required) return { name: 'mobile-e2e', status: 'skipped', ...selection };
  if (process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true' || process.env.FITSY_RUNS === 'ci')
    throw new Error('Simulators run locally on the maintainer Mac, never in CI');
  if (process.platform !== 'darwin') throw new Error('Simulator execution requires macOS with Xcode');
  const udid = options.udid || process.env.FITSY_XCTEST_SIM_UDID;
  if (!/^[a-f0-9-]{36}$/i.test(udid || '')) throw new Error('Pass --udid=<owned booted simulator UDID> or set FITSY_XCTEST_SIM_UDID');
  const { environment, simulatorSession, claimDevice, releaseDevice, startMetro, stopMetro } = await import('./product-flow.mjs');
  const { admitDisk, runOwnedMaestro } = await import('./runner-controls.mjs');
  const { inputHash, assertFlowCommands } = await import('../verify/product-flow.mjs');
  const maestro = process.env.MAESTRO_BIN || 'maestro';
  const command = (binary, argv) => execFileSync(binary, argv, { cwd: repository, env: gitEnv(), stdio: 'inherit', timeout: 30000 });
  const yaml = createRequire(import.meta.url)('js-yaml');
  // Parse checkpoints and check syntax before acquiring the shared native driver.
  const journeys = selection.mode === 'render' ? selection.smoke.map((smoke, index) => ({
    name: `render-${index}-${smoke.flow}`,
    flow: smoke.flow,
    documents: renderSmoke(yaml.loadAll(readFileSync(resolve(repository, `apps/mobile/e2e/flows/${smoke.flow}.yaml`), 'utf8')), smoke.selector),
  })) : selection.flows.map(name => ({ name, flow: name, path: resolve(repository, `apps/mobile/e2e/flows/${name}.yaml`) }));
  // Resolve every required fixture before acquiring a device or clearing state.
  // The YAML remains the single catalog of journeys and their starting states.
  for (const journey of journeys) {
    journey.fixture = journeyFixture((journey.documents || yaml.loadAll(readFileSync(journey.path, 'utf8')))[0]);
  }
  const out = resolve(repository, `.evidence/mobile-e2e/${Date.now()}-${process.pid}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'selection.json'), JSON.stringify({ ...selection, comparison: plan.comparison }, null, 2) + '\n');
  for (const journey of journeys) {
    if (journey.documents) {
      journey.path = resolve(out, `${journey.name}.yaml`);
      writeFileSync(journey.path, journey.documents.map(doc => yaml.dump(doc)).join('---\n'));
    }
    command(maestro, ['check-syntax', journey.path]);
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  const sourceHash = inputHash();
  admitDisk(repository, 'Local simulator scope');
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    for (const { name, flow, path, fixture } of journeys) {
      if (controller.signal.aborted) throw new Error('Simulator run interrupted');
      const dir = resolve(out, name); mkdirSync(dir, { recursive: true });
      await withFixtureEnvironment(fixture, async () => {
        environment(); // Preserve dev-only API and Supabase target protection before setup too.
        prepareJourney(fixture, flow, udid);
        if (controller.signal.aborted) throw new Error('Simulator run interrupted during fixture preparation');
        if (inputHash() !== sourceHash) throw new Error('Candidate source changed during fixture preparation');
        claimDevice();
        let metroStarted = false;
        try {
          const session = simulatorSession(udid);
          assertJourneyStore(fixture, session.built);
          writeFileSync(resolve(dir, 'identity.json'), JSON.stringify({ ...session, fixture: fixture.name }, null, 2) + '\n');
          if (session.built.metroPort) { metroStarted = true; await startMetro(session.built); }
          const loginArgs = ['EXPO_PUBLIC_DEV_LOGIN_EMAIL', 'EXPO_PUBLIC_DEV_LOGIN_PASSWORD'].flatMap(key => {
            if (fixture.name === 'entitled-dev' && !process.env[key]?.trim()) throw new Error(`Local ${key} is required for log-meal`);
            return process.env[key] ? ['-e', `${key}=${process.env[key]}`] : [];
          });
          const result = await withSlackVideo({ enabled: options['record-video'] || process.env.FITSY_SIM_RECORD_VIDEO === '1',
            udid, dir, signal: controller.signal }, () => runOwnedMaestro(maestro, ['--device', udid, 'test', ...maestroApiArgs(), ...loginArgs, '--format', 'junit',
            '--output', resolve(dir, 'report.xml'), '--debug-output', dir, '--test-output-dir', dir, path], {
            cwd: repository, dir, timeline: resolve(out, 'timeline.jsonl'), flow: readFileSync(path, 'utf8'),
            signal: controller.signal, env: { ...gitEnv(),
              PATH: `${resolve(repository, 'scripts/sim')}${delimiter}${process.env.PATH || ''}`,
              FITSY_XCTEST_SIM_UDID: udid, FITSY_XCTEST_CAPTURE_RECEIPT: resolve(dir, 'capture.jsonl') },
            diagnostic: () => command('xcrun', ['simctl', 'io', udid, 'screenshot', resolve(dir, 'failure.png')]),
          }));
          if (result.code !== 0 || result.reason) throw new Error(`Maestro flow ${name} failed; inspect ${dir}`);
          const reports = readdirSync(dir, { recursive: true }).filter(file => /(?:^|\/)commands-.*\.json$/.test(file));
          if (reports.length !== 1) throw new Error(`Expected exactly one command report: ${name}`);
          assertFlowCommands(readFileSync(path), JSON.parse(readFileSync(resolve(dir, reports[0]), 'utf8')), name);
          if (inputHash() !== sourceHash || environment().configHash !== session.configHash)
            throw new Error('Candidate source or public configuration changed during simulator execution');
        } finally {
          try { if (metroStarted) await stopMetro(); }
          finally { releaseDevice(); }
        }
      });
    }
    return { name: 'mobile-e2e', status: 'pass', ...selection, simulator: udid, evidence: out };
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  }
}

if (isMain(import.meta.url)) {
  try {
    const result = await runLocal(); console.log(JSON.stringify(result));
  } catch (error) {
    console.log(JSON.stringify({ name: 'mobile-e2e', status: 'fail', summary: error.message,
      fix: 'Load local dev configuration and prepare the owned candidate simulator using docs/engineering/devops/shipping.md' }));
    process.exitCode = 1;
  }
}
