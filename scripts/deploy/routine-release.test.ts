import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// The new role guards add real subprocesses to the build fixtures. CI exceeded
// the old 60-second aggregate deadline; keep the complete Python suite bounded.
test('automatic release callers preserve exact-source Git deployment and build refusal boundaries', () => {
  const result = spawnSync('python3', ['-B', join(__dirname, 'routine-release.test.py')], {
    encoding: 'utf8', timeout: 90_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  expect({ status: result.status, stderr: result.stderr, error: result.error?.message }).toEqual({
    status: 0, stderr: expect.stringContaining('OK'), error: undefined,
  });
}, 95_000);
