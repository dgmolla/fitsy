import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const testIfDb = process.env['POSTGRES_PRISMA_URL'] ? test : test.skip;
testIfDb('Shuffle route with real JWT, subscriptions and PostgreSQL', () => {
  // Refuse to mutate a caller database outside the existing owned launcher.
  execFileSync(process.execPath, [resolve(__dirname, '../../../../scripts/verify/local-db.mjs'), '--assert-owned-db'], {
    env: process.env, stdio: 'pipe', timeout: 60_000,
  });
  let output: string;
  try {
    output = execFileSync(process.execPath, [require.resolve('tsx/cli'),
      '--tsconfig', resolve(__dirname, '../../tsconfig.json'), '--test', '--test-reporter=tap',
      resolve(__dirname, 'shuffle-route.integration.ts')], {
      env: process.env, encoding: 'utf8', timeout: 45_000,
    });
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    throw Error(`Shuffle route acceptance failed:\n${e.stdout ?? ''}\n${e.stderr ?? ''}`);
  }
  expect(Number(output.match(/^# tests (\d+)$/m)?.[1])).toBe(12);
  expect(output).toMatch(/^# fail 0$/m);
  expect(output).toMatch(/^# skipped 0$/m);
}, 65_000);
