import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('quota enforcement through independent API worker processes and external transport fixtures', () => {
  const output = execFileSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap',
    resolve(__dirname, 'rateLimit.integration.ts')], {
    env: { ...process.env, FITSY_TEST_REAL_REDIS: '0', TSX_TSCONFIG_PATH: resolve(__dirname, '../tsconfig.json') },
    encoding: 'utf8', timeout: 30_000,
  });
  expect(output).toContain('# tests 6');
  expect(output).toContain('# fail 0');
});
