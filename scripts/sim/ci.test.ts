import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const modulePath = resolve(__dirname, 'ci.mjs');
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(GIT_|GITHUB_|FITSY_|EXPO_PUBLIC_|CI$|RUNNER_ENVIRONMENT$)/.test(key)));
const configuration = {
  EXPO_PUBLIC_API_URL: 'https://dev.fitsy.org',
  EXPO_PUBLIC_SUPABASE_URL: 'https://dev-fixture.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon-key',
  EXPO_PUBLIC_REVENUECAT_TEST_KEY: 'test_fixture',
  EXPO_PUBLIC_DEV_LOGIN_EMAIL: 'empty@example.test',
  EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'private-empty-password',
  FITSY_SIM_EXPIRED_LOGIN_EMAIL: 'expired@example.test',
  FITSY_SIM_EXPIRED_LOGIN_PASSWORD: 'private-expired-password',
};
const settings = [
  ['EXPO_PUBLIC_SUPABASE_URL', 'FITSY_SIM_SUPABASE_URL'],
  ['EXPO_PUBLIC_SUPABASE_ANON_KEY', 'FITSY_SIM_SUPABASE_ANON_KEY'],
  ['EXPO_PUBLIC_REVENUECAT_TEST_KEY', 'FITSY_SIM_REVENUECAT_TEST_KEY'],
  ['EXPO_PUBLIC_DEV_LOGIN_EMAIL', 'FITSY_SIM_LOGIN_EMAIL'],
  ['EXPO_PUBLIC_DEV_LOGIN_PASSWORD', 'FITSY_SIM_LOGIN_PASSWORD'],
  ['FITSY_SIM_EXPIRED_LOGIN_EMAIL', 'FITSY_SIM_EXPIRED_LOGIN_EMAIL'],
  ['FITSY_SIM_EXPIRED_LOGIN_PASSWORD', 'FITSY_SIM_EXPIRED_LOGIN_PASSWORD'],
] as const;
function preflight(extra: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [modulePath, '--scope=all', '--preflight'], {
    env: { ...cleanEnv, ...extra }, encoding: 'utf8', timeout: 10000,
  });
}

test.each([
  { existingURL: false },
  // Matches hosted CI with DEV_SUPABASE_URL already configured: six settings remain.
  { existingURL: true },
])('configuration preflight reports the exact setup gap (existing URL=$existingURL)', ({ existingURL }) => {
  const result = preflight({ EXPO_PUBLIC_API_URL: configuration.EXPO_PUBLIC_API_URL,
    ...(existingURL ? { EXPO_PUBLIC_SUPABASE_URL: configuration.EXPO_PUBLIC_SUPABASE_URL } : {}) });
  expect(result.status).toBe(1);
  const receipt = JSON.parse(result.stdout);
  expect(receipt.status).toBe('fail');
  expect(receipt.summary).toBe('Missing hosted simulator configuration: ' + settings.slice(existingURL ? 1 : 0)
    .map(([key, setting]) => key === 'EXPO_PUBLIC_SUPABASE_URL' ? 'variable FITSY_SIM_SUPABASE_URL or secret DEV_SUPABASE_URL'
      : `${key.includes('PASSWORD') ? 'secret' : 'variable'} ${setting}`).join('; '));
  // The informational Apple obligation is not what failed this preflight.
  expect(result.stderr).toContain('Apple acceptance required separately');
  expect(receipt.summary).not.toContain('Apple acceptance');
  expect(receipt.fix).toContain('docs/engineering/devops/shipping.md');
});

test.each(settings)('configuration preflight rejects absent %s and names its repository setting', (key, setting) => {
  const result = preflight({ ...configuration, [key]: '   ' });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fail', summary: expect.stringContaining(setting) });
  expect(result.stdout + result.stderr).not.toMatch(/private-empty-password|private-expired-password|fixture-anon-key/);
});

test('valid configuration preflight supplies no native or billing acceptance result', () => {
  const result = preflight(configuration);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    name: 'mobile-e2e-config', status: 'pass', summary: expect.stringContaining('no native flows executed'),
  });
  expect(result.stdout + result.stderr).not.toMatch(/private-empty-password|private-expired-password|fixture-anon-key/);
});

