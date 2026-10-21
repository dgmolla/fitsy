import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

test('automatic release callers preserve exact-source and provider refusal boundaries', () => {
  const result = spawnSync('python3', ['-B', join(__dirname, 'routine-release.test.py')], {
    encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  expect({ status: result.status, stderr: result.stderr, error: result.error?.message }).toEqual({
    status: 0, stderr: expect.stringContaining('OK'), error: undefined,
  });
}, 65_000);
