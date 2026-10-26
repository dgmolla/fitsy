import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyProductFlowControls } from './product-flow-fixture';

const modulePath = resolve(__dirname, 'product-flow.mjs');
const env = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(GIT_|GITHUB_|FITSY_|EXPO_PUBLIC_|CI$)/.test(key))), CI: '' });
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

test.each([
  ['apps/mobile/app/notification-settings.tsx', ['reminders'], ['notifications']],
  ['apps/mobile/app/(tabs)/saved.tsx', ['log-meal'], ['discovery']],
  ['apps/api/app/api/restaurants/[id]/menu/route.ts', ['chain-menu-serving', 'log-meal', 'menu-load-recovery', 'menu-macro-serving', 'paywall-access', 'shuffle'], ['billing', 'discovery']],
  ['apps/mobile/lib/shuffle.ts', ['shuffle'], ['billing', 'changed-journey', 'discovery']],
  ['apps/mobile/lib/useShuffleFlag.ts', ['shuffle'], ['billing', 'changed-journey', 'discovery']],
])('local, final-run and publication callers share affected journeys for %s', (path, flows, categories) => {
  copyProductFlowControls(directory);
  symlinkSync(resolve(__dirname, '../../node_modules'), join(directory, 'node_modules'));
  writeFileSync(join(directory, '.gitignore'), 'node_modules\n.evidence/\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, env: env() });
  git('init', '-q'); git('config', 'user.name', 'Affected caller fixture'); git('config', 'user.email', 'fixture@example.test');
  git('config', 'core.hooksPath', '/dev/null'); git('add', '.'); git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  mkdirSync(dirname(join(directory, path as string)), { recursive: true });
  writeFileSync(join(directory, path as string), 'export const changed = true;\n');
  const local = spawnSync(process.execPath, ['scripts/verify/impact-plan.mjs', '--simulator'],
    { cwd: directory, env: env(), encoding: 'utf8' });
  const final = spawnSync(process.execPath, ['scripts/verify/product-flow.mjs', '--plan'],
    { cwd: directory, env: env(), encoding: 'utf8' });
  expect({ local: local.status, final: final.status }).toEqual({ local: 0, final: 0 });
  const plan = JSON.parse(final.stdout);
  expect(plan).toMatchObject({ required: true, flows, categories, baseline: [] });
  expect(plan.simulator).toEqual(JSON.parse(local.stdout));
  const publisher = resolve(__dirname, '../sim/publish-product-flow.mjs');
  const published = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {publicationPlan} from ${JSON.stringify(publisher)};
     import {selectedFlows} from ${JSON.stringify(modulePath)};
     const plan=publicationPlan(${JSON.stringify(join(directory, '.evidence/product-flow'))}, ${JSON.stringify(join(directory, '.evidence/product-build/receipt.json'))}, ${JSON.stringify([path])}, {configHash:'unchanged'});
     process.stdout.write(JSON.stringify({plan,run:selectedFlows(plan)}));`],
  { cwd: directory, env: { ...env(), FITSY_PRODUCT_ROOT: directory }, encoding: 'utf8' });
  expect({ status: published.status, stderr: published.stderr }).toEqual({ status: 0, stderr: '' });
  expect(JSON.parse(published.stdout)).toMatchObject({ plan: { flows, categories, baseline: [] }, run: flows });
});

test('the canonical CLI selects billing, reminder and onboarding acceptance for a shared trial policy change', () => {
  mkdirSync(join(directory, 'scripts/verify'), { recursive: true });
  copyProductFlowControls(directory);
  symlinkSync(resolve(__dirname, '../../node_modules'), join(directory, 'node_modules'));
  writeFileSync(join(directory, '.gitignore'), 'node_modules\n');
  const policy = 'packages/shared/src/contracts/trialPolicy.ts';
  mkdirSync(dirname(join(directory, policy)), { recursive: true });
  writeFileSync(join(directory, policy), 'export const reminderLeadHours = 30;\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, env: env(), encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'CLI fixture');
  git('config', 'user.email', 'fixture@example.test');
  git('config', 'core.hooksPath', '/dev/null');
  git('add', '.'); git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  writeFileSync(join(directory, policy), 'export const reminderLeadHours = 48;\n');
  const plan = spawnSync(process.execPath, ['scripts/verify/product-flow.mjs', '--plan'],
    { cwd: directory, env: env(), encoding: 'utf8' });
  expect(plan.status).toBe(0);
  expect(JSON.parse(plan.stdout)).toMatchObject({ required: true, paths: [policy],
    categories: ['billing', 'discovery', 'notifications', 'onboarding'],
    baseline: ['cold-start-welcome', 'signin-options'] });
});

test('actual product-flow CLI returns N/A for health-only diff and requires proof for mixed API diff', () => {
  mkdirSync(join(directory, 'scripts/verify'), { recursive: true });
  copyProductFlowControls(directory);
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
  const forged = spawnSync(process.execPath, ['scripts/verify/product-flow.mjs'], {
    cwd: directory, encoding: 'utf8', env: { ...env(), FITSY_DIFF_BASE: 'HEAD', FITSY_DIFF_HEAD: 'HEAD' } });
  expect(forged.status).toBe(1);
  expect(JSON.parse(forged.stdout)).toMatchObject({ status: 'fail' });
  const originalBase = git('rev-parse', 'origin/main');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const hosted = spawnSync(process.execPath, ['scripts/verify/product-flow.mjs', '--plan'], {
    cwd: directory, encoding: 'utf8', env: { ...env(), CI: 'true', FITSY_DIFF_BASE: originalBase } });
  expect(hosted.status).toBe(0);
  expect(JSON.parse(hosted.stdout)).toMatchObject({ required: true, categories: ['discovery'] });
});

test('the canonical product-flow check excludes verification scripts while preserving runtime and ambiguous manifest impact', () => {
  mkdirSync(join(directory, 'scripts/verify'), { recursive: true });
  mkdirSync(join(directory, 'apps/api'), { recursive: true });
  copyProductFlowControls(directory);
  copyFileSync(join(__dirname, 'product-flow.sh'), join(directory, 'scripts/verify/product-flow.sh'));
  symlinkSync(resolve(__dirname, '../../node_modules'), join(directory, 'node_modules'));
  writeFileSync(join(directory, '.gitignore'), 'node_modules\n.evidence/\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, env: env(), encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'CLI fixture');
  git('config', 'user.email', 'fixture@example.test');
  git('config', 'core.hooksPath', '/dev/null');
  const manifest = join(directory, 'apps/api/package.json');
  const baseline = {
    name: '@fitsy/api', scripts: {
      dev: 'next dev --turbopack', build: 'prisma generate && next build', start: 'next start',
      test: 'jest', 'test:coverage': 'jest --coverage',
    }, dependencies: { next: '^15.0.0' },
  };
  const write = (value: unknown) => writeFileSync(manifest, JSON.stringify(value));
  const plan = () => spawnSync(process.execPath, ['scripts/verify/product-flow.mjs', '--plan'],
    { cwd: directory, env: env(), encoding: 'utf8' });
  const check = () => spawnSync('bash', ['scripts/verify/product-flow.sh'],
    { cwd: directory, env: env(), encoding: 'utf8' });
  write(baseline);
  git('add', '.'); git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const gcOnly = { ...baseline, scripts: { ...baseline.scripts,
    'test:coverage:gc': 'node --expose-gc ../../node_modules/jest/bin/jest.js --coverage' } };
  write(gcOnly);
  expect(JSON.parse(plan().stdout)).toMatchObject({ required: false, paths: [] });
  expect(JSON.parse(check().stdout)).toMatchObject({ status: 'pass', applicability: 'not_applicable' });
  const hosted = spawnSync(process.execPath, ['scripts/verify/product-flow.mjs', '--plan'],
    { cwd: directory, env: { ...env(), CI: 'true', FITSY_DIFF_BASE: git('rev-parse', 'origin/main') }, encoding: 'utf8' });
  expect(JSON.parse(hosted.stdout)).toMatchObject({ required: false, paths: [] });
  writeFileSync(manifest, JSON.stringify(gcOnly).replace('"start":"next start"',
    '"start":"node changed","start":"next start"'));
  const ambiguousCurrentPlan = plan();
  expect(ambiguousCurrentPlan.status).toBe(0);
  expect(JSON.parse(ambiguousCurrentPlan.stdout)).toMatchObject({ required: true, paths: ['apps/api/package.json'] });
  const ambiguousCurrentCheck = check();
  expect(ambiguousCurrentCheck.status).toBe(1);
  expect(JSON.parse(ambiguousCurrentCheck.stdout)).toMatchObject({ status: 'fail' });
  write(gcOnly);
  const mobileChange = join(directory, 'apps/mobile/app/welcome/entry.tsx');
  mkdirSync(dirname(mobileChange), { recursive: true });
  writeFileSync(mobileChange, 'export const copy = "Changed";');
  expect(JSON.parse(plan().stdout)).toMatchObject({ required: true, paths: ['apps/mobile/app/welcome/entry.tsx'] });
  rmSync(mobileChange);
  for (const changed of [
    { ...gcOnly, scripts: { ...gcOnly.scripts, start: 'node server.js' } },
    { ...gcOnly, scripts: { ...gcOnly.scripts, prestart: 'node setup.js' } },
    { ...gcOnly, dependencies: { next: '^16.0.0' } },
  ]) {
    write(changed);
    expect(JSON.parse(plan().stdout)).toMatchObject({ required: true, paths: ['apps/api/package.json'] });
    expect(JSON.parse(check().stdout)).toMatchObject({ status: 'fail' });
  }
  write({ ...baseline, scripts: { ...baseline.scripts, 'test:coverage:gc': 'node other.js' } });
  expect(JSON.parse(plan().stdout)).toMatchObject({ required: false, paths: [] });
  expect(JSON.parse(check().stdout)).toMatchObject({ status: 'pass', applicability: 'not_applicable' });
  writeFileSync(manifest, '{malformed');
  expect(JSON.parse(plan().stdout)).toMatchObject({ required: true, paths: ['apps/api/package.json'] });
  expect(JSON.parse(check().stdout)).toMatchObject({ status: 'fail' });
  git('add', '.'); git('commit', '-qm', 'malformed-base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(gcOnly);
  expect(JSON.parse(plan().stdout)).toMatchObject({ required: true, paths: ['apps/api/package.json'] });
  writeFileSync(manifest, JSON.stringify(baseline).replace('"dependencies":{"next":"^15.0.0"}',
    '"dependencies":{"next":"^16.0.0"},"dependencies":{"next":"^15.0.0"}'));
  git('add', 'apps/api/package.json'); git('commit', '-qm', 'ambiguous-base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(gcOnly);
  const ambiguousBasePlan = plan();
  expect(ambiguousBasePlan.status).toBe(0);
  expect(JSON.parse(ambiguousBasePlan.stdout)).toMatchObject({ required: true, paths: ['apps/api/package.json'] });
  const ambiguousBaseCheck = check();
  expect(ambiguousBaseCheck.status).toBe(1);
  expect(JSON.parse(ambiguousBaseCheck.stdout)).toMatchObject({ status: 'fail' });
});
