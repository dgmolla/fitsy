import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('production write identities require real signatures and exact trusted claims', () => {
  const output = execFileSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap',
    resolve(__dirname, 'production-write-identity.integration.ts')], { encoding: 'utf8', timeout: 20_000 });
  expect(output).toMatch(/^# tests 5$/m);
  expect(output).toMatch(/^# fail 0$/m);
  expect(output).toMatch(/^# skipped 0$/m);
});
