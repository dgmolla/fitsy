import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

function requireNodeSuite(name: string) {
  const result = execFileSync(process.execPath, ['--test', resolve(__dirname, name)],
    { encoding: 'utf8', timeout: 30_000 });
  const count = (kind: string) => Number(result.match(new RegExp(`^ℹ ${kind} (\\d+)$`, 'm'))?.[1] ?? -1);
  expect(count('tests')).toBeGreaterThan(0);
  expect(count('pass')).toBe(count('tests'));
  expect(count('fail')).toBe(0);
  expect(count('cancelled')).toBe(0);
  expect(count('skipped')).toBe(0);
}

test('evidence mode portable cases run in the canonical scripts suite', () => {
  requireNodeSuite('evidence-mode.test.mjs');
});

if (process.platform === 'darwin') {
  test('XCTest wrapper capture policy runs in the canonical macOS scripts suite', () => {
    requireNodeSuite('evidence-mode.macos.test.mjs');
  });
}
