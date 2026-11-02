import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('GitHub simulator workflow and runtime behavior', () => {
  const result = spawnSync(process.execPath, ['--test', resolve(__dirname, 'actions.test.mjs')], { encoding: 'utf8', timeout: 60000 });
  expect({ status: result.status, output: result.status === 0 ? '' : result.stdout + result.stderr }).toEqual({ status: 0, output: '' });
}, 65000);
