import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const modulePath = resolve(__dirname, 'ci.mjs');
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
