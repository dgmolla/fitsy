import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

test('real Discovery entry changes select three journeys across CLI and publication, while uncertain changes retain full coverage', () => {
  copyProductFlowControls(directory);
  symlinkSync(resolve(__dirname, '../../node_modules'), join(directory, 'node_modules'));
  writeFileSync(join(directory, '.gitignore'), 'node_modules\n.evidence/\n');
  const paths = ['apps/mobile/components/DiscoveryMap.tsx', 'apps/mobile/components/DiscoveryScreen.tsx',
    '.github/workflows/simulator.yml', 'apps/mobile/lib/useMapSearchFlag.ts'];
  for (const path of paths) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    copyFileSync(resolve(__dirname, '../..', path), join(directory, path));
  }
  const git = (...args: string[]) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args],
    { cwd: directory, env: env() });
  git('init', '-q'); git('config', 'user.name', 'Entry impact fixture'); git('config', 'user.email', 'fixture@example.test');
  git('config', 'core.hooksPath', '/dev/null'); git('add', '.'); git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const map = join(directory, paths[0]!), screen = join(directory, paths[1]!), workflow = join(directory, paths[2]!);
  const originalMap = readFileSync(map, 'utf8'), originalScreen = readFileSync(screen, 'utf8');
  const flag = join(directory, paths[3]!), originalFlag = readFileSync(flag, 'utf8');
  const cli = (file: string) => spawnSync(process.execPath, [file, '--plan'], { cwd: directory, env: env(), encoding: 'utf8' });
  writeFileSync(map, '// Clarify the unchanged renderer.\n' + originalMap);
  expect(JSON.parse(cli('scripts/verify/product-flow.mjs').stdout)).toMatchObject({ required: false, flows: [] });
  const changedScreen = originalScreen.replace(/useState<'map' \| 'list'>\([^\n]+\);/,
    originalScreen.includes("useState<'map' | 'list'>('list')") ? "useState<'map' | 'list'>('map');" : "useState<'map' | 'list'>('list');");
  expect(changedScreen).not.toBe(originalScreen);
  writeFileSync(screen, changedScreen);
  const budget = readFileSync(workflow, 'utf8').replace('    timeout-minutes: 30',
    "    timeout-minutes: ${{ needs.select.outputs.scope == 'full' && 90 || 30 }}").replace(
    "      FITSY_DISPATCH_WORKER_TIMEOUT_SECONDS: '1800'",
    "      FITSY_DISPATCH_WORKER_TIMEOUT_SECONDS: ${{ needs.select.outputs.scope == 'full' && '5400' || '1800' }}");
  writeFileSync(workflow, budget);
  const expected = ['map-search', 'map-search-location-denied', 'onboarding-guided-preview'];
  const final = cli('scripts/verify/product-flow.mjs');
  expect(final.status).toBe(0);
  expect(JSON.parse(final.stdout)).toMatchObject({ flows: expected, categories: ['auth', 'billing', 'changed-journey'] });
  const local = cli('scripts/verify/impact-plan.mjs');
  expect(JSON.parse(local.stdout).simulator).toEqual(JSON.parse(final.stdout).simulator);
  const published = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {publicationPlan} from ${JSON.stringify(resolve(__dirname, '../sim/publish-product-flow.mjs'))};
     process.stdout.write(JSON.stringify(publicationPlan(${JSON.stringify(join(directory, '.evidence/product-flow'))},
       ${JSON.stringify(join(directory, 'missing-build.json'))})));`],
  { cwd: directory, env: { ...env(), FITSY_PRODUCT_ROOT: directory }, encoding: 'utf8' });
  expect(published.status).toBe(0);
  expect(JSON.parse(published.stdout).simulator).toEqual(JSON.parse(final.stdout).simulator);
  const collection = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {collectionPublicConfigKeys} from ${JSON.stringify(resolve(__dirname, '../sim/product-flow.mjs'))};
     import {publicConfigIdentity,requiredPublicConfigKeys,candidatePlan} from ${JSON.stringify(modulePath)};
     import {publicationPlan} from ${JSON.stringify(resolve(__dirname, '../sim/publish-product-flow.mjs'))};
     import {mkdirSync,writeFileSync} from 'node:fs';
     const dir=${JSON.stringify(join(directory, '.evidence/product-flow'))}, file=dir+'/report.json';
     const current=publicConfigIdentity(), build={...current,appHash:'synthetic-app'};
     const keys=collectionPublicConfigKeys(file,build,current,${final.stdout});
     const report={...build,evidenceMode:'final-candidate',result:'awaiting-walkthrough',publicConfigAcceptance:{keys}};
     mkdirSync(dir,{recursive:true}); writeFileSync(file,JSON.stringify(report));
     process.stdout.write(JSON.stringify({keys,finish:candidatePlan(requiredPublicConfigKeys(report,build,current)),
       publication:publicationPlan(dir,${JSON.stringify(join(directory, 'missing-build.json'))})}));`],
  { cwd: directory, env: { ...env(), FITSY_PRODUCT_ROOT: directory }, encoding: 'utf8' });
  expect(collection.status).toBe(0);
  expect(JSON.parse(collection.stdout)).toMatchObject({ keys: [],
    finish: { flows: expected, categories: ['auth', 'billing', 'changed-journey'] },
    publication: { flows: expected, categories: ['auth', 'billing', 'changed-journey'] } });
  git('add', '.'); git('commit', '-qm', 'entry change');
  mkdirSync(join(directory, '.evidence'), { recursive: true });
  const event = join(directory, '.evidence/event.json'), output = join(directory, '.evidence/output');
  const base = git('rev-parse', 'origin/main').toString().trim(), head = git('rev-parse', 'HEAD').toString().trim();
  for (const [eventName, body] of [['push', { before: base, after: head }],
    ['pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } }]] as const) {
    writeFileSync(event, JSON.stringify(body)); writeFileSync(output, '');
    const hosted = spawnSync(process.execPath, [resolve(__dirname, 'simulator-actions.mjs')], {
      cwd: directory, env: { ...env(), CI: 'true', FITSY_PRODUCT_ROOT: directory,
        GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output }, encoding: 'utf8',
    });
    expect(hosted.status).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe('required=true\nscope=flow\ntimeout_minutes=30\nworker_timeout_seconds=1800\n');
    expect(JSON.parse(hosted.stdout.replace(/^Simulator: /, '')).flows).toEqual(expected);
  }
  git('checkout', '-q', '--detach', base);
  const historical = spawnSync(process.execPath, ['scripts/verify/impact-plan.mjs', `--base=${base}`, `--head=${head}`, '--simulator'],
    { cwd: directory, env: env(), encoding: 'utf8' });
  expect(historical.status).toBe(0);
  expect(JSON.parse(historical.stdout)).toMatchObject({ scope: 'flow', flows: expected });
  git('checkout', '-q', '--detach', head);
  for (const mutate of [
    () => writeFileSync(map, originalMap + '\nexport const newRendererBehavior = true;\n'),
    () => writeFileSync(screen, changedScreen.replace('const showMap = mapEnabled', 'const showMap = !mapEnabled')),
    () => writeFileSync(workflow, budget.replace('NODE_ENV: development', 'NODE_ENV: production')),
    // The Shuffle-style policy would let remote flags enable Android Map.
    // It is not equivalent to Map's existing iOS-only availability boundary.
    () => writeFileSync(flag, originalFlag
      .replace(/const allowed = (?:__DEV__ && )?Platform\.OS === 'ios';/, "const productionIOS = !__DEV__ && Platform.OS === 'ios';")
      .replace('  const production = !__DEV__;\n', '')
      .replace(/if \(!allowed(?: \|\| production)?\) return;/, 'if (productionIOS) return;')
      .replace(/\[allowed(?:, production)?\]/, '[productionIOS]')
      .replace(/return allowed && \((?:production \|\| )?debugOverride \|\| enabled\);/,
        'return productionIOS || (__DEV__ && debugOverride) || enabled;')),
  ]) {
    mutate();
    expect(JSON.parse(cli('scripts/verify/product-flow.mjs').stdout).simulator.scope).toBe('full');
    writeFileSync(map, originalMap); writeFileSync(screen, changedScreen); writeFileSync(workflow, budget); writeFileSync(flag, originalFlag);
  }
  const unknownConfig = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {candidatePlan} from ${JSON.stringify(modulePath)}; process.stdout.write(JSON.stringify(candidatePlan(['<unknown>'])));`],
  { cwd: directory, env: { ...env(), FITSY_PRODUCT_ROOT: directory }, encoding: 'utf8' });
  expect(JSON.parse(unknownConfig.stdout).simulator.scope).toBe('full');
  const routing = join(directory, 'scripts/verify/risk-tiers.yml'), routingSource = readFileSync(routing, 'utf8');
  writeFileSync(routing, 'invalid policy');
  expect(JSON.parse(cli('scripts/verify/product-flow.mjs').stdout).simulator.scope).toBe('full');
  writeFileSync(routing, routingSource);
  writeFileSync(screen, originalScreen);
  writeFileSync(map, originalMap + '\nexport const literal = `\n// before\n`;\n');
  git('add', '.'); git('commit', '-qm', 'template literal baseline'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  writeFileSync(map, originalMap + '\nexport const literal = `\n// after\n`;\n');
  expect(JSON.parse(cli('scripts/verify/product-flow.mjs').stdout).simulator.scope).toBe('full');
});

test.each([false, true])('bounded preview adaptation (entitlement startup retry: %s) reaches every consumer and rejects unknown changes', retryStartup => {
  copyProductFlowControls(directory);
  symlinkSync(resolve(__dirname, '../../node_modules'), join(directory, 'node_modules'));
  writeFileSync(join(directory, '.gitignore'), 'node_modules\n.evidence/\n');
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), content);
  };
  // Small source contracts keep this fixture independent of the current app
  // revision. The real candidate is also checked through the same CLI at push.
  const modules: Record<string, [string, string]> = {
    'DiscoveryScreen.tsx': [
      `import { HeroCard } from './DiscoveryCards';
const [view, setView] = useState<'map' | 'list'>(__DEV__ ? 'map' : 'list');
  const header = (
      {isOnboardingPreview && <View style={s.previewIntro} testID="preview-guide">
        <Text style={s.previewHint}>{onboardingPitch(tried).preview}</Text>
      </View>}
  );
      {isOnboardingPreview && <WelcomeNav progress={0.75} backTestID="preview-back" onBack={onPreviewBack} />}`,
      `import { HeroCard } from './DiscoveryCards';
const [view, setView] = useState<'map' | 'list'>('map');
  const previewNav = isOnboardingPreview && <WelcomeNav progress={0.75} backTestID="preview-back" onBack={onPreviewBack} />;
  const previewIntro = isOnboardingPreview && <View style={s.previewIntro} testID="preview-guide">
    <Text style={s.previewHint}>{onboardingPitch(tried).preview}</Text>
  </View>;
  const header = (
      {previewIntro}
  );
      {previewNav}`],
    'DiscoveryMap.tsx': [
      `import { DiscoveryMapCard } from './DiscoveryMapCard';
  const cards = d.locked ? d.results.slice(0, 3) : d.results;
  const more = d.nextCursor && !d.locked && !d.loading;
  function open(result) {
    void openRestaurantOrPaywall(d.locked, navigate, d.onLockedTap);
  }`,
      `import { DiscoveryMapCard } from './DiscoveryMapCard';
  const cards = d.locked ? d.results.slice(0, 3) : d.results;
  const more = d.nextCursor && !d.locked && !d.isOnboardingPreview && !d.loading;
  function open(result) {
    if (d.isOnboardingPreview) { void d.unlockPreview(result); return; }
    void openRestaurantOrPaywall(d.locked, navigate, d.onLockedTap);
  }`],
    'DiscoveryMap.styles.ts': [
      `export const s = StyleSheet.create({
  searchRow: { gap: 8 },
});`,
      `export const s = StyleSheet.create({
  previewHeader: { backgroundColor: EDITORIAL.cream, marginBottom: 8, borderBottomLeftRadius: 20, borderBottomRightRadius: 20 },
  previewUnlock: { marginHorizontal: 16, minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center',
    borderRadius: 24, backgroundColor: EDITORIAL.cream },
  searchRow: { gap: 8 },
});`],
    'DiscoveryMapCard.tsx': [
      `import { HeroMealContent, mealAccessibilitySummary } from './DiscoveryCards';
const card = <HeroMealContent result={result} locked={locked} nameStyle={s.name} />;`,
      `import { HeroMealContent, mealAccessibilitySummary, previewRowLabel } from './DiscoveryCards';
const card = <HeroMealContent result={result} locked={locked} hideDishName={hideDishName} nameStyle={s.name} />;`],
    'DiscoveryCards.tsx': [
      "import { hero } from './DiscoveryScreen.styles';\n" +
      'export function HeroMealContent({ result, locked, paywallPreview = false, nameStyle }) { return result; }\n' +
      'function previewRowLabel(result: RestaurantResult): string {\n' +
      '  const m = result.bestMatch;\n' +
      '  return `${result.name}${m ? `, ${m.calories} kcal, protein ${m.proteinG}g` : ""}`;\n}',
      "import { hero } from './DiscoveryScreen.styles';\n" +
      'export function HeroMealContent({ result, locked, paywallPreview = false, hideDishName = false, nameStyle }) { return result; }\n' +
      'export function previewRowLabel(result: RestaurantResult): string {\n' +
      "  const m = result.bestMatch;\n  const published = m?.nutritionBasis === 'published';\n" +
      "  return `${result.name}${m ? `, ${published ? 'Published' : 'Estimated'} nutrition, ${m.confidence.toLowerCase()} confidence, ${published ? '' : 'approximately '}${m.calories} kcal, protein ${m.proteinG}g` : \"\"}`;\n}"],
  };
  const prefix = 'apps/mobile/components/';
  const budgetControls: Record<string, [string, string]> = {
    '.github/workflows/simulator.yml': [
      `permissions: { contents: read }
      scope: \${{ steps.plan.outputs.scope }}
    timeout-minutes: \${{ needs.select.outputs.scope == 'full' && 90 || 30 }}
      FITSY_DISPATCH_WORKER_TIMEOUT_SECONDS: \${{ needs.select.outputs.scope == 'full' && '5400' || '1800' }}`,
      `permissions: { contents: read }
      scope: \${{ steps.plan.outputs.scope }}
      timeout_minutes: \${{ steps.plan.outputs.timeout_minutes }}
      worker_timeout_seconds: \${{ steps.plan.outputs.worker_timeout_seconds }}
    timeout-minutes: \${{ fromJSON(needs.select.outputs.timeout_minutes) }}
      FITSY_DISPATCH_WORKER_TIMEOUT_SECONDS: \${{ needs.select.outputs.worker_timeout_seconds }}`],
    'scripts/verify/simulator-actions.mjs': [
      `import { changedFiles, isMain, simulatorSelection } from './impact-plan.mjs';
  const labels = [];
  if (plan.required) return { required: true, scope: plan.scope === 'full' ? 'full' : 'flow', flows: plan.flows, reason: plan.reason };
  return { required: controls, scope: controls ? 'smoke' : 'none', flows: [],
    reason: controls ? 'Changed simulator controls require the three maintained hosted smoke journeys' : plan.reason };
      for (const key of ['required', 'scope']) appendFileSync(process.env.GITHUB_OUTPUT, \`\${key}=\${selection[key]}\\n\`);`,
      `import { changedFiles, isMain, simulatorSelection, simulatorBudget } from './impact-plan.mjs';
  const result = selection => ({ ...selection, ...simulatorBudget(selection, options.cwd) });
  const labels = [];
  if (plan.required) return result({ required: true, scope: plan.scope === 'full' ? 'full' : 'flow', flows: plan.flows, reason: plan.reason });
  return result({ required: controls, scope: controls ? 'smoke' : 'none', flows: [],
    reason: controls ? 'Changed simulator controls require the three maintained hosted smoke journeys' : plan.reason });
      for (const [key, value] of Object.entries({ required: selection.required, scope: selection.scope,
        timeout_minutes: selection.timeoutMinutes, worker_timeout_seconds: selection.workerTimeoutSeconds }))
        appendFileSync(process.env.GITHUB_OUTPUT, \`\${key}=\${value}\\n\`);`],
  };
  for (const [path, versions] of Object.entries(budgetControls)) write(path, versions[0]);
  for (const [name, versions] of Object.entries(modules)) write(prefix + name, versions[0]);
  for (const path of ['components/DiscoveryChrome.tsx', 'components/PaywallHero.tsx', 'app/welcome/preview.tsx',
    'app/welcome/resubscribe.tsx', 'app/(tabs)/search.tsx']) {
    write('apps/mobile/' + path, readFileSync(resolve(__dirname, '../../apps/mobile', path), 'utf8'));
  }
  const helper = 'apps/mobile/e2e/helpers/active-entitlement.yaml';
  const repairedHelper = readFileSync(resolve(__dirname, '../..', helper), 'utf8');
  const originalHelper = repairedHelper.replace(/# Retry only the first read[^\n]*\n# Authentication[^\n]*\n- retry:[\s\S]*?(?=\n- tapOn:)/,
    '# Observe the launch transition before XCTest reads the first Welcome element.\n' +
    '- waitForAnimationToEnd:\n    timeout: 10000\n- extendedWaitUntil:\n    visible:\n      id: welcome-login\n    timeout: 60000');
  expect(originalHelper).not.toBe(repairedHelper);
  write(helper, originalHelper);
  for (const path of ['scripts/sim/actions.mjs', 'scripts/sim/ci.mjs', 'scripts/sim/product-flow.mjs',
    'scripts/sim/active-entitlement.mjs', 'scripts/sim/journey-fixtures.mjs', 'scripts/sim/runner-controls.mjs'])
    write(path, readFileSync(resolve(__dirname, '../..', path), 'utf8'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args],
    { cwd: directory, env: env(), encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.name', 'Preview impact fixture'); git('config', 'user.email', 'fixture@example.test');
  git('config', 'core.hooksPath', '/dev/null'); git('add', '.'); git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const base = git('rev-parse', 'HEAD');
  const restore = () => {
    for (const [name, versions] of Object.entries(modules)) write(prefix + name, versions[1]);
    write(helper, retryStartup ? repairedHelper : originalHelper);
  };
  for (const [path, versions] of Object.entries(budgetControls)) write(path, versions[1]);
  restore();
  const cli = (file = 'scripts/verify/product-flow.mjs', args: string[] = ['--plan']) => {
    const result = spawnSync(process.execPath, [file, ...args], { cwd: directory, env: env(), encoding: 'utf8' });
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    return JSON.parse(result.stdout);
  };
  const expected = ['map-search', 'map-search-location-denied', 'onboarding-assisted-targets', 'onboarding-guided-preview',
    'onboarding-out-of-area', 'onboarding-returning-preview', 'onboarding-search-highlight', 'onboarding-target-ranked-search',
    'paywall-access', 'subscription-expired-routing'];
  if (retryStartup) expected.push('floating-nav', 'launch-analytics', 'log-meal', 'shuffle', 'widget-setup');
  expected.sort();
  const plan = cli();
  expect(plan).toMatchObject({ flows: expected,
    categories: ['auth', 'billing', 'changed-journey', 'discovery', 'notifications', 'onboarding'], simulator: { scope: 'flow' } });
  expect(cli('scripts/verify/impact-plan.mjs').simulator).toEqual(plan.simulator);
  const consumers = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {candidatePlan,selectedFlows} from ${JSON.stringify(modulePath)};
     import {publicationPlan} from ${JSON.stringify(resolve(__dirname, '../sim/publish-product-flow.mjs'))};
     const plan=candidatePlan(); process.stdout.write(JSON.stringify({collection:selectedFlows(plan),finish:plan,
       publication:publicationPlan(${JSON.stringify(join(directory, '.evidence/product-flow'))},${JSON.stringify(join(directory, 'missing-build.json'))})}));`],
  { cwd: directory, env: { ...env(), FITSY_PRODUCT_ROOT: directory }, encoding: 'utf8' });
  expect({ status: consumers.status, stderr: consumers.stderr }).toEqual({ status: 0, stderr: '' });
  expect(JSON.parse(consumers.stdout)).toMatchObject({ collection: expected, finish: { flows: expected }, publication: { flows: expected } });
  git('add', '.'); git('commit', '-qm', 'preview adaptation');
  const head = git('rev-parse', 'HEAD'), output = join(directory, '.evidence/output'), event = join(directory, '.evidence/event.json');
  mkdirSync(dirname(output), { recursive: true });
  for (const [eventName, body] of [['push', { before: base, after: head }],
    ['pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } }]] as const) {
    writeFileSync(event, JSON.stringify(body)); writeFileSync(output, '');
    const hosted = spawnSync(process.execPath, [resolve(__dirname, 'simulator-actions.mjs')], {
      cwd: directory, env: { ...env(), CI: 'true', FITSY_PRODUCT_ROOT: directory,
        GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output }, encoding: 'utf8',
    });
    expect(hosted.status).toBe(0);
    expect(JSON.parse(hosted.stdout.replace(/^Simulator: /, ''))).toMatchObject({ flows: expected,
      scope: 'flow', timeoutMinutes: 90, workerTimeoutSeconds: 5400 });
    expect(readFileSync(output, 'utf8')).toBe('required=true\nscope=flow\ntimeout_minutes=90\nworker_timeout_seconds=5400\n');
  }
  for (const [path, from, to] of [
    ['.github/workflows/simulator.yml', 'contents: read', 'contents: write'],
    ['.github/workflows/simulator.yml', 'fromJSON(needs.select.outputs.timeout_minutes)', '30'],
    ['.github/workflows/simulator.yml', 'needs.select.outputs.worker_timeout_seconds', "'1800'"],
    ['scripts/verify/simulator-actions.mjs', 'worker_timeout_seconds: selection.workerTimeoutSeconds', 'worker_timeout_seconds: 1800'],
    ['scripts/verify/simulator-actions.mjs', 'required: true', 'required: false'],
  ]) {
    const original = budgetControls[path!]![1]; expect(original).toContain(from);
    write(path!, original.replace(from!, to!));
    expect(cli().simulator.scope).toBe('full'); write(path!, original);
  }
  for (const [path, versions] of Object.entries(budgetControls)) {
    write(path, versions[0]);
    expect(cli().simulator.scope).toBe('full'); write(path, versions[1]);
  }
  if (retryStartup) {
    for (const [from, to] of [
      ['maxRetries: 2', 'maxRetries: 3'],
      ['timeout: 60000', 'timeout: 60001'],
      ["ALLOW_TEST_PURCHASE === '1'", 'true'],
      ['      - waitForAnimationToEnd:', '      - tapOn: Dev Login\n      - waitForAnimationToEnd:'],
      ['- assertNotVisible:\n    id: resubscribe-restore', ''],
    ] as const) {
      expect(repairedHelper).toContain(from);
      write(helper, repairedHelper.replace(from, to));
      expect(cli().simulator.scope).toBe('full'); restore();
    }
    const flow = 'apps/mobile/e2e/flows/onboarding-guided-preview.yaml', original = readFileSync(join(directory, flow), 'utf8');
    write(flow, original.replace('fixture:unsubscribed-dev', 'fixture:entitled-dev'));
    expect(cli().simulator.scope).toBe('full'); write(flow, original);
  }
  for (const [name, from, to] of [
    ['DiscoveryMap.tsx', 'slice(0, 3)', 'slice(0, 4)'],
    ['DiscoveryMap.tsx', 'd.unlockPreview(result)', 'navigate(result)'],
    ['DiscoveryMap.tsx', 'openRestaurantOrPaywall(d.locked', 'openRestaurantOrPaywall(false'],
    ['DiscoveryCards.tsx', 'paywallPreview = false', 'paywallPreview = true'],
    ['DiscoveryCards.tsx', 'approximately ', ''],
    ['DiscoveryCards.tsx', '${result.name}', '${m.name}'],
    ['DiscoveryMapCard.tsx', 'locked={locked}', 'locked={false}'],
    ['DiscoveryMap.styles.ts', 'searchRow: { gap: 8 }', 'searchRow: { gap: 0 }'],
    ['DiscoveryScreen.tsx', 'onBack={onPreviewBack}', 'onBack={completeOnboarding}'],
  ]) {
    const original = modules[name!]![1]; expect(original).toContain(from);
    write(prefix + name, original.replace(from!, to!));
    expect(cli().simulator.scope).toBe('full'); restore();
  }
  for (const path of ['apps/mobile/lib/useDiscoveryState.ts', 'apps/mobile/lib/newProducer.ts', 'scripts/sim/ci.mjs',
    'scripts/sim/active-entitlement.mjs', 'scripts/sim/journey-fixtures.mjs', 'scripts/sim/runner-controls.mjs',
    'apps/mobile/components/PaywallHero.tsx', 'apps/mobile/app/_layout.tsx', 'packages/shared/src/contracts/search.ts']) {
    const target = join(directory, path), original = (() => { try { return readFileSync(target, 'utf8'); } catch { return null; } })();
    write(path, (original || '') + '\nexport const changed = true;\n');
    expect(cli().simulator.scope).toBe('full');
    if (original === null) rmSync(target); else write(path, original);
  }
  expect(cli('scripts/verify/impact-plan.mjs', ['--release-candidate']).simulator.scope).toBe('full');
  expect(cli('scripts/verify/impact-plan.mjs', ['--base=unavailable-history']).simulator.scope).toBe('full');
  rmSync(join(directory, prefix + 'DiscoveryMapCard.tsx'));
  expect(cli().simulator.scope).toBe('full'); restore();
  const unknownConfig = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {candidatePlan} from ${JSON.stringify(modulePath)};
     process.stdout.write(JSON.stringify(['<unknown>','EXPO_PUBLIC_REVENUECAT_TEST_KEY'].map(key=>candidatePlan([key]).simulator.scope)));`],
  { cwd: directory, env: { ...env(), FITSY_PRODUCT_ROOT: directory }, encoding: 'utf8' });
  expect(JSON.parse(unknownConfig.stdout)).toEqual(['full', 'full']);
  if (retryStartup) {
    // A real additional fixture consumer must extend the union, not disappear
    // behind an issue-specific count. Ambiguous YAML retains FULL instead.
    for (const [tags, scope] of [["[auth, 'fixture:entitled-dev', 'store:test-store']", 'flow'], ['*unknown', 'full'],
      ['[auth]\n"tags": ["fixture:entitled-dev"]', 'full']]) {
      git('reset', '--hard', base);
      git('checkout', '-q', '--detach', base);
      write('apps/mobile/e2e/flows/additional-entitled.yaml', `appId: com.fitsy.mobile\ntags: ${tags}\n---\n- assertVisible: Search\n`);
      git('add', '.'); git('commit', '-qm', 'additional existing fixture consumer'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      restore();
      expect(cli().simulator.scope).toBe(scope);
      if (scope === 'flow') expect(cli().flows).toEqual([...expected, 'additional-entitled'].sort());
    }
    git('reset', '--hard', base);
    git('checkout', '-q', '--detach', base);
    write('scripts/sim/new-caller.mjs', "export { prepareEntitledEvidence } from './product-flow.mjs';\n");
    git('add', '.'); git('commit', '-qm', 'additional existing setup caller'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    restore();
    expect(cli().simulator.scope).toBe('full');
  }
  // A caller that predates the diff must also prevent the narrow selection.
  git('reset', '--hard', base);
  git('checkout', '-q', '--detach', base);
  write('apps/mobile/app/new-consumer.tsx', "import { HeroCard } from '@/components/DiscoveryCards';\nexport default HeroCard;\n");
  git('add', '.'); git('commit', '-qm', 'new existing consumer'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  restore();
  expect(cli().simulator.scope).toBe('full');
});

test.each([
  ['apps/mobile/app/notification-settings.tsx', ['reminders'], ['notifications']],
  ['apps/mobile/app/widget.tsx', ['widget-setup'], ['billing', 'changed-journey', 'discovery']],
  ['apps/mobile/app/(tabs)/saved.tsx', ['log-meal'], ['discovery']],
  ['apps/api/app/api/restaurants/[id]/menu/route.ts', ['chain-menu-serving', 'log-meal', 'map-search', 'map-search-location-denied', 'menu-load-recovery', 'menu-macro-serving', 'paywall-access', 'shuffle'], ['billing', 'discovery']],
  ['apps/api/lib/shuffleSearch.ts', ['map-search', 'shuffle'], ['billing', 'changed-journey', 'discovery']],
  ['apps/mobile/lib/useShuffleFlag.ts', ['map-search', 'shuffle'], ['billing', 'changed-journey', 'discovery']],
  ['apps/mobile/e2e/helpers/shuffle-subscriber.mjs', ['map-search', 'shuffle'], ['billing', 'changed-journey', 'discovery']],
  ['apps/mobile/lib/useMapSearchFlag.ts', ['map-search', 'map-search-location-denied'], ['billing', 'changed-journey', 'discovery']],
  ['apps/mobile/e2e/helpers/map-search-setup.yaml', ['map-search', 'map-search-location-denied'], ['billing', 'changed-journey', 'discovery']],
  ['apps/mobile/e2e/helpers/map-first-spot.yaml', ['map-search', 'map-search-location-denied'], ['billing', 'changed-journey', 'discovery']],
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
