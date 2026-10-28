import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  ['scripts/verify/run.mjs'],
  ['apps/api/jest.config.js'],
  ['apps/api/app/api/health/route.ts'], ['apps/mobile/lib/menuFilters.test.ts'],
  ['.github/workflows/verify.yml'],
  ['apps/web/lib/cache.ts'], ['apps/web/app/api/health/route.ts'],
  ['apps/mobile/components/test-fixtures/accountProfile.ts'],
])('low simulator risk for %s retains no native work', path => {
  expect(select([path])).toMatchObject({ risk: 'low', scope: 'none', required: false, flows: [] });
});

test.each([
  ['apps/mobile/app/restaurant/[id].tsx', ['chain-menu-serving', 'log-meal', 'menu-load-recovery', 'menu-macro-serving', 'shuffle']],
  ['apps/mobile/lib/menuFilters.ts', ['chain-menu-serving', 'log-meal', 'menu-load-recovery', 'menu-macro-serving', 'shuffle']],
  ['apps/api/lib/shuffleSearch.ts', ['shuffle']],
  ['apps/mobile/lib/useShuffleFlag.ts', ['shuffle']],
  ['apps/mobile/e2e/flows/shuffle.yaml', ['shuffle']],
  ['apps/mobile/e2e/helpers/shuffle-subscriber.mjs', ['shuffle']],
  ['apps/mobile/app/notification-settings.tsx', ['reminders']],
  ['apps/mobile/lib/notificationSchedule.ts', ['reminders']],
  ['apps/mobile/app/macro-setup.tsx', ['onboarding-assisted-targets']],
  ['apps/mobile/lib/macroCalculator.ts', ['meal-target-energy-sync', 'onboarding-assisted-targets', 'onboarding-target-ranked-search']],
  ['apps/mobile/app/(tabs)/saved.tsx', ['log-meal']],
  ['apps/mobile/lib/menuBookmarks.ts', ['log-meal']],
  ['apps/mobile/e2e/flows/menu-load-recovery.yaml', ['menu-load-recovery']],
  ['apps/mobile/e2e/flows/signin-options.yaml', ['signin-options']],
  ['apps/api/app/api/search/route.ts', ['meal-target-energy-sync', 'menu-load-recovery', 'onboarding-assisted-targets', 'onboarding-guided-preview', 'onboarding-out-of-area', 'onboarding-search-highlight', 'onboarding-target-ranked-search']],
] as [string, string[]][])('medium change %s selects only mapped flows', (path, flows) => {
  expect(select([path])).toMatchObject({ risk: 'medium', scope: 'flow', required: true, flows });
});

test.each([
  'apps/mobile/app/_layout.tsx', 'apps/mobile/app/(tabs)/_layout.tsx',
  'apps/mobile/app/auth/login.tsx', 'apps/mobile/app/welcome/signin.tsx',
  'apps/mobile/app/welcome/payment.tsx', 'apps/mobile/components/PaywallView.tsx',
  'apps/mobile/lib/useEntitlementVerdict.ts', 'apps/mobile/lib/useOwnedHardwareBack.ts',
  'apps/mobile/lib/nativeIntent.ts', 'apps/mobile/lib/supabase.ts',
  'apps/mobile/lib/onboardingEntry.ts', 'apps/mobile/lib/onboardingResume.ts',
  'apps/mobile/lib/onboardingPreviewEntry.ts', 'apps/mobile/lib/pendingMealClaim.ts',
  'apps/mobile/lib/macroStorage.ts',
  'apps/mobile/components/BookmarkButton.tsx', 'apps/mobile/components/OnboardingAccountSummary.tsx',
  'apps/mobile/components/PreviewRestaurantCard.tsx',
  'apps/mobile/components/ShuffleButton.tsx',
  'apps/mobile/app.config.ts', 'apps/mobile/eas.json', 'apps/mobile/package.json',
  'apps/mobile/ios/Fitsy/AppDelegate.swift', 'apps/mobile/android/app/build.gradle',
  'apps/api/lib/auth.ts', 'apps/api/app/api/revenuecat/webhook/route.ts',
  'apps/api/next.config.ts',
  'prisma/schema.prisma', 'package-lock.json',
  'scripts/deploy/mobile.sh', '.github/workflows/deploy.yml',
  'apps/mobile/components/NewUnmappedScreen.tsx',
  'apps/mobile/assets/icon.png', 'apps/mobile/lib/colors.ts',
  'apps/web/public/logo.png', 'apps/web/src/components/Logo.styles.ts',
  'apps/web/app/page.mdx', 'apps/web/app/page.jsx',
])('high change %s selects every flow', path => {
  expect(select([path])).toMatchObject({ risk: 'high', scope: 'full', required: true, flows: allFlows });
});

