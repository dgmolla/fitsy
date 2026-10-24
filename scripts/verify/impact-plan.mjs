#!/usr/bin/env node
// Dependency-free diff selection shared by local verification and hosted jobs.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export function isMain(url) {
  try { return Boolean(process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url))); }
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
const simulatorSource = path => !documentationPath(path) && !/\.(md|rst|txt)$/.test(path) &&
  !/(?:\.test\.|\.spec\.|\.d\.ts$|__tests__\/|__mocks__\/|(?:^|\/)(?:__fixtures__|test-fixtures)\/)/.test(path);
const uiPath = path => /\.(?:[jt]sx?|mdx|css|scss|sass|less|svg|png|jpe?g|webp|gif|avif|ico|ttf|otf|woff2?)$/.test(path) &&
  /^(?:apps\/mobile\/(?:app|components|assets|styles|theme|tokens)\/|apps\/(?:web|landing|api)\/(?:src\/)?(?:app\/(?!api\/)|pages\/(?!api\/)|components\/|styles\/|public\/|assets\/)|(?:(?:web|src)\/)?(?:app\/(?!api\/)|pages\/(?!api\/)|components\/|styles\/|public\/|assets\/))/.test(path);
const sharedUIPath = path => /^apps\/mobile\/(?:components\/|assets\/|(?:styles|theme|tokens)\/|lib\/(?:theme|colors|typography)\.)/.test(path) ||
  (uiPath(path) && /(?:^|\/)(?:components|styles|theme)\/|(?:^|\/)(?:layout|_app|global)\./.test(path));
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

// Retain the path tiers as simulator policy without reviving the retired review
// poller. The supported router establishes domain ownership; REVIEW.md's
// severity and independent review rules are separate and remain unchanged.
function simulatorReviewTier(files, cwd, env) {
  const roles = JSON.parse(execFileSync('/bin/bash', [resolve(cwd, 'scripts/route-reviewers.sh')],
    { cwd, env: gitEnv(env), input: files.join('\n'), encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }));
  if (!Array.isArray(roles) || !roles.length || roles.some(role =>
    !['backend', 'frontend', 'cto', 'designer', 'product-manager', 'gtm'].includes(role))) throw new Error('Invalid review routing');
  const tiers = { high: [], low: [] };
  let current;
  for (const raw of readFileSync(resolve(cwd, 'scripts/verify/risk-tiers.yml'), 'utf8').split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (!line.trim() || line === 'tiers:') continue;
    const heading = /^  (high|low):$/.exec(line);
    if (heading) { current = heading[1]; continue; }
    const item = /^    - "([^"]+)"$/.exec(line);
    if (!item || !current) throw new Error('Invalid simulator risk tiers');
    tiers[current].push(new RegExp('^' + item[1].replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*|\*/g, match => match === '**' ? '.*' : '[^/]*') + '$'));
  }
  if (!tiers.high.length || !tiers.low.length) throw new Error('Empty simulator risk tiers');
  return files.some(path => tiers.high.some(pattern => pattern.test(path))) ? 'high'
    : files.length && files.every(path => tiers.low.some(pattern => pattern.test(path))) ? 'low' : 'medium';
}

