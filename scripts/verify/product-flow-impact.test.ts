import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const modulePath = resolve(__dirname, 'product-flow.mjs');
const env = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), CI: '' });
const evaluate = (paths: readonly string[]) => spawnSync(process.execPath, ['--input-type=module', '-e',
  `import * as gate from ${JSON.stringify(modulePath)}; process.stdout.write(JSON.stringify(gate.impact(${JSON.stringify(paths)})));`],
{ encoding: 'utf8', env: env() });
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'fitsy-health-impact-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

test.each([
  [['apps/api/app/api/health/route.ts', 'apps/api/app/api/health/route.test.ts'], false, []],
  [['apps/api/app/api/health/route.ts', 'apps/api/app/api/health/other.ts'], true, ['changed-journey']],
  [['apps/api/app/api/healthcheck/route.ts'], true, ['changed-journey']],
  [['apps/api/app/api/health/route.ts', 'apps/api/app/api/search/route.ts'], true, ['discovery']],
  [['apps/api/app/api/health/route.test.ts', 'apps/mobile/lib/apiClient.ts'], true, ['changed-journey']],
  [['apps/api/app/api/health/route.ts', 'packages/shared/src/search.ts'], true, ['discovery']],
] as const)('health exemption retains impact for %j', (paths, required, categories) => {
  const result = evaluate(paths);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ required, categories });
});

test('actual product-flow CLI returns N/A for health-only diff and requires proof for mixed API diff', () => {
  mkdirSync(join(directory, 'scripts/verify'), { recursive: true });
  copyFileSync(modulePath, join(directory, 'scripts/verify/product-flow.mjs'));
  symlinkSync(resolve(__dirname, '../../node_modules'), join(directory, 'node_modules'));
  writeFileSync(join(directory, '.gitignore'), 'node_modules\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, env: env(), encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'CLI fixture');
  git('config', 'user.email', 'fixture@example.test');
  git('config', 'core.hooksPath', '/dev/null');
  git('add', '.'); git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const write = (path: string) => {
    const file = join(directory, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'export const GET = () => null;\n');
  };
  write('apps/api/app/api/health/route.ts');
  write('apps/api/app/api/health/route.test.ts');
  git('add', '.'); git('commit', '-qm', 'health-only');
  const cli = (...args: string[]) => spawnSync(process.execPath, ['scripts/verify/product-flow.mjs', ...args],
    { cwd: directory, env: env(), encoding: 'utf8' });
  const plan = cli('--plan');
  expect(plan.status).toBe(0);
  expect(JSON.parse(plan.stdout)).toMatchObject({ required: false, paths: [], categories: [] });
  const result = cli();
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'pass', applicability: 'not_applicable' });
  write('apps/api/app/api/search/route.ts');
  git('add', '.'); git('commit', '-qm', 'mixed-api');
  const mixed = cli('--plan');
  expect(mixed.status).toBe(0);
  expect(JSON.parse(mixed.stdout)).toMatchObject({ required: true, categories: ['discovery'] });
});
