import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const suite = join(__dirname, 'routine-release.test.py');
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
const cases: unknown = JSON.parse(execFileSync('python3', ['-B', suite, '--list-tests'], {
  encoding: 'utf8', timeout: 10_000, env,
}));
if (!Array.isArray(cases) || cases.length === 0 ||
    cases.some(name => typeof name !== 'string' || !/^\w+\.test_\w+$/.test(name))) {
  throw new Error('Release safety suite did not discover runnable test cases');
}

// Build fixtures run real guarded subprocesses. Give each discovered case the
// existing bounded budget, so suite growth cannot time out all remaining cases.
test.each(cases)('release safety: %s', name => {
  const result = spawnSync('python3', ['-B', suite, name], {
    encoding: 'utf8', timeout: 90_000,
    env,
  });
  expect({ status: result.status, stderr: result.stderr, error: result.error?.message }).toEqual({
    status: 0, stderr: expect.stringContaining('OK'), error: undefined,
  });
  expect(result.stderr).toMatch(/\bRan 1 test in /);
}, 95_000);
