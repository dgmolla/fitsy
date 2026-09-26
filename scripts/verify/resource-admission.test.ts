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