// Only proven literal presentation edits get the smaller render lane. Any
// unknown syntax, changed handler, state, route or form remains an E2E change.
function sourceCodeAt(text, end) {
  let quote, comment, escaped = false, characterClass = false;
  for (let index = 0; index < end; index++) {
    const char = text[index], next = text[index + 1];
    if (comment === 'line') { if (char === '\n') comment = null; continue; }
    if (comment === 'block') {
      if (char === '*' && next === '/') { comment = null; index++; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (quote === '/') {
        if (char === '[') characterClass = true;
        if (char === ']') characterClass = false;
      }
      if (char === quote && !characterClass) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { comment = 'line'; index++; }
    else if (char === '/' && next === '*') { comment = 'block'; index++; }
    else if (['"', "'", '`'].includes(char)) quote = char;
    else if (char === '/' && /(?:[=(:,;!\[{}?]|\breturn|=>)\s*$/.test(text.slice(0, index))) quote = '/';
  }
  return !quote && !comment;
}

export function presentationOnly(before, after) {
  if (!before || !after || before === after) return false;
  const normalize = text => {
    const copy = text.replace(/(<(Text|p|span|h[1-6]|label|button)\b[^<>]*>)[^<>{}]*?(<\/\2>)/g,
      (match, open, tag, close, offset) => sourceCodeAt(text, offset) ? `${open}#copy${close}` : match);
    return copy.replace(/StyleSheet\.create\(\{[\s\S]*?\}\)/g, (block, offset) => {
      const body = block.slice('StyleSheet.create('.length, -1);
      if (!sourceCodeAt(copy, offset) || /[();]|=>|\bfunction\b|\.\.\./.test(body)) return block;
      return block.replace(/(:\s*)(?:-?\d+(?:\.\d+)?|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")(?=\s*[,}\]])/g, '$1#style');
    });
  };
  return normalize(before) === normalize(after);
}

function renderOnly(path, range, cwd, env) {
  if (!range || range.unknown) return false;
  try {
    const before = git(['show', `${range.base}:${path}`], cwd, env);
    const after = env.CI || env.GITHUB_EVENT_NAME ? git(['show', `${range.head}:${path}`], cwd, env)
      : readFileSync(resolve(cwd, path), 'utf8').trimEnd();
    // Screen-local CSS has no application logic. Imports and additions/deletions
    // cannot prove a purely presentational edit and retain E2E coverage.
    if (/\.(?:css|scss|sass|less)$/.test(path)) return Boolean(before && after && !/@(?:import|use|forward)/.test(before + after));
    return presentationOnly(before, after);
  } catch { return false; }
}

// Smoke reuses each maintained journey's setup, stopping at the screen's first
// render assertion. No second YAML scenario catalog or duplicated login recipe.
export const renderCheckpoints = [
  [/^apps\/mobile\/app\/notification-settings\./, 'reminders', { id: 'reminder-permission' }],
  [/^apps\/mobile\/app\/restaurant\//, 'chain-menu-serving', 'Seed Bowl Co #01'],
  [/^apps\/mobile\/app\/welcome\/problem\./, 'cold-start-welcome', { id: 'welcome-start' }],
  [/^apps\/mobile\/app\/welcome\/location-permission\./, 'cold-start-welcome', { id: 'location-use-current' }],
  [/^apps\/mobile\/app\/welcome\/goal\./, 'onboarding-assisted-targets', { id: 'goal-performance' }],
  [/^apps\/mobile\/app\/welcome\/tried\./, 'onboarding-assisted-targets', { id: 'tried-meal_prep' }],
  [/^apps\/mobile\/app\/welcome\/goal-payoff\./, 'onboarding-assisted-targets', { id: 'goal-progress-graph' }],
  [/^apps\/mobile\/app\/welcome\/target-setup\./, 'onboarding-assisted-targets', { id: 'target-mode-estimate' }],
  [/^apps\/mobile\/app\/welcome\/height\./, 'onboarding-assisted-targets', 'How tall are you.*'],
  [/^apps\/mobile\/app\/welcome\/weight\./, 'onboarding-assisted-targets', 'What do you weigh.*'],
  [/^apps\/mobile\/app\/welcome\/age\./, 'onboarding-assisted-targets', 'How old are you.*'],
  [/^apps\/mobile\/app\/welcome\/sex\./, 'onboarding-assisted-targets', "What's your biological sex.*"],
  [/^apps\/mobile\/app\/welcome\/activity\./, 'onboarding-assisted-targets', 'How active are you.*'],
  [/^apps\/mobile\/app\/welcome\/tuning\./, 'onboarding-assisted-targets', 'Estimated from your answers.*'],
  [/^apps\/mobile\/app\/welcome\/how-it-works\./, 'onboarding-assisted-targets', 'A little context.*A better choice.*'],
  [/^apps\/mobile\/app\/welcome\/preview\./, 'onboarding-guided-preview', { id: 'discovery-hero' }],
];

export function simulatorSelection(files, { cwd = repository, env = process.env, labels = [], release = false, unknownContext = false, comparison: range } = {}) {
  const all = simulatorFlows(cwd);
  const result = (risk, scope, flows, reason, reviewTier = null) =>
    ({ risk, scope, required: scope !== 'none', mode: scope === 'none' ? 'none' : 'e2e', smoke: [], flows, reason, reviewTier });
  const full = reason => result('high', 'full', all, reason);
  if (files === null) return full('Comparison history unavailable; all journeys may be affected');
  if (unknownContext) return full('Event context unavailable; simulator overrides cannot be ruled out');
  if (release) return full('Release candidate requires the full simulator flow set');
  const source = files.filter(simulatorSource);
  const highPath = source.find(highSimulatorPath);
  if (highPath) return full(`Navigation, auth, billing, native configuration or release path: ${highPath}`);
  const sharedUI = source.find(sharedUIPath);
  if (sharedUI) return full(`Shared UI or app shell requires the full smoke suite: ${sharedUI}`);
  const mobile = source.filter(path => path.startsWith('apps/mobile/'));
  let selection = result('low', 'none', [], 'Docs, tests, scripts or non-mobile change; unit and focused tests only');
  if (mobile.length || source.some(path => uiPath(path) || (mobileContract(path) && !serviceHealthPath(path)))) {
    let reviewTier;
    try {
      reviewTier = simulatorReviewTier(source, cwd, env);
    } catch { return full('Review routing or risk tiers unavailable; cannot establish a narrower simulator scope'); }
    if (reviewTier === 'high') return { ...full('High canonical review tier affects a mobile-facing contract'), reviewTier };
    const webUI = source.find(path => uiPath(path) && !path.startsWith('apps/mobile/'));
    if (webUI) return { ...full(`Unmapped web UI requires the full smoke suite: ${webUI}`), reviewTier };
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
    if (mobile.length && source.every(path => uiPath(path) && renderOnly(path, range, cwd, env))) {
      const smoke = mobile.map(path => {
        const checkpoint = renderCheckpoints.find(([pattern]) => pattern.test(path));
        return checkpoint ? { screen: path, flow: checkpoint[1], selector: checkpoint[2] } : null;
      });
      if (smoke.every(Boolean)) selection = { ...selection, mode: 'render', smoke,
        flows: [...new Set(smoke.map(item => item.flow))].sort(),
        reason: `Style/copy-only UI change; launch and render affected screens: ${mobile.join(', ')}` };
    }
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
  const simulator = simulatorSelection(selection.files, { ...simulatorContext(options.env || process.env), ...options, comparison: selection.comparison });
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
      simulator: plan.simulator.required, sim_scope: plan.simulator.scope, sim_mode: plan.simulator.mode,
      sim_smoke: JSON.stringify(plan.simulator.smoke), sim_flows: JSON.stringify(plan.simulator.flows) })) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    }
    console.error(`Simulator scope: ${plan.simulator.scope} (risk: ${plan.simulator.risk}, mode: ${plan.simulator.mode}); ${plan.simulator.reason}; flows: ${plan.simulator.flows.join(', ') || 'none'}`);
  }
  if (args.simulator) console.log(JSON.stringify(plan.simulator));
  else if (args['test-groups']) console.log(plan.testGroups.join(' '));
  else if (args.files) {
    if (!plan.files) { console.error('Comparison history unavailable'); process.exitCode = 1; }
    else process.stdout.write(plan.files.join('\n') + (plan.files.length ? '\n' : ''));
  } else console.log(JSON.stringify(plan));
}
