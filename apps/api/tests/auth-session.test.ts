import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('Supabase session verification with real ES256 signatures and claims', () => {
  const output = execFileSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap',
    resolve(__dirname, 'auth-session.integration.ts')], {
    encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, TSX_TSCONFIG_PATH: resolve(__dirname, '../tsconfig.json') },
  });
  expect(output).toMatch(/^# tests 2$/m);
  expect(output).toMatch(/^# fail 0$/m);
  expect(output).toMatch(/^# skipped 0$/m);
});
