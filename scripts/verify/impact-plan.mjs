#!/usr/bin/env node
// Dependency-free diff selection shared by local verification and hosted jobs.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export function isMain(url) {
  try { return Boolean(process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(url)); }
  catch { return false; } // Imports from stdin have no file entrypoint.
}
// This service-only observability endpoint has no mobile caller or journey.
// Any other API, shared, or mobile path still requires native proof.
export const serviceHealthPath = path => /^apps\/api\/app\/api\/health\/route(?:\.test)?\.ts$/.test(path);
export const gitEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_')));
export function git(args, cwd = repository, env = process.env) {
  return execFileSync('git', args, { cwd, env: gitEnv(env), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

export function comparison({ cwd = repository, env = process.env, base, head } = {}) {
  try {
    let kind = 'branch';
    if (!base && (env.CI || env.GITHUB_EVENT_NAME || ['local', 'ci'].includes(env.FITSY_RUNS)) && env.FITSY_DIFF_BASE) { base = env.FITSY_DIFF_BASE; head ??= env.FITSY_DIFF_HEAD; kind = 'explicit'; }
    else if (base) kind = 'explicit';
    if (!base && env.GITHUB_EVENT_PATH && ['push', 'pull_request', 'pull_request_target'].includes(env.GITHUB_EVENT_NAME)) {
      const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
      kind = env.GITHUB_EVENT_NAME;
      if (kind === 'push') { base = event.before; head = event.after; }
      else {
        base = event.pull_request?.base?.sha; head = event.pull_request?.head?.sha;
        if (!base || !head) throw new Error('Missing PR comparison');
        base = git(['merge-base', base, head], cwd, env);
      }
      if (!base || !head || /^0+$/.test(base) || /^0+$/.test(head)) throw new Error('Unavailable event range');
    }
    head = git(['rev-parse', '--verify', `${head || 'HEAD'}^{commit}`], cwd, env);
    base = base ? git(['rev-parse', '--verify', `${base}^{commit}`], cwd, env) : git(['merge-base', 'origin/main', head], cwd, env);
    return { base, head, kind, unknown: false };
  } catch {
    // Missing/shallow/first-push history must never classify as documentation.
    return { base: null, head: null, kind: 'unavailable', unknown: true };
  }
}

export function changedFiles(options = {}) {
  const { cwd = repository, env = process.env } = options;
  const range = comparison(options);
  if (range.unknown) return { comparison: range, files: null };
  try {
    const files = git(['diff', '--name-only', '--no-renames', '-z', range.base, range.head], cwd, env).split('\0');
    if (!env.CI && !env.GITHUB_EVENT_NAME) {
      files.push(...git(['diff', '--name-only', '--no-renames', '-z', 'HEAD'], cwd, env).split('\0'));
      files.push(...git(['ls-files', '--others', '--exclude-standard', '-z'], cwd, env).split('\0'));
    }
    return { comparison: range, files: [...new Set(files.filter(Boolean))].sort() };
  } catch { return { comparison: { ...range, unknown: true }, files: null }; }
}

// Focused recipes share one database admission rule across runner and direct CLI.
export function focusedDatabaseRequired(paths, env = process.env) {
  return Boolean(env.POSTGRES_PRISMA_URL || env.POSTGRES_URL_NON_POOLING) ||
    paths.some(path => typeof path === 'string' && (path.startsWith('apps/api/') ||
      /^scripts\/(?:hex-resume|hex-persist|pipeline-completed-hex|mini-hex-e2e)\.test\.ts$/.test(path)));
}

export const allTestGroups = ['api', 'scripts', 'mobile'];
const documentationPath = path => /^[^/]+\.md$/.test(path) ||
  /^(docs|proj-mgmt)\/.*\.(md|mdx|rst|txt|png|jpe?g|svg|webp)$/.test(path);

// Flow names are the existing Maestro sources, not another scenario registry.
const screenFlows = [
  [/^apps\/mobile\/(app\/restaurant\/|components\/MenuItemCard\.|lib\/(menuFilters|menuLoadState)\.)/,
    /^(chain-menu-serving|menu-load-recovery|menu-macro-serving)$/],
  [/^apps\/mobile\/(app\/notification-settings\.|lib\/(notification|pushToken|useNotifications|useReminders))/,
    /^reminders$/],
  [/^apps\/mobile\/(app\/macro-setup\.|components\/ScrollPicker\.|lib\/(macroCalculator|macroPresets|macroSuggestions)\.)/,
    /^onboarding-(assisted-targets|target-ranked-search)$/],
  [/^apps\/mobile\/(app\/\(tabs\)\/search\.|components\/(Discovery|Restaurant|Location|FilterPopup|SearchHeader)|lib\/(discovery|searchLoading|locations|locationCache|useLocation|useDiscovery))/,
    /^(onboarding-(assisted-targets|guided-preview|target-ranked-search)|menu-load-recovery)$/],
  [/^apps\/mobile\/(components\/Preview|lib\/(preview|guidedPreview|usePreview))/,
    /^onboarding-(guided-preview|returning-preview|target-ranked-search)$/],
  [/^apps\/mobile\/(app\/(welcome\/|onboarding\.)|components\/(Welcome|Onboarding|ContinueButton|ProgressDots|ScrollPicker|SelectionCard)|lib\/onboarding)/,
    /^(cold-start-welcome|onboarding-.*)$/],
];
const simulatorSource = path => !/\.(md|mdx|rst|txt)$/.test(path) &&
  !/(?:\.test\.|\.spec\.|__tests__\/|__mocks__\/)/.test(path);
const mobileContract = path => /^(apps\/mobile\/|packages\/shared\/|prisma\/|package(?:-lock)?\.json$|apps\/api\/(app\/api\/|lib\/|services\/))/.test(path);
const highSimulatorPath = path =>
  /^package(?:-lock)?\.json$/.test(path) ||
  /^apps\/mobile\/(?:ios\/|android\/|plugins\/|(?:app\.config\.[^/]+|app\.json|eas\.json|package\.json|(?:metro|babel)\.config\.[^/]+)$|app\/(?:.*\/)?(?:_layout|index|\+native-intent)\.)/.test(path) ||
  /^apps\/mobile\/(?:lib\/(?:onboardingEntry|onboardingResume|onboardingPreviewEntry|onboardingCompletion|requireWelcomeGoal|pendingMealClaim|macroStorage)|components\/(?:OnboardingAccountSummary|PreviewRestaurantCard))\./.test(path) ||
  /^(?:scripts\/deploy\/|\.eas\/|\.github\/workflows\/(?:deploy|release|eas-build)[^/]*\.ya?ml$)/.test(path) ||
  (mobileContract(path) && /auth|signin|session|supabase|jwt|payment|paywall|purchase|entitlement|subscription|revenuecat|resubscribe|trial|teaserGate|LockedUnlock|reviewAccess|navigation|nativeIntent|hardwareBack|OwnedHardwareBack|RouteContinuation/i.test(path));

export function simulatorFlows(cwd = repository) {
  try {
    return readdirSync(resolve(cwd, 'apps/mobile/e2e/flows')).filter(name => /^[a-z0-9-]+\.yaml$/.test(name))
      .map(name => name.replace(/\.yaml$/, '')).sort();
  } catch { return []; } // The runner rejects a required but missing/empty catalog.
}

export function simulatorSelection(files, { cwd = repository, env = process.env, labels = [], release = false, unknownContext = false } = {}) {
  const all = simulatorFlows(cwd);
  const result = (risk, scope, flows, reason, reviewTier = null) =>
    ({ risk, scope, required: scope !== 'none', flows, reason, reviewTier });
  const full = reason => result('high', 'full', all, reason);
  if (files === null) return full('Comparison history unavailable; all journeys may be affected');
  if (unknownContext) return full('Event context unavailable; simulator overrides cannot be ruled out');
  if (release) return full('Release candidate requires the full simulator flow set');
  const source = files.filter(simulatorSource);
  const highPath = source.find(highSimulatorPath);
  if (highPath) return full(`Navigation, auth, billing, native configuration or release path: ${highPath}`);
  const mobile = source.filter(path => path.startsWith('apps/mobile/'));
  let selection = result('low', 'none', [], 'Docs, tests, scripts or non-mobile change; unit and focused tests only');
  if (mobile.length || source.some(path => mobileContract(path) && !serviceHealthPath(path))) {
    // Reuse review's deterministic tier command and its risk-tiers.yml rules.
    // REVIEW.md confidence/urgency rules and route-reviewers.sh stay untouched.
    let reviewTier;
    try {
      reviewTier = execFileSync(process.execPath, [resolve(cwd, 'scripts/review/tier.mjs')],
        { cwd, env: gitEnv(env), input: files.join('\n'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch { return full('Canonical review tier unavailable; cannot establish a narrower simulator scope'); }
    if (!['low', 'medium', 'high'].includes(reviewTier)) return full('Canonical review tier invalid; using all flows');
    if (reviewTier === 'high') return { ...full('High canonical review tier affects a mobile-facing contract'), reviewTier };
    const flows = new Set();
    for (const path of mobile) {
      const direct = /^apps\/mobile\/e2e\/flows\/([a-z0-9-]+)\.yaml$/.exec(path);
      const mapped = direct ? all.filter(name => name === direct[1])
        : all.filter(name => screenFlows.some(([pattern, flow]) => pattern.test(path) && flow.test(name)));
      if (!mapped.length) return { ...full(`Unmapped mobile path: ${path}; full coverage required`), reviewTier };
      for (const name of mapped) flows.add(name);
    }
    if (flows.size) selection = result('medium', 'affected', [...flows].sort(),
      `Mapped affected screens from: ${mobile.join(', ')}`, reviewTier);
  }
  if (labels.includes('needs-sim')) {
    if (!selection.required) return full('needs-sim label forces the full flow set for an otherwise non-mobile change');
    selection.reason += '; needs-sim label forces simulator execution';
  }
  return selection;
}

function simulatorContext(env) {
  const context = { labels: [], release: env.GITHUB_EVENT_NAME === 'release' || env.GITHUB_REF_TYPE === 'tag' };
  if (env.GITHUB_EVENT_PATH) {
    try {
      const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
      context.labels = (event.pull_request?.labels || []).map(label => label.name);
    } catch { context.unknownContext = true; }
  }
  return context;
}

// Whole workspaces only. Shared inputs, harness changes and unknown paths
// cannot establish that any consumer is unaffected.
export function wholeTestGroups(files) {
  if (files === null) return [...allTestGroups];
  const groups = new Set();
  for (const path of files) {
    if (documentationPath(path)) continue;
    if (/^scripts\/(?:verify|sim)\/|(?:^|\/)(?:package(?:-lock)?\.json|(?:jest|babel|metro|eslint|next)\.config\.[^/]+|tsconfig[^/]*\.json)$/.test(path)) {
      return [...allTestGroups];
    }
    const group = path.startsWith('apps/api/') ? 'api'
      : path.startsWith('apps/mobile/') ? 'mobile'
        : path.startsWith('scripts/') ? 'scripts' : null;
    if (!group) return [...allTestGroups];
    groups.add(group);
  }
  return allTestGroups.filter(group => groups.has(group));
}

export function impactPlan(options = {}) {
  const selection = changedFiles(options);
  const documentationOnly = selection.files !== null && selection.files.every(documentationPath);
  const code = !documentationOnly;
  // Product-flow remains the authority for exact categories and native proof.
  const native = code && (selection.files === null || selection.files.some(path =>
    /^(apps\/mobile\/|packages\/shared\/|apps\/api\/(app\/api\/|lib\/|services\/|[^/]+$)|prisma\/|package(-lock)?\.json$)/.test(path) &&
    !/\.md$/.test(path) && !serviceHealthPath(path)));
  const simulator = simulatorSelection(selection.files, { ...simulatorContext(options.env || process.env), ...options });
  return { version: 1, ...selection, documentationOnly, code, tests: code, build: code || simulator.required, native, simulator,
    testGroups: wholeTestGroups(selection.files) };
}

export function checkApplies(check, plan) {
  // New/unknown checks fail conservatively: only explicitly classified code
  // checks are excluded for a known documentation-only comparison.
  return check.impact !== 'code' || plan.code;
}

if (isMain(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=') || true];
  }));
  const plan = impactPlan({ base: args.base, head: args.head,
    ...(args['release-candidate'] ? { release: true } : {}) });
  if (args['github-output']) {
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
    for (const [key, value] of Object.entries({ docs_only: plan.documentationOnly, code: plan.code, tests: plan.tests, build: plan.build, native: plan.native,
      simulator: plan.simulator.required, sim_scope: plan.simulator.scope, sim_flows: JSON.stringify(plan.simulator.flows) })) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    }
    console.error(`Simulator scope: ${plan.simulator.scope} (risk: ${plan.simulator.risk}); ${plan.simulator.reason}; flows: ${plan.simulator.flows.join(', ') || 'none'}`);
  }
  if (args.simulator) console.log(JSON.stringify(plan.simulator));
  else if (args['test-groups']) console.log(plan.testGroups.join(' '));
  else if (args.files) {
    if (!plan.files) { console.error('Comparison history unavailable'); process.exitCode = 1; }
    else process.stdout.write(plan.files.join('\n') + (plan.files.length ? '\n' : ''));
  } else console.log(JSON.stringify(plan));
}
