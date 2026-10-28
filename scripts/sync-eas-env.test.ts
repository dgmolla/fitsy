import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

test('EAS sync validates an explicit source and single target before any mutation', () => {
  const result = spawnSync('python3', ['-B', join(__dirname, 'sync-eas-env.test.py')], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  expect({ status: result.status, stderr: result.stderr, error: result.error?.message }).toEqual({
    status: 0, stderr: expect.stringContaining('OK'), error: undefined,
  });
}, 25_000);
