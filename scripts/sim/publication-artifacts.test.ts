import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('publication artifact archive passes the Node ESM regression suite', () => {
  const result = execFileSync(process.execPath, ['--test', resolve(__dirname, 'publication-artifacts.test.mjs')],
    { encoding: 'utf8', timeout: 30_000 });
  const count = (name: string) => Number(result.match(new RegExp(`^ℹ ${name} (\\d+)$`, 'm'))?.[1] ?? -1);
  expect(count('tests')).toBeGreaterThan(0);
  expect(count('pass')).toBe(count('tests'));
  expect(count('fail')).toBe(0);
  expect(count('cancelled')).toBe(0);
  expect(count('skipped')).toBe(0);
});
