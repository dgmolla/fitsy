import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('production security boundaries through real request handlers', () => {
  const output = execFileSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap',
    resolve(__dirname, 'security-boundaries.integration.ts')], {
      env: { ...process.env, POSTGRES_PRISMA_URL: undefined, POSTGRES_URL_NON_POOLING: undefined,
        TSX_TSCONFIG_PATH: resolve(__dirname, '../tsconfig.json') },
    encoding: 'utf8', timeout: 30_000,
  });
  expect(output).toContain('# fail 0');
});