test('multiple affected areas union and deduplicate flows independently of path order', () => {
  const paths = ['apps/mobile/lib/menuFilters.ts', 'apps/mobile/app/notification-settings.tsx',
    'apps/mobile/app/restaurant/[id].tsx', 'docs/guide.md'];
  const expected = ['chain-menu-serving', 'log-meal', 'menu-load-recovery', 'menu-macro-serving', 'reminders', 'shuffle'];
  expect(select(paths).flows).toEqual(expected);
  expect(select(paths.reverse()).flows).toEqual(expected);
});

test('an unmapped backend contract cannot disappear from a mixed mapped selection', () => {
  expect(select(['apps/mobile/lib/menuFilters.ts', 'apps/api/lib/newContract.ts'])).toMatchObject({ scope: 'full', flows: allFlows });
});

test('affected selections explain each omitted journey without adding unrelated baselines', () => {
  const result = select(['apps/mobile/app/notification-settings.tsx']);
  expect(result.flows).toEqual(['reminders']);
  expect(result.omitted).toEqual(allFlows.filter(name => name !== 'reminders').map(flow => ({
    flow, reason: expect.stringMatching(/unaffected/i),
  })));
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
  expect(select(['apps/mobile/lib/menuFilters.ts'], { labels: ['needs-sim'] }).scope).toBe('flow');
  expect(select(['apps/mobile/lib/authClient.ts'], { labels: ['needs-sim'] }).flows).toEqual(allFlows);
});

test.each([null, ['apps/mobile/app/welcome/goal.tsx', '.github/workflows/verify.yml']].map(files => ({ files })))(
  'unknown history or a higher canonical review tier selects all flows: %j', ({ files }) => {
    expect(select(files)).toMatchObject({ risk: 'high', scope: 'full', flows: allFlows });
  });

