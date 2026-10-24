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

test('hosted execution cannot overwrite a local native session', () => {
  const result = spawnSync(process.execPath, [modulePath, '--scope=all'], {
    env: { ...process.env, GITHUB_ACTIONS: 'false', FITSY_CI_SIM_SCOPE: '', FITSY_CI_SIM_FLOWS: '' }, encoding: 'utf8',
  });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fail', summary: expect.stringContaining('isolated GitHub-hosted checkout') });
});
