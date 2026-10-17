import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const moduleUrl = new URL('./resource-admission.mjs', `file://${resolve(__dirname, 'resource-admission.test.ts')}`).href;
function check(availableGiB: number, hasDependencies: boolean, native: boolean) {
  const script = `import { admitResources } from ${JSON.stringify(moduleUrl)};
    process.stdout.write(JSON.stringify(admitResources({ root: '/fixture', exists: () => ${hasDependencies},
      disk: () => ({ bavail: ${availableGiB} * 1024 ** 3, bsize: 1 }),
      env: { FITSY_VERIFY_NEEDS_NATIVE: ${JSON.stringify(native ? '1' : '0')} } })));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as { status: string; summary: string; fix: string };
}

test('resource admission requires installed dependencies', () => {
  expect(check(20, false, false)).toMatchObject({ status: 'fail', summary: 'dependencies are missing' });
});
test('ordinary checks admit 2 GiB while native work requires 8 GiB', () => {
  expect(check(1, true, false)).toMatchObject({ status: 'fail', summary: 'free disk is below the 2 GiB admission floor' });
  expect(check(3, true, false).status).toBe('pass');
  expect(check(3, true, true)).toMatchObject({ status: 'fail', summary: 'free disk is below the 8 GiB admission floor' });
  expect(check(9, true, true).status).toBe('pass');
});
test('the checked-in registry requires admission before blocking checks', () => {
  const yaml = require('js-yaml') as { load(text: string): { checks: { name: string; blocking: boolean; preflight?: boolean }[] } };
  const registry = yaml.load(readFileSync(resolve(__dirname, 'registry.yml'), 'utf8'));
  expect(registry.checks.find(check => check.name === 'resource-admission')).toMatchObject({ blocking: true, preflight: true });
});

test('host pressure rejects warning, critical, unknown and conflicting kernel readings', () => {
  const script = `import assert from 'node:assert/strict';
    import { kernelPressure, hostSnapshot } from ${JSON.stringify(moduleUrl)};
    assert.equal(kernelPressure('kern.memorystatus_vm_pressure_level: 1\\n'), 'normal');
    assert.equal(kernelPressure('kern.memorystatus_vm_pressure_level: 2'), 'warning');
    assert.equal(kernelPressure('kern.memorystatus_vm_pressure_level: 4'), 'critical');
    for (const raw of ['', 'System-wide memory free percentage: 99%',
      'kern.memorystatus_vm_pressure_level: 3',
      'kern.memorystatus_vm_pressure_level: 1\\nkern.memorystatus_vm_pressure_level: 4']) {
      assert.equal(kernelPressure(raw), 'unknown');
    }
    const command = (_binary, args) => args[0] === 'vm.swapusage'
      ? 'vm.swapusage: total = 0.00M used = 0.00M free = 0.00M'
      : args.length ? 'kern.memorystatus_vm_pressure_level: 4'
      : 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\\nPages free: 10.\\nPages inactive: 20.\\nPages speculative: 30.\\n';
    const observed = hostSnapshot(command, () => ({ bavail: 20 * 1024 ** 3, bsize: 1 }), '/fixture');
    assert.equal(observed.memory_pressure, 'critical');
    assert.equal(observed.available_memory_bytes, 60 * 16384);
    assert.throws(() => hostSnapshot(() => 'unavailable', () => ({ bavail: 1, bsize: 1 }), '/fixture'), /incomplete/);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});
