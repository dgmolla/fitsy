import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { copyProductFlowControls } from '../verify/product-flow-fixture';

const { loadAll } = require('js-yaml') as { loadAll(source: string): unknown[] };

const modulePath = resolve(__dirname, 'ci.mjs');
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(GIT_|GITHUB_|FITSY_|EXPO_PUBLIC_|CI$|RUNNER_ENVIRONMENT$)/.test(key)));
let directory: string, cliPath: string;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'fitsy-local-scope-'));
  copyProductFlowControls(directory);
  mkdirSync(join(directory, 'scripts/sim'), { recursive: true });
  for (const file of ['ci.mjs', 'journey-fixtures.mjs', 'slack-video.mjs']) copyFileSync(join(__dirname, file), join(directory, 'scripts/sim', file));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, env: cleanEnv });
  git('init', '-q'); git('config', 'user.name', 'Local scope fixture'); git('config', 'user.email', 'fixture@example.test');
  git('config', 'core.hooksPath', '/dev/null'); git('add', '.'); git('commit', '-qm', 'baseline');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  cliPath = join(directory, 'scripts/sim/ci.mjs');
});
afterAll(() => { rmSync(directory, { recursive: true, force: true }); });

test('menu startup retries only observations and authenticates once before reading data', () => {
  const [, commands] = loadAll(readFileSync(resolve(__dirname, '../../apps/mobile/e2e/flows/menu-macro-serving.yaml'), 'utf8')) as [unknown, {
    launchApp?: object;
    retry?: object;
    runFlow?: object;
    openLink?: string;
  }[]];
  const launch = commands.findIndex(step => step.launchApp);
  expect(commands.filter(step => step.launchApp)).toHaveLength(1);
  expect(commands[launch]?.launchApp).toEqual({ clearState: true, clearKeychain: true });
  // Only local dev-client reconnection and bounded readiness reads may retry.
  expect(commands[launch + 1]).toEqual({
    retry: {
      maxRetries: 2,
      commands: [
        { runFlow: { when: { visible: 'Development Build' }, commands: [
          { tapOn: '^http://(localhost|127\\.0\\.0\\.1):[0-9]+$' },
        ] } },
        { waitForAnimationToEnd: { timeout: 10000 } },
        { extendedWaitUntil: { visible: { id: 'welcome-start' }, timeout: 30000 } },
      ],
    },
  });
  expect(commands.filter(step => step.retry)).toHaveLength(1);
  expect(commands.filter(step => step.runFlow)).toEqual([{
    runFlow: { file: '../helpers/discovery-signin.yaml', env: { DESTINATION: 'menu-search' } },
  }]);
  const [, signIn] = loadAll(readFileSync(resolve(__dirname, '../../apps/mobile/e2e/helpers/discovery-signin.yaml'), 'utf8')) as [unknown, Record<string, unknown>[]];
  expect(signIn.some(step => step.retry || step.launchApp || step.openLink)).toBe(false);
  expect(commands[launch + 2]).toEqual({ openLink: "${'fitsy://restaurant/' + output.seed.id}" });
});

