import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const testIfDb = process.env['POSTGRES_PRISMA_URL'] ? test : test.skip;
testIfDb('search route integration with real JWT and Postgres', () => {
  let output: string;
  try { output = execFileSync(process.execPath, [require.resolve('tsx/cli'),
    '--tsconfig', resolve(__dirname, '../../tsconfig.json'), '--test', '--test-reporter=tap',
    resolve(__dirname, 'search-route.integration.ts')], {
    encoding: 'utf8', timeout: 30_000, env: process.env,
  }); } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    throw new Error(`Native route tests failed:\n${e.stdout ?? ''}\n${e.stderr ?? ''}`);
  }
  // A successful process with an empty/disabled native suite is not evidence.
  expect(Number(output.match(/^# tests (\d+)$/m)?.[1])).toBe(13);
  expect(output).toMatch(/^# fail 0$/m);
  expect(output).toMatch(/^# skipped 0$/m);
}, 35_000);
