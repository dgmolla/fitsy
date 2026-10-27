import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repository = resolve(__dirname, '../..');
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'fitsy-auth-tools-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

test('the real generator defaults to mandatory auth, propagates subscription failures and refuses public data', () => {
  mkdirSync(join(directory, 'scripts/gen'), { recursive: true });
  const script = join(directory, 'scripts/gen/route.sh');
  copyFileSync(join(repository, 'scripts/gen/route.sh'), script);
  for (const [path, args] of [['user-data', []], ['paid-data', ['--auth=subscriber']]] as const) {
    const result = spawnSync('bash', [script, path, ...args], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    const source = readFileSync(join(directory, `apps/api/app/api/${path}/route.ts`), 'utf8');
    expect(source).toContain(path === 'user-data' ? 'await requireAuth(request)' : 'await optionalSubscription(request)');
    expect(source).toMatch(/instanceof NextResponse\) return/);
  }
  const rejected = spawnSync('bash', [script, 'public-data', '--auth=public'], { encoding: 'utf8' });
  expect(rejected.status).toBe(1);
  expect(rejected.stderr).toContain('Only health');
});

test.each([false, true])('deployed smoke fails for public restaurant JSON: %s', exposed => {
  const curl = join(directory, 'curl');
  writeFileSync(curl, `#!/bin/bash
case "$*" in
  *api/health*) printf 200 ;;
  *api/restaurants*) printf ${exposed ? '200' : '401'} ;;
  *) printf 401 ;;
esac
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${directory}:${process.env['PATH']}`, PROD_SMOKE_EMAIL: '', PROD_SMOKE_PASSWORD: '' };
  const result = spawnSync('bash', [join(repository, 'scripts/verify/api-e2e.sh'), '--base=http://localhost:3000'], { env, encoding: 'utf8' });
  expect(result.status).toBe(exposed ? 1 : 0);
  expect(JSON.parse(result.stdout).status).toBe(exposed ? 'fail' : 'pass');
  expect(result.stderr).toContain('unauth restaurants/preview');
  expect(result.stderr).toContain('invalid-session search');
});
