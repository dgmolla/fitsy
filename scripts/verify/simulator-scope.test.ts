import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const modulePath = join(root, 'scripts/verify/impact-plan.mjs');
const allFlows = readdirSync(join(root, 'apps/mobile/e2e/flows')).filter(name => name.endsWith('.yaml'))
  .map(name => name.replace(/\.yaml$/, '')).sort();
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(GIT_|GITHUB_|FITSY_|EXPO_PUBLIC_|CI$)/.test(key)));
function select(files: string[] | null, options: object = {}) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {simulatorSelection} from ${JSON.stringify(modulePath)};
     process.stdout.write(JSON.stringify(simulatorSelection(${JSON.stringify(files)}, ${JSON.stringify(options)})));`],
  { encoding: 'utf8', env });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

test.each([
  ['docs/guide.md'], ['AGENTS.md'], ['apps/mobile/README.md'],
  ['scripts/verify/run.mjs'], ['apps/api/app/api/search/route.ts'],
  ['apps/api/app/api/health/route.ts'], ['apps/mobile/lib/menuFilters.test.ts'],
  ['.github/workflows/verify.yml'],
])('low simulator risk for %s retains no native work', path => {
  expect(select([path])).toMatchObject({ risk: 'low', scope: 'none', required: false, flows: [] });
});

test.each([
  ['apps/mobile/app/restaurant/[id].tsx', ['chain-menu-serving', 'menu-load-recovery', 'menu-macro-serving']],
  ['apps/mobile/lib/menuFilters.ts', ['chain-menu-serving', 'menu-load-recovery', 'menu-macro-serving']],
  ['apps/mobile/app/notification-settings.tsx', ['reminders']],
  ['apps/mobile/lib/notificationSchedule.ts', ['reminders']],
  ['apps/mobile/app/macro-setup.tsx', ['onboarding-assisted-targets', 'onboarding-target-ranked-search']],
  ['apps/mobile/lib/macroCalculator.ts', ['onboarding-assisted-targets', 'onboarding-target-ranked-search']],
  ['apps/mobile/e2e/flows/menu-load-recovery.yaml', ['menu-load-recovery']],
] as [string, string[]][])('medium change %s selects only mapped flows', (path, flows) => {
  expect(select([path])).toMatchObject({ risk: 'medium', scope: 'affected', required: true, flows });
});

test.each([
  'apps/mobile/app/_layout.tsx', 'apps/mobile/app/(tabs)/_layout.tsx',
  'apps/mobile/app/auth/login.tsx', 'apps/mobile/app/welcome/signin.tsx',
  'apps/mobile/app/welcome/payment.tsx', 'apps/mobile/components/PaywallView.tsx',
  'apps/mobile/lib/useEntitlementVerdict.ts', 'apps/mobile/lib/useOwnedHardwareBack.ts',
  'apps/mobile/lib/nativeIntent.ts', 'apps/mobile/lib/supabase.ts',
  'apps/mobile/lib/onboardingEntry.ts', 'apps/mobile/lib/onboardingResume.ts',
  'apps/mobile/lib/onboardingPreviewEntry.ts', 'apps/mobile/lib/pendingMealClaim.ts',
  'apps/mobile/lib/macroStorage.ts', 'apps/mobile/lib/menuBookmarks.ts',
  'apps/mobile/components/BookmarkButton.tsx', 'apps/mobile/components/OnboardingAccountSummary.tsx',
  'apps/mobile/components/PreviewRestaurantCard.tsx',
  'apps/mobile/app.config.ts', 'apps/mobile/eas.json', 'apps/mobile/package.json',
  'apps/mobile/ios/Fitsy/AppDelegate.swift', 'apps/mobile/android/app/build.gradle',
  'apps/api/lib/auth.ts', 'apps/api/app/api/revenuecat/webhook/route.ts',
  'prisma/schema.prisma', 'package-lock.json',
  'scripts/deploy/mobile.sh', '.github/workflows/deploy.yml',
  'apps/mobile/components/NewUnmappedScreen.tsx',
])('high change %s selects every flow', path => {
  expect(select([path])).toMatchObject({ risk: 'high', scope: 'full', required: true, flows: allFlows });
});

test('multiple affected areas union and deduplicate flows independently of path order', () => {
  const paths = ['apps/mobile/lib/menuFilters.ts', 'apps/mobile/app/notification-settings.tsx',
    'apps/mobile/app/restaurant/[id].tsx', 'docs/guide.md'];
  const expected = ['chain-menu-serving', 'menu-load-recovery', 'menu-macro-serving', 'reminders'];
  expect(select(paths).flows).toEqual(expected);
  expect(select(paths.reverse()).flows).toEqual(expected);
});

test.each([{ labels: [] }, { labels: ['needs-simulator'] }, { labels: ['Needs-Sim'] }])('only the exact needs-sim label overrides low risk: %j', ({ labels }) => {
  expect(select(['docs/guide.md'], { labels }).scope).toBe('none');
});

test.each([[], ['docs/guide.md'], ['scripts/example.ts'], ['apps/mobile/lib/menuFilters.test.ts']].map(paths => ({ paths })))(
  'needs-sim forces flows for %j', ({ paths }) => {
    const result = select(paths, { labels: ['needs-sim'] });
    expect(result).toMatchObject({ required: true, scope: 'full', flows: allFlows });
    expect(result.reason).toContain('needs-sim');
  });

test('needs-sim preserves an affected selection and cannot reduce a high selection', () => {
  expect(select(['apps/mobile/lib/menuFilters.ts'], { labels: ['needs-sim'] }).scope).toBe('affected');
  expect(select(['apps/mobile/lib/authClient.ts'], { labels: ['needs-sim'] }).flows).toEqual(allFlows);
});

test.each([null, ['apps/mobile/app/welcome/goal.tsx', '.github/workflows/verify.yml']].map(files => ({ files })))(
  'unknown history or a higher canonical review tier selects all flows: %j', ({ files }) => {
    expect(select(files)).toMatchObject({ risk: 'high', scope: 'full', flows: allFlows });
  });

test('release candidates run the full set even without a mobile diff', () => {
  expect(select(['docs/guide.md'], { release: true })).toMatchObject({ risk: 'high', scope: 'full', flows: allFlows });
});

test('release planning flag and tag events force all flows through the actual CLI', () => {
  const base = fixture(); write('docs/release.md', 'Release notes.\n'); const head = commit();
  for (const options of [{ args: ['--release-candidate'], extra: {} },
    { args: [], extra: { GITHUB_REF_TYPE: 'tag' } }]) {
    const result = spawnSync(process.execPath, ['scripts/verify/impact-plan.mjs', '--simulator', ...options.args], {
      cwd: directory, env: { ...env, CI: 'true', FITSY_DIFF_BASE: base, FITSY_DIFF_HEAD: head, ...options.extra }, encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ risk: 'high', scope: 'full', flows: allFlows });
  }
});

test('every selected flow exists and a mixed mobile diff cannot lose unmapped coverage', () => {
  const result = select(['apps/mobile/lib/menuFilters.ts', 'apps/mobile/components/NewScreen.tsx']);
  expect(result.scope).toBe('full');
  expect(result.flows.every((name: string) => allFlows.includes(name))).toBe(true);
});

let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'fitsy-simulator-scope-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
const write = (path: string, value: string) => {
  mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), value);
};
const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, env, encoding: 'utf8' }).trim();
const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
function fixture() {
  for (const path of ['scripts/verify/impact-plan.mjs', 'scripts/verify/risk-tiers.yml', 'scripts/review/tier.mjs',
    ...allFlows.map(name => `apps/mobile/e2e/flows/${name}.yaml`)]) {
    mkdirSync(dirname(join(directory, path)), { recursive: true }); copyFileSync(join(root, path), join(directory, path));
  }
  write('.gitignore', '.evidence/\n');
  git('init', '-q'); git('config', 'user.name', 'Scope fixture'); git('config', 'user.email', 'scope@example.test');
  git('config', 'core.hooksPath', '/dev/null');
  const base = commit(); git('update-ref', 'refs/remotes/origin/main', base);
  return base;
}

test('actual classify CLI prints its reason, exports selection, and consumes the PR label event', () => {
  const base = fixture(); write('docs/guide.md', 'Docs.\n'); const head = commit();
  write('.evidence/event.json', JSON.stringify({ pull_request: {
    base: { sha: base }, head: { sha: head }, labels: [{ name: 'needs-sim' }],
  } }));
  const output = join(directory, '.evidence/github-output');
  const result = spawnSync(process.execPath, ['scripts/verify/impact-plan.mjs', '--github-output'], {
    cwd: directory, env: { ...env, CI: 'true', GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: join(directory, '.evidence/event.json'), GITHUB_OUTPUT: output }, encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).simulator).toMatchObject({ scope: 'full', flows: allFlows });
  expect(JSON.parse(result.stdout)).toMatchObject({ code: false, tests: false, build: true });
  expect(result.stderr).toMatch(/Simulator scope: full.*needs-sim/);
  expect(readFileSync(output, 'utf8')).toContain('simulator=true\n');
  expect(readFileSync(output, 'utf8')).toContain('sim_scope=full\n');
  expect(readFileSync(output, 'utf8')).toContain(`sim_flows=${JSON.stringify(allFlows)}\n`);
});

test('a missing review classifier or flow mapping fails conservatively to the full set', () => {
  fixture(); rmSync(join(directory, 'scripts/review/tier.mjs'));
  expect(select(['apps/mobile/lib/menuFilters.ts'], { cwd: directory })).toMatchObject({ scope: 'full', risk: 'high' });
});

test('unreadable event context cannot silently discard needs-sim when the comparison is already pinned', () => {
  const base = fixture(); write('docs/guide.md', 'Docs.\n'); const head = commit();
  write('.evidence/event.json', '{malformed');
  const result = spawnSync(process.execPath, ['scripts/verify/impact-plan.mjs', '--simulator'], {
    cwd: directory, env: { ...env, CI: 'true', FITSY_DIFF_BASE: base, FITSY_DIFF_HEAD: head,
      GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: join(directory, '.evidence/event.json') }, encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ required: true, scope: 'full', reason: expect.stringContaining('Event context unavailable') });
});

test('verification modules import safely from stdin without executing their CLIs', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    input: `import ${JSON.stringify(modulePath)}; import ${JSON.stringify(join(root, 'scripts/verify/run.mjs'))};`,
    env, encoding: 'utf8',
  });
  expect(result.status).toBe(0); expect(result.stdout).toBe(''); expect(result.stderr).toBe('');
});

const yaml = require('js-yaml') as { load(text: string): unknown };
type Step = { name?: string; run?: string; if?: string };
const workflowText = readFileSync(join(root, '.github/workflows/verify.yml'), 'utf8');
const workflow = yaml.load(workflowText) as { on: { pull_request: { types: string[] } };
  jobs: Record<string, { if?: string; 'runs-on'?: string; steps: Step[] }> };
function expression(text: string, context: object) {
  // Evaluate the actual restricted GitHub boolean expressions, not a copy of
  // their branching logic. Inputs are repository YAML and fixture data only.
  return Function('needs', 'always', `return (${text.replace(/^\$\{\{\s*|\s*\}\}$/g, '')});`)(context, () => true);
}
test.each([
  { path: 'docs/guide.md', label: false, staticResult: 'skipped', expected: false, host: 'ubuntu-latest' },
  { path: 'docs/guide.md', label: true, staticResult: 'skipped', expected: true, host: 'macos-15' },
  { path: 'apps/mobile/lib/menuFilters.ts', label: false, staticResult: 'success', expected: true, host: 'macos-15' },
  { path: 'apps/mobile/lib/authClient.ts', label: false, staticResult: 'success', expected: true, host: 'macos-15' },
  { path: 'scripts/example.ts', label: false, staticResult: 'success', expected: true, host: 'ubuntu-latest' },
  { path: 'apps/mobile/lib/menuFilters.ts', label: false, staticResult: 'failure', expected: false, host: 'macos-15' },
  { path: 'apps/mobile/lib/menuFilters.ts', label: true, staticResult: 'cancelled', expected: false, host: 'macos-15' },
])('actual classifier routes $path (needs-sim=$label, static=$staticResult) through the existing build job', entry => {
  const base = fixture(); write(entry.path, 'Changed fixture.\n'); const head = commit();
  write('.evidence/event.json', JSON.stringify({ pull_request: {
    base: { sha: base }, head: { sha: head }, labels: entry.label ? [{ name: 'needs-sim' }] : [],
  } }));
  const output = join(directory, '.evidence/github-output');
  const classify = workflow.jobs.classify!.steps.find(step => step.run?.includes('impact-plan.mjs'))!.run!;
  const result = spawnSync('bash', ['-e', '-c', classify], { cwd: directory, env: { ...env, CI: 'true',
    GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: join(directory, '.evidence/event.json'), GITHUB_OUTPUT: output }, encoding: 'utf8' });
  expect(result.status).toBe(0);
  const outputs = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => {
    const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
  }));
  const needs = { classify: { result: 'success', outputs }, static: { result: entry.staticResult } };
  const build = workflow.jobs.build!;
  expect(expression(build.if!, needs)).toBe(entry.expected);
  expect(expression(build['runs-on']!, needs)).toBe(entry.host);
  expect(expression(build.steps.find(step => step.name === 'Run selected simulator flows')!.if!, needs))
    .toBe(outputs.simulator === 'true');
  expect(JSON.parse(outputs.sim_flows!).length > 0).toBe(outputs.simulator === 'true');
  // A classification failure must stop both build and native work.
  expect(expression(build.if!, { ...needs, classify: { ...needs.classify, result: 'failure' } })).toBe(false);
});

test('label additions and removals rerun classification, and the final Verify job is byte-for-byte unchanged', () => {
  expect(workflow.on.pull_request.types).toEqual(expect.arrayContaining(['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled']));
  const original = execFileSync('git', ['show', 'HEAD:.github/workflows/verify.yml'], { cwd: root, env, encoding: 'utf8' });
  expect(workflowText.split('\n  verify:\n')[1]).toBe(original.split('\n  verify:\n')[1]);
});

test.each([false, true])('registry caller skips low scope and fails required misconfigured execution (required=%s)', required => {
  const base = fixture();
  for (const path of ['scripts/verify/run.mjs', 'scripts/verify/mobile-e2e.sh', 'scripts/verify/product-flow.mjs'])
    copyFileSync(join(root, path), join(directory, path));
  cpSync(join(root, 'scripts/sim'), join(directory, 'scripts/sim'), { recursive: true });
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'));
  const registry = readFileSync(join(root, 'scripts/verify/registry.yml'), 'utf8').split('  - name: mobile-e2e\n')[1]!.split('\n  - name:')[0];
  write('scripts/verify/registry.yml', 'checks:\n  - name: mobile-e2e\n' + registry);
  write('docs/guide.md', 'Docs.\n'); const head = commit();
  write('.evidence/event.json', JSON.stringify({ pull_request: {
    base: { sha: base }, head: { sha: head }, labels: required ? [{ name: 'needs-sim' }] : [],
  } }));
  // External native tools must remain untouched in both the skipped branch and
  // the dev-environment preflight failure. The real runner/check are executed.
  write('bin/xcrun', '#!/bin/sh\ntouch .evidence/native-called\nexit 99\n');
  chmodSync(join(directory, 'bin/xcrun'), 0o755);
  const result = spawnSync(process.execPath, ['scripts/verify/run.mjs', '--only=mobile-e2e', '--runs=ci', '--scope=changed'], {
    cwd: directory, env: { ...env, CI: 'true', PATH: `${join(directory, 'bin')}:${env.PATH}`,
      GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: join(directory, '.evidence/event.json') }, encoding: 'utf8', timeout: 10000,
  });
  expect(result.status).toBe(required ? 1 : 0);
  expect(JSON.parse(result.stdout.trim())).toMatchObject({ name: 'mobile-e2e', blocking: true, status: required ? 'fail' : 'skipped' });
  expect(result.stderr).toContain('Simulator scope:');
  expect(existsSync(join(directory, '.evidence/native-called'))).toBe(false);
});