test.each(['chain-menu-serving', 'cold-start-welcome', 'log-meal', 'meal-target-energy-sync', 'menu-load-recovery',
  'menu-macro-serving', 'onboarding-assisted-targets', 'onboarding-guided-preview', 'onboarding-out-of-area',
  'onboarding-target-ranked-search', 'onboarding-returning-preview', 'onboarding-search-highlight', 'paywall-access', 'paywall-live-terms', 'shuffle']
  .map(flow => `flows/${flow}`).concat('helpers/mixed-trial-visual'))('%s reconnects a cleared dev client only to local Metro before asserting guest readiness', flow => {
  const [, commands] = loadAll(readFileSync(resolve(__dirname, `../../apps/mobile/e2e/${flow}.yaml`), 'utf8')) as [unknown, {
    launchApp?: object;
    retry?: { maxRetries: number; commands: {
      runFlow?: { when: { visible: string }; commands: { tapOn: string }[] };
      extendedWaitUntil?: { visible: { id: string }; timeout: number };
    }[] };
    openLink?: string;
    tapOn?: { id: string };
  }[]];
  const launch = commands.findIndex(step => step.launchApp);
  expect(commands[launch]?.launchApp).toEqual({ clearState: true, clearKeychain: true,
    ...(['flows/onboarding-search-highlight', 'flows/onboarding-guided-preview'].includes(flow) ? { permissions: { notifications: 'deny' } } : {}) });
  const startup = commands[launch + 1]?.retry;
  expect(startup).toBeDefined();
  expect(startup!.maxRetries).toBeLessThanOrEqual(2);
  const launcher = startup!.commands.find(step => step.runFlow)!.runFlow!;
  expect(launcher.when).toEqual({ visible: 'Development Build' });
  const server = new RegExp(launcher.commands[0]!.tapOn);
  for (const url of ['http://localhost:8081', 'http://localhost:8099', 'http://127.0.0.1:8099']) expect(server.test(url)).toBe(true); // loopback test fixture
  for (const url of ['http://example.com:8081', 'http://localhost.evil:8081', 'http://127x0x0x1:8081']) expect(server.test(url)).toBe(false);
  expect(startup!.commands.find(step => step.extendedWaitUntil)?.extendedWaitUntil).toEqual({ visible: { id: 'welcome-start' }, timeout: 30000 });
  expect(commands.findIndex(step => step.openLink || step.tapOn?.id === 'welcome-start')).toBeGreaterThan(launch + 1);
});

test.each([
  ['flows/onboarding-out-of-area', 'waitlist-join', 0],
  ['flows/onboarding-out-of-area', 'goal-performance', 1],
  ['helpers/mixed-trial-visual', 'welcome-start', 0],
] as const)('%s observes %s despite a transient XCTest read', (flow, checkpoint, index) => {
  type Step = string | {
    launchApp?: object;
    runFlow?: { when: { visible: string }; commands: Step[] };
    retry?: { maxRetries: number; commands: Step[] };
    waitForAnimationToEnd?: { timeout: number };
    extendedWaitUntil?: { visible: { id: string; optional?: boolean }; timeout: number };
  };
  const [, commands] = loadAll(readFileSync(resolve(__dirname, `../../apps/mobile/e2e/${flow}.yaml`), 'utf8')) as [unknown, Step[]];
  const resumes = commands.flatMap((step, position) =>
    (checkpoint === 'welcome-start' ? typeof step === 'object' && step.launchApp : step === 'launchApp') ? [commands[position + 1]] : []);
  expect(resumes).toHaveLength(checkpoint === 'welcome-start' ? 1 : 2);
  const readiness = resumes[index];
  if (!readiness) throw new Error('Missing cold-resume readiness check');

  function run(visible: string, transient: 'animation' | 'hierarchy' | null, unavailable = false) {
    let reads = 0;
    let failedOnce = false;
    const observed: string[] = [];
    function read(kind: string) {
      reads++;
      if (unavailable || (!failedOnce && kind === transient)) {
        failedOnce = true;
        throw new Error('XCTest app hierarchy unavailable');
      }
    }
    function replay(steps: Step[]) {
      for (const step of steps) {
        if (typeof step === 'string') throw new Error(`Unexpected resume mutation: ${step}`);
        if (step.retry) {
          expect(step.retry.maxRetries).toBeLessThanOrEqual(2);
          for (let attempt = 0; ; attempt++) {
            try { replay(step.retry.commands); break; }
            catch (error) { if (attempt >= step.retry.maxRetries) throw error; }
          }
        } else if (step.runFlow) {
          read('hierarchy');
          // These scenarios already show an app screen, so Metro reconnection is unnecessary.
          expect(step.runFlow.when.visible).toBe('Development Build');
        } else if (step.waitForAnimationToEnd) {
          read('animation');
        } else if (step.extendedWaitUntil) {
          read('hierarchy');
          const { visible: selector, timeout } = step.extendedWaitUntil;
          expect(selector.optional).not.toBe(true);
          expect(timeout).toBe(30000);
          if (selector.id !== visible) throw new Error('Wrong resumed screen');
          observed.push(selector.id);
        } else throw new Error('Unexpected resume command');
      }
    }
    return { replay: () => replay([readiness!]), observed, reads: () => reads, failedOnce: () => failedOnce };
  }

  for (const transient of ['animation', 'hierarchy'] as const) {
    const device = run(checkpoint, transient);
    device.replay();
    expect(device.failedOnce()).toBe(true);
    expect(device.observed).toEqual([checkpoint]);
  }
  const unavailable = run(checkpoint, null, true);
  expect(unavailable.replay).toThrow('XCTest app hierarchy unavailable');
  expect(unavailable.reads()).toBeLessThanOrEqual(3);
  const wrongScreen = run('signup-apple', null);
  expect(wrongScreen.replay).toThrow('Wrong resumed screen');
  expect(wrongScreen.observed).toEqual([]);
});

