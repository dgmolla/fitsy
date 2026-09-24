import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('native runner controls pass the Node ESM regression suite', () => {
  const result = execFileSync(process.execPath, ['--test', resolve(__dirname, 'runner-controls.test.mjs')],
    { encoding: 'utf8', timeout: 30_000 });
  expect(result).toContain('pass 7');
  expect(result).toContain('fail 0');
});
