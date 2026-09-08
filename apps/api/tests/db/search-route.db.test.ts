import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const testIfDb = process.env['POSTGRES_PRISMA_URL'] ? test : test.skip;
testIfDb('search route integration with real JWT and Postgres', () => {
  const output = execFileSync(process.execPath, [require.resolve('tsx/cli'),
    '--tsconfig', resolve(__dirname, '../../tsconfig.json'), '--test', '--test-reporter=tap',
    resolve(__dirname, 'search-route.integration.ts')], {
    encoding: 'utf8', timeout: 30_000, env: process.env,
  });
  // A successful process with an empty/disabled native suite is not evidence.
  expect(Number(output.match(/^# tests (\d+)$/m)?.[1])).toBeGreaterThanOrEqual(4);
  expect(output).toMatch(/^# fail 0$/m);
  expect(output).toMatch(/^# skipped 0$/m);
}, 35_000);