test('release candidates run the full set even without a mobile diff', () => {
  expect(select(['docs/guide.md'], { release: true })).toMatchObject({ risk: 'high', scope: 'full', flows: allFlows });
  expect(allFlows).toEqual(expect.arrayContaining(['signin-options', 'paywall-access', 'onboarding-guided-preview', 'log-meal']));
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
  for (const path of ['scripts/verify/impact-plan.mjs', 'scripts/verify/risk-tiers.yml', 'scripts/route-reviewers.sh', 'scripts/sim/ci.mjs', 'scripts/sim/journey-fixtures.mjs', 'scripts/sim/slack-video.mjs', 'scripts/sim/backend-identity.mjs',
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
  expect(JSON.parse(result.stdout)).toMatchObject({ code: false, tests: false, build: false });
  expect(result.stderr).toMatch(/Simulator scope: full.*needs-sim/);
  expect(readFileSync(output, 'utf8')).toContain('simulator=true\n');
  expect(readFileSync(output, 'utf8')).toContain('sim_scope=full\n');
  expect(readFileSync(output, 'utf8')).toContain(`sim_flows=${JSON.stringify(allFlows)}\n`);
});

test.each(['scripts/route-reviewers.sh', 'scripts/verify/risk-tiers.yml'])(
  'a missing supported routing input %s fails conservatively to the full set', path => {
  fixture(); rmSync(join(directory, path));
  expect(select(['apps/mobile/lib/menuFilters.ts'], { cwd: directory })).toMatchObject({ scope: 'full', risk: 'high' });
});

test.each([
  { path: 'scripts/route-reviewers.sh', contents: 'echo invalid\n' },
  { path: 'scripts/route-reviewers.sh', contents: 'echo \'["unknown-role"]\'\n' },
  { path: 'scripts/verify/risk-tiers.yml', contents: 'tiers:\n  high: []\n' },
])('malformed policy input $path cannot narrow simulator coverage', ({ path, contents }) => {
  fixture(); write(path, contents);
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
type Step = { name?: string; run?: string; if?: string; uses?: string; with?: { script?: string; path?: string }; env?: Record<string, string> };
const workflowText = readFileSync(join(root, '.github/workflows/verify.yml'), 'utf8');
const workflow = yaml.load(workflowText) as { on: { pull_request: { types: string[] } };
  permissions: Record<string, string>;
  jobs: Record<string, { if?: string; 'runs-on'?: string; permissions?: Record<string, string>; steps: Step[] }> };
function expression(text: string, context: object) {
  // Evaluate the actual restricted GitHub boolean expressions, not a copy of
  // their branching logic. Inputs are repository YAML and fixture data only.
  return Function('needs', 'always', `return (${text.replace(/^\$\{\{\s*|\s*\}\}$/g, '')});`)(context, () => true);
}
test.each([
  { path: 'docs/guide.md', label: false, staticResult: 'skipped', expected: false, host: 'ubuntu-latest' },
  { path: 'docs/guide.md', label: true, staticResult: 'skipped', expected: false, host: 'ubuntu-latest' },
  { path: 'apps/mobile/lib/menuFilters.ts', label: false, staticResult: 'success', expected: true, host: 'ubuntu-latest' },
  { path: 'apps/mobile/lib/authClient.ts', label: false, staticResult: 'success', expected: true, host: 'ubuntu-latest' },
  { path: 'scripts/example.ts', label: false, staticResult: 'success', expected: true, host: 'ubuntu-latest' },
  { path: 'apps/mobile/lib/menuFilters.ts', label: false, staticResult: 'failure', expected: false, host: 'ubuntu-latest' },
  { path: 'apps/mobile/lib/menuFilters.ts', label: true, staticResult: 'cancelled', expected: false, host: 'ubuntu-latest' },
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
  const artifact = JSON.parse(readFileSync(join(directory, '.evidence/sim-scope/selection.json'), 'utf8'));
  expect(artifact.comparison.head).toBe(head);
  expect(artifact.simulator).toMatchObject({ scope: outputs.sim_scope, flows: JSON.parse(outputs.sim_flows!), smoke: JSON.parse(outputs.sim_smoke!) });
  const needs = { classify: { result: 'success', outputs }, static: { result: entry.staticResult } };
  const build = workflow.jobs.build!;
  expect(expression(build.if!, needs)).toBe(entry.expected);
  expect(build['runs-on']).toBe(entry.host);
  expect(JSON.parse(outputs.sim_flows!).length > 0).toBe(outputs.simulator === 'true');
  // A classification failure must stop both build and native work.
  expect(expression(build.if!, { ...needs, classify: { ...needs.classify, result: 'failure' } })).toBe(false);
});

test('label additions and removals rerun classification, and the final Verify job is byte-for-byte unchanged', () => {
  expect(workflow.on.pull_request.types).toEqual(expect.arrayContaining(['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled']));
  const original = execFileSync('git', ['show', 'HEAD:.github/workflows/verify.yml'], { cwd: root, env, encoding: 'utf8' });
  expect(workflowText.split('\n  verify:\n')[1]).toBe(original.split('\n  verify:\n')[1]);
  const main = execFileSync('git', ['show', 'origin/main:.github/workflows/verify.yml'], { cwd: root, env, encoding: 'utf8' });
  expect(workflowText.split('\n  verify:\n')[1]).toBe(main.split('\n  verify:\n')[1]);
});

test.each(['success', 'failure', 'skipped', 'cancelled'])(
  'actual final Verify requires success from the selected Build job (Build=%s)', buildResult => {
  const needs = {
    classify: { result: 'success', outputs: { code: 'true', tests: 'true', build: 'true' } },
    static: { result: 'success' }, test: { result: 'success' },
    'domain-check': { result: 'success' }, build: { result: buildResult },
  };
  const command = workflow.jobs.verify!.steps.find(step => step.name === 'Require every applicable job')!.run!;
  const result = spawnSync('bash', ['-e', '-c', command], {
    env: { ...env, GITHUB_EVENT_NAME: 'pull_request', NEEDS_JSON: JSON.stringify(needs) }, encoding: 'utf8',
  });
  expect(result.status).toBe(buildResult === 'success' ? 0 : 1);
  expect(result.stdout.trim()).toBe(buildResult === 'success' ? 'true' : 'false');
});

const screen = (copy = 'Your goal', margin = 8, action = 'setGoal("performance")') =>
  `import { StyleSheet, Text, Pressable } from 'react-native';\n` +
  `export default function Screen() { return <Pressable onPress={() => ${action}}><Text>${copy}</Text></Pressable>; }\n` +
  `const styles = StyleSheet.create({ title: { margin: ${margin}, color: 'red' } });\n`;

const manifest = { private: true, dependencies: { expo: '~54.0.33' }, scripts: { 'type-check': 'tsc --noEmit' } };
test.each([
  { path: 'package.json', after: { ...manifest, scripts: { ...manifest.scripts, 'verify:sim-plan': 'node scripts/verify/impact-plan.mjs --simulator' } }, scope: 'none' },
  { path: 'apps/api/package.json', after: { ...manifest, scripts: { 'type-check': 'prisma generate && tsc --noEmit' } }, scope: 'none' },
  { path: 'apps/mobile/package.json', after: { ...manifest, scripts: { ...manifest.scripts, 'test:coverage': 'jest --coverage' } }, scope: 'none' },
  { path: 'package.json', after: { ...manifest, scripts: {} }, scope: 'none' },
  { path: 'package.json', after: { ...manifest, dependencies: { expo: '~55.0.0' } }, scope: 'full' },
  { path: 'package.json', after: { ...manifest, scripts: { ...manifest.scripts, postinstall: 'patch-package' } }, scope: 'full' },
  { path: 'apps/mobile/package.json', after: { ...manifest, scripts: { ...manifest.scripts, ios: 'expo run:ios' } }, scope: 'full' },
  { path: 'package.json', after: { ...manifest, workspaces: ['apps/*'] }, scope: 'full' },
  { path: 'package.json', after: '{invalid json', scope: 'full' },
  { path: 'apps/mobile/eas.json', after: { ...manifest, scripts: {} }, scope: 'full' },
])('actual manifest diff selects $scope for $path: $after', entry => {
  fixture(); write(entry.path, JSON.stringify(manifest)); const base = commit();
  write(entry.path, typeof entry.after === 'string' ? entry.after : JSON.stringify(entry.after)); const head = commit();
  const result = spawnSync(process.execPath, ['scripts/verify/impact-plan.mjs', '--simulator'], {
    cwd: directory, env: { ...env, CI: 'true', FITSY_DIFF_BASE: base, FITSY_DIFF_HEAD: head }, encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ scope: entry.scope, required: entry.scope !== 'none' });
});

test.each([
  { label: false, ui: false, scope: 'none', host: 'ubuntu-latest' },
  { label: true, ui: false, scope: 'full', host: 'ubuntu-latest' },
  // UI mixed with workflow edits retains the canonical high review tier.
  { label: false, ui: true, scope: 'full', host: 'ubuntu-latest' },
])('CI does not mistake verification wiring for native configuration: %j', entry => {
  fixture(); write('package.json', JSON.stringify(manifest));
  write('apps/api/package.json', JSON.stringify(manifest)); const base = commit();
  write('package.json', JSON.stringify({ ...manifest, scripts: { ...manifest.scripts, 'verify:sim-plan': 'node scripts/verify/impact-plan.mjs --simulator' } }));
  write('apps/api/package.json', JSON.stringify({ ...manifest, scripts: { 'type-check': 'prisma generate && tsc --noEmit' } }));
  write('.github/workflows/verify.yml', workflowText);
  if (entry.ui) write('apps/mobile/app/notification-settings.tsx', screen());
  const head = commit();
  write('.evidence/event.json', JSON.stringify({ pull_request: {
    base: { sha: base }, head: { sha: head }, labels: entry.label ? [{ name: 'needs-sim' }] : [],
  } }));
  const result = spawnSync(process.execPath, ['scripts/verify/impact-plan.mjs', '--github-output'], {
    cwd: directory, env: { ...env, CI: 'true', GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: join(directory, '.evidence/event.json'), GITHUB_OUTPUT: join(directory, '.evidence/github-output') }, encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  const plan = JSON.parse(result.stdout);
  expect(plan).toMatchObject({ code: true, tests: true, build: true, simulator: { scope: entry.scope } });
  expect(workflow.jobs.build!['runs-on']).toBe('ubuntu-latest');
});

test.each([
  { path: 'apps/mobile/app/(tabs)/saved.tsx', after: screen('Saved meals'), mode: 'render', scope: 'smoke', flow: 'log-meal' },
  { path: 'apps/mobile/app/macro-setup.tsx', after: screen('Daily energy'), mode: 'render', scope: 'smoke', flow: 'onboarding-assisted-targets' },
  { path: 'apps/mobile/app/welcome/goal.tsx', after: screen('Your goal', 12), mode: 'render', scope: 'smoke', flow: 'onboarding-assisted-targets' },
  { path: 'apps/mobile/app/notification-settings.tsx', after: screen('Notifications'), mode: 'render', scope: 'smoke', flow: 'reminders' },
  { path: 'apps/mobile/app/notification-settings.styles.ts', after: screen('Your goal', 12), mode: 'render', scope: 'smoke', flow: 'reminders' },
  { path: 'apps/mobile/app/welcome/goal.tsx', after: screen('Your goal', 8, 'router.push("/welcome/tried")'), mode: 'e2e', scope: 'flow' },
  { path: 'apps/mobile/app/welcome/goal.tsx', after: screen('Your goal', 8, 'setGoal("lose_fat")'), mode: 'e2e', scope: 'flow' },
  { path: 'apps/mobile/components/ContinueButton.tsx', after: screen('Continue'), mode: 'e2e', scope: 'full' },
  { path: 'apps/mobile/app/_layout.tsx', after: screen('Fitsy'), mode: 'e2e', scope: 'full' },
  { path: 'apps/mobile/app/auth/login.tsx', after: screen('Sign in'), mode: 'e2e', scope: 'full' },
  { path: 'apps/mobile/app/welcome/payment.tsx', after: screen('Subscribe'), mode: 'e2e', scope: 'full' },
  { path: 'apps/web/app/page.tsx', after: screen('Welcome'), mode: 'e2e', scope: 'full' },
])('actual UI diff selects $scope $mode coverage for $path', entry => {
  fixture(); write(entry.path, screen()); const base = commit();
  write(entry.path, entry.after); const head = commit();
  write('.evidence/github-output', '');
  const result = spawnSync(process.execPath, ['scripts/verify/impact-plan.mjs', '--github-output'], {
    cwd: directory, env: { ...env, CI: 'true', FITSY_DIFF_BASE: base, FITSY_DIFF_HEAD: head,
      GITHUB_OUTPUT: join(directory, '.evidence/github-output') }, encoding: 'utf8',
  });
  expect({ status: result.status, error: result.status === 0 ? '' : result.stderr }).toEqual({ status: 0, error: '' });
  const plan = JSON.parse(result.stdout);
  expect(plan).toMatchObject({ build: true, simulator: { required: true, scope: entry.scope, mode: entry.mode } });
  expect(result.stderr).toContain(`mode: ${entry.mode}`);
  const outputs = readFileSync(join(directory, '.evidence/github-output'), 'utf8');
  expect(outputs).toContain(`sim_mode=${entry.mode}\n`);
  expect(outputs).toContain(`sim_smoke=${JSON.stringify(plan.simulator.smoke)}\n`);
  if (entry.flow) {
    expect(plan.simulator.flows).toEqual([entry.flow]);
    expect(plan.simulator.smoke).toMatchObject([{ screen: entry.path, flow: entry.flow }]);
  } else expect(plan.simulator.smoke).toEqual([]);
  const execute = spawnSync(process.execPath, ['scripts/sim/ci.mjs', '--plan'], {
    cwd: directory, env: { ...env, CI: 'true', FITSY_DIFF_BASE: base, FITSY_DIFF_HEAD: head }, encoding: 'utf8',
  });
  expect({ status: execute.status, error: execute.status === 0 ? '' : execute.stderr }).toEqual({ status: 0, error: '' });
  expect(JSON.parse(execute.stdout)).toEqual(plan.simulator);
});

test.each([
  { before: screen(), after: screen('Copy changed'), expected: true },
  { before: screen(), after: screen('Your goal', 10), expected: true },
  { before: screen(), after: screen('Your goal', 8, 'submitForm()'), expected: false },
  { before: '<Text>{value}</Text>', after: '<Text>{other}</Text>', expected: false },
  { before: '<Text testID="first">Copy</Text>', after: '<Text testID="second">Copy</Text>', expected: false },
  { before: '<Text>Copy</Text>', after: '<Text>{dangerous()}</Text>', expected: false },
  { before: 'const payload = "<Text>Copy</Text>";', after: 'const payload = "<Text>Changed</Text>";', expected: false },
  { before: 'const pattern = /<Text>Copy<\\/Text>/;', after: 'const pattern = /<Text>Changed<\\/Text>/;', expected: false },
  { before: "const s = StyleSheet.create({ value: route({ path: '/first' }) });", after: "const s = StyleSheet.create({ value: route({ path: '/second' }) });", expected: false },
  { before: '', after: screen(), expected: false },
])('presentation narrowing requires literal-only changes: %j', entry => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {presentationOnly} from ${JSON.stringify(modulePath)};
     process.stdout.write(JSON.stringify(presentationOnly(${JSON.stringify(entry.before)}, ${JSON.stringify(entry.after)})));`], { env, encoding: 'utf8' });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toBe(entry.expected);
});

test('pre-push remains main\'s cheap gate and never runs simulator smoke', () => {
  const hook = readFileSync(join(root, '.githooks/pre-push'), 'utf8');
  expect(hook).toBe(execFileSync('git', ['show', 'origin/main:.githooks/pre-push'], { cwd: root, env, encoding: 'utf8' }));
  expect(hook).not.toMatch(/mobile-e2e|sim\/ci|sim-plan/);
});


test('candidate CI only classifies simulator scope with read-only credentials', () => {
  expect(workflow.permissions.statuses).toBeUndefined();
  expect(Object.values(workflow.jobs).some(job => job.permissions?.statuses === 'write')).toBe(false);
  expect(workflow.jobs.classify!.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
  expect(workflow.jobs.classify!.steps.find(step => step.uses === 'actions/checkout@v4')!.with).toMatchObject({ 'persist-credentials': false });
  expect(workflow.jobs.classify!.steps.some(step => step.uses === 'actions/github-script@v7')).toBe(false);
  expect(workflow.jobs.classify!.steps.some(step => step.env?.GH_TOKEN || step.env?.GITHUB_TOKEN)).toBe(false);
  const upload = workflow.jobs.classify!.steps.find(step => step.name === 'Upload simulator selection')!;
  expect(upload.uses).toBe('actions/upload-artifact@v4');
  expect(upload.with?.path).toBe('.evidence/sim-scope/selection.json');
  for (const file of readdirSync(join(root, '.github/workflows'))) {
    const text = readFileSync(join(root, '.github/workflows', file), 'utf8');
    expect(text).not.toMatch(/FITSY_(?:CI_)?SIM_|sim\/ci\.mjs|maestro|simctl|iphonesimulator|macos-15/);
  }
  expect(existsSync(join(root, '.eas/workflows/mobile-e2e.yml'))).toBe(false);
  const registry = yaml.load(readFileSync(join(root, 'scripts/verify/registry.yml'), 'utf8')) as { checks: { name: string; script: string }[] };
  expect(registry.checks.some(check => check.name === 'mobile-e2e')).toBe(false);
});

test.each(['none', 'smoke', 'flow', 'full'])('actual %s selection produces a status within GitHub\'s 140-character limit', scope => {
  const simulator = select(scope === 'none' ? ['docs/guide.md'] : scope === 'full' ? ['apps/mobile/lib/authClient.ts'] : ['apps/mobile/lib/notificationSchedule.ts']);
  if (scope === 'smoke') Object.assign(simulator, { scope, mode: 'render', smoke: [
    { flow: 'reminders', screen: 'apps/mobile/app/notification-settings.tsx', selector: { id: 'reminder-permission' } },
  ] });
  const head = 'a'.repeat(40);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {scopeDescription} from ${JSON.stringify(join(root, 'scripts/verify/sim-scope-status.mjs'))};
     process.stdout.write(scopeDescription(${JSON.stringify({ version: 1, comparison: { head, unknown: false }, simulator })}, '${head}'));`],
  { env, encoding: 'utf8' });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  expect(result.stdout.trim()).toBe(`scope=${scope} flows=${simulator.flows.length}`);
  expect(result.stdout.trim().length).toBeLessThanOrEqual(140);
});