test.each([
  { extra: { EXPO_PUBLIC_API_URL: 'https://api.fitsy.org' }, error: 'refuses production' },
  { extra: { EXPO_PUBLIC_SUPABASE_URL: 'https://zaxkmjqozvmbifiwbxps.supabase.co' }, error: 'Production Supabase is forbidden' },
  { extra: { EXPO_PUBLIC_REVENUECAT_TEST_KEY: 'appl_fixture' }, error: 'requires EXPO_PUBLIC_REVENUECAT_TEST_KEY' },
  { extra: { EXPO_PUBLIC_DEV_LOGIN_EMAIL: 'dev@fitsy.local' }, error: 'disposable account' },
  { extra: { FITSY_SIM_EXPIRED_LOGIN_EMAIL: 'EMPTY@example.test' }, error: 'distinct disposable accounts' },
])('configuration preflight retains native environment protections: $extra', ({ extra, error }) => {
  const result = preflight({ ...configuration, ...extra });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fail', summary: expect.stringContaining(error) });
});

const runtime = (version: string, isAvailable = true) => ({ version, isAvailable, identifier: `com.apple.CoreSimulator.SimRuntime.iOS-${version}` });
const phone = (name: string, minRuntimeVersionString = '18.0', maxRuntimeVersionString = '99.0') =>
  ({ name, minRuntimeVersionString, maxRuntimeVersionString, productFamily: 'iPhone', identifier: name });
function target(inventory: object) {
  return spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {simulatorTarget} from ${JSON.stringify(modulePath)};
     process.stdout.write(JSON.stringify(simulatorTarget(${JSON.stringify(inventory)})));`], { encoding: 'utf8' });
}

test.each([
  { runtimes: [runtime('18.5'), runtime('18.10'), runtime('19.0', false)],
    devicetypes: [phone('iPhone 15'), phone('iPhone 16 Pro')], expectedRuntime: '18.10', expectedPhone: 'iPhone 16 Pro' },
  { runtimes: [runtime('18.5')], devicetypes: [phone('iPhone 16 Pro', '19.0'), phone('iPhone 15')],
    expectedRuntime: '18.5', expectedPhone: 'iPhone 15' },
  { runtimes: [runtime('18.5')], devicetypes: [phone('iPhone 9', '10.0', '15.0'), phone('iPhone 14')],
    expectedRuntime: '18.5', expectedPhone: 'iPhone 14' },
])('uses an available compatible runtime and predictable iPhone: %j', entry => {
  const result = target(entry);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ type: entry.expectedPhone, runtime: runtime(entry.expectedRuntime).identifier });
});

test.each([
  { runtimes: [], devicetypes: [phone('iPhone 16 Pro')] },
  { runtimes: [runtime('18.5', false)], devicetypes: [phone('iPhone 16 Pro')] },
  { runtimes: [runtime('18.5')], devicetypes: [] },
  { runtimes: [runtime('18.5')], devicetypes: [phone('iPhone 16 Pro', '19.0')] },
])('unavailable or incompatible native tools never select a device: %j', inventory => {
  const result = target(inventory);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('available iOS runtime and compatible iPhone');
});

test('hosted caller rejects a drifted classification before starting native resources', () => {
  const result = spawnSync(process.execPath, [modulePath, '--scope=all'], {
    env: { ...process.env, FITSY_CI_SIM_SCOPE: 'affected', FITSY_CI_SIM_FLOWS: '[]' }, encoding: 'utf8',
  });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fail', summary: expect.stringContaining('drifted from CI classification') });
});

test.each([
  { FITSY_CI_SIM_MODE: 'render' },
  { FITSY_CI_SIM_SMOKE: '[{"flow":"reminders"}]' },
])('hosted caller rejects drifted UI smoke mode or checkpoints: %j', extra => {
  const result = spawnSync(process.execPath, [modulePath, '--scope=all'], {
    env: { ...process.env, FITSY_CI_SIM_SCOPE: '', FITSY_CI_SIM_FLOWS: '', FITSY_CI_SIM_MODE: '', FITSY_CI_SIM_SMOKE: '', ...extra }, encoding: 'utf8',
  });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fail', summary: expect.stringContaining('drifted from CI classification') });
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

test('hosted execution cannot overwrite a local native session', () => {
  const result = spawnSync(process.execPath, [modulePath, '--scope=all'], {
    env: { ...process.env, GITHUB_ACTIONS: 'false', FITSY_CI_SIM_SCOPE: '', FITSY_CI_SIM_FLOWS: '' }, encoding: 'utf8',
  });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fail', summary: expect.stringContaining('isolated GitHub-hosted checkout') });
});
