import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const testIfDb = process.env['POSTGRES_PRISMA_URL'] ? test : test.skip;
testIfDb('search route integration with real JWT and Postgres', () => {
  expect(() => execFileSync(process.execPath, [require.resolve('tsx/cli'),
    '--tsconfig', resolve(__dirname, '../../tsconfig.json'), '--test',
    resolve(__dirname, 'search-route.integration.ts')], {
    encoding: 'utf8', timeout: 30_000, env: process.env,
  })).not.toThrow();
}, 35_000);