test('every render smoke uses real journey setup, asserts its affected screen and saves a screenshot', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { readFileSync } from 'node:fs';
    import { createRequire } from 'node:module';
    import { renderSmoke } from ${JSON.stringify(modulePath)};
    import { renderCheckpoints, repository } from ${JSON.stringify(resolve(__dirname, '../verify/impact-plan.mjs'))};
    const yaml = createRequire(import.meta.url)('js-yaml');
    const cases = renderCheckpoints.map(([, flow, selector]) => {
      const source = yaml.loadAll(readFileSync(repository + '/apps/mobile/e2e/flows/' + flow + '.yaml', 'utf8'));
      const smoke = renderSmoke(source, selector);
      return { flow, selector, sourceLength: source[1].length, header: smoke[0], commands: smoke[1] };
    });
    process.stdout.write(JSON.stringify(cases));`], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  const cases = JSON.parse(result.stdout) as { flow: string; selector: object | string; sourceLength: number; header: object; commands: unknown[] }[];
  expect(cases.length).toBeGreaterThan(0);
  for (const entry of cases) {
    expect(entry.header).toMatchObject({ appId: 'com.fitsy.mobile' });
    expect(entry.commands.some(command => typeof command === 'object' && command !== null && 'launchApp' in command)).toBe(true);
    expect(entry.commands.slice(-3)).toEqual(['waitForAnimationToEnd', { assertVisible: entry.selector }, { takeScreenshot: 'render' }]);
    expect(entry.commands.length - 3).toBeLessThan(entry.sourceLength);
  }
});

test('missing render checkpoint fails before launching a native device', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {renderSmoke} from ${JSON.stringify(modulePath)};
     renderSmoke([{appId:'com.fitsy.mobile'}, [{launchApp: {}}]], {id:'missing-screen'});`], { encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Render smoke checkpoint is missing');
});


test.each([
  { args: ['--scope=none'], scope: 'none', flows: [] },
  { args: ['--scope=none', '--flows=-'], scope: 'none', flows: [] },
  { args: ['--scope=none', '--record-video'], scope: 'none', flows: [] },
  { args: ['--scope=flow', '--flows=signin-options', '--record-video'], scope: 'flow', flows: ['signin-options'] },
  { args: ['--scope=flow', '--flows=signin-options,paywall-access,signin-options'], scope: 'flow', flows: ['paywall-access', 'signin-options'] },
  { args: ['--scope=full'], scope: 'full' },
  { args: ['--scope=all'], scope: 'full' },
])('local scripted gate accepts explicit scope and flow list: $args', ({ args, scope, flows }) => {
  const result = spawnSync(process.execPath, [cliPath, ...args, '--plan'], { env: cleanEnv, encoding: 'utf8' });
  expect(result.status).toBe(0);
  const selection = JSON.parse(result.stdout);
  expect(selection.scope).toBe(scope);
  if (flows) expect(selection.flows).toEqual(flows);
  else expect(selection.flows).toEqual(expect.arrayContaining(['signin-options', 'paywall-access', 'onboarding-guided-preview', 'log-meal']));
});

test.each([
  ['--scope=unknown'], ['--scope=flow', '--flows=missing'],
  ['--scope=none', '--flows=signin-options'], ['--scope=full', '--flows=signin-options'],
  ['--scope=flow', '--flows='], ['--scope=smoke', '--flows=signin-options'],
  ['--scope=flow', '--scope=none'], ['--preflight'], ['--flows=../../private'],
  ['--record-video', '--record-video'], ['--record-video=true'],
].map(args => ({ args })))('invalid local scope cannot launch native resources: $args', ({ args }) => {
  const result = spawnSync(process.execPath, [cliPath, ...args, '--plan'], { env: cleanEnv, encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout).status).toBe('fail');
});

test.each([{ GITHUB_ACTIONS: 'true' }, { CI: 'true' }, { FITSY_RUNS: 'ci' }])('local runner rejects CI execution: %j', extra => {
  const result = spawnSync(process.execPath, [cliPath, '--scope=flow', '--flows=signin-options'], {
    env: { ...cleanEnv, ...extra }, encoding: 'utf8',
  });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fail', summary: expect.stringContaining('never in CI') });
});

test('none scope completes without native or recording tools or local configuration', () => {
  const result = spawnSync(process.execPath, [cliPath, '--scope=none', '--flows=-', '--record-video'], { env: cleanEnv, encoding: 'utf8' });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'skipped', required: false, scope: 'none' });
});

test.each([
  { extra: { EXPO_PUBLIC_API_URL: 'https://api.fitsy.org' }, error: 'refuses production' },
  { extra: { EXPO_PUBLIC_SUPABASE_URL: 'https://zaxkmjqozvmbifiwbxps.supabase.co' }, error: 'Production Supabase is forbidden' },
  { extra: { EXPO_PUBLIC_SUPABASE_ANON_KEY: '' }, error: 'Dev Supabase configuration is required' },
])('local simulator session preserves dev-only target checks: $extra', ({ extra, error }) => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { simulatorSession } from ${JSON.stringify(resolve(__dirname, 'product-flow.mjs'))};
     simulatorSession('54503F5C-8A3C-4699-8401-2E1D32890A24');`], {
    env: { ...cleanEnv, EXPO_PUBLIC_API_URL: 'https://dev.fitsy.org',
      EXPO_PUBLIC_SUPABASE_URL: 'https://dev-fixture.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon-key', ...extra }, encoding: 'utf8',
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(error);
});

test.each(['https://dev.fitsy.org', 'https://fitsy-api-git-codex-issue-583-dawits-projects-74b6e00f.vercel.app'])
('the real native entrypoint accepts configured nonproduction backend %s', origin => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { environment } from ${JSON.stringify(resolve(__dirname, 'product-flow.mjs'))};
     process.stdout.write(JSON.stringify(environment()));`], {
    env: { ...cleanEnv, EXPO_PUBLIC_API_URL: origin, EXPO_PUBLIC_SUPABASE_URL: 'https://dev-fixture.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon-key' }, encoding: 'utf8',
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).backend).toBe(origin);
});

test.each([
  ['--scope=none'], ['--scope=flow', '--flows=signin-options'],
  ['--scope=smoke', '--flows=reminders'],
])('explicit local scope cannot remove mandatory affected coverage: %j', (...args) => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {localSelection} from ${JSON.stringify(modulePath)};
     localSelection(${JSON.stringify(args)}, {simulator:{scope:'flow', flows:['reminders'], smoke:[]}});`],
  { env: cleanEnv, encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('cannot omit affected journeys');
});
