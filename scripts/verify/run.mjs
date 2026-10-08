#!/usr/bin/env node
/**
 * Registry-driven check runner. One implementation, every caller:
 * the pre-push hook, CI jobs, agents, and `npm run verify` all come here.
 *
 *   node scripts/verify/run.mjs [--layer=0-2|all] [--scope=changed|all]
 *                               [--runs=local|ci|scheduled] [--only=name,...]
 *
 * Reads scripts/verify/registry.yml, filters checks by layer, run context and
 * (for advisory checks with --scope=changed) path globs against origin/main, runs them
 * in parallel, and prints one JSON result line per check plus a summary.
 * Exit 1 if any BLOCKING check fails; shadow failures are reported only.
 *
 * Check contract (scripts/verify/README.md): exit 0 pass / 1 fail / 2 skipped;
 * last stdout line is JSON {name, status, summary, fix}.
 */
import { execFile } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { impactPlan, git } from "./impact-plan.mjs";

const VERIFY_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(VERIFY_DIR, "..", "..");
if (!existsSync(join(REPO_ROOT, "node_modules/js-yaml"))) {
  const { admitResources } = await import("./resource-admission.mjs");
  console.log(JSON.stringify(admitResources({ root: REPO_ROOT })));
  process.exit(1);
}
const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  }),
);
const layerArg = args.layer ?? "all";
const scope = args.scope ?? "changed";
const runsCtx = args.runs ?? (process.env.CI ? "ci" : "local");
const stage = args.stage ?? 'full';
if (!['cheap', 'full'].includes(stage)) throw new Error('stage must be cheap or full');
const isAcceptance = c => c.stage === 'acceptance' || c.layer >= 2;
const only = args.only ? new Set(args.only.split(",")) : null;
let delivery;
const activeAttempts = new Set();
if (runsCtx === 'local' && existsSync(join(REPO_ROOT, 'scripts/delivery/phase-events.mjs'))) {
  try { delivery = await import('../delivery/phase-events.mjs'); }
  catch (error) { console.error(`delivery telemetry: unavailable (${error.message})`); }
}
function beginTiming(phase, check) {
  try { const attempt = delivery?.start(REPO_ROOT, phase, 'verify-run', { check }) ?? null;
    if (attempt) activeAttempts.add(attempt); return attempt; }
  catch (error) { console.error(`delivery telemetry: ${error.message}`); return null; }
}
function endTiming(attempt, status) {
  if (!attempt || !activeAttempts.has(attempt)) return;
  try { delivery.finish(REPO_ROOT, attempt, status); activeAttempts.delete(attempt); }
  catch (error) { console.error(`delivery telemetry: ${error.message}`); }
}

const [layerMin, layerMax] =
  layerArg === "all" ? [0, 99] : layerArg.includes("-") ? layerArg.split("-").map(Number) : [Number(layerArg), Number(layerArg)];

function globToRegExp(glob) {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*|\*/g, (m) => (m === "**" ? ".*" : "[^/]*"));
  return new RegExp(`^${re}$`);
}

const registry = yaml.load(readFileSync(join(VERIFY_DIR, "registry.yml"), "utf8"));
const plan = impactPlan({ base: args.base, head: args.head });
const files = scope === "changed" ? plan.files : null;

const focusedSelection = () => existsSync(join(REPO_ROOT, '.evidence/verify/focused-tests.json')) ? readFileSync(join(REPO_ROOT, '.evidence/verify/focused-tests.json'), 'utf8') : null;
const frozenSelection = focusedSelection();
function focusedDatabase() {
  try { return JSON.parse(frozenSelection ?? '{}').tests?.some(path => typeof path === 'string' && path.startsWith('apps/api/')) ?? false; }
  catch { return false; } // The focused check reports malformed recipes as blocking failures.
}
const selected = [];
const skipped = [];
for (let c of registry.checks) {
  if (c.name === 'review-admission') continue;
  if (stage === 'cheap' && isAcceptance(c)) continue;
  if (only && !only.has(c.name)) continue;
  if (!only) {
    if (c.standalone) continue;
    if (c.layer < layerMin || c.layer > layerMax) continue;
    if (c.runs && !c.runs.includes(runsCtx)) continue;
    // Blocking checks must not disappear on PRs and reappear on main.
    // Layers, run context and explicit standalone invocation still apply;
    // changed-path optimization is reserved for advisory checks.
    if (c.blocking === "shadow" && files && c.paths?.length) {
      const regs = c.paths.map(globToRegExp);
      if (!files.some((f) => regs.some((r) => r.test(f)))) {
        skipped.push({ name: c.name, status: "skipped", summary: "no matching changed files" });
        continue;
      }
    }
  }
  if (!existsSync(join(VERIFY_DIR, c.script))) {
    selected.push({ ...c, missing: true });
    continue;
  }
  if (c.name === 'focused-tests') c = { ...c, selection: frozenSelection, database: focusedDatabase() };
  selected.push(c);
}
const acceptance = selected.filter(c => isAcceptance(c) && !c.preflight);
// Admission remains mandatory even for --only=test or a layer-only caller.
if (runsCtx === 'local' && acceptance.length) {
  const gate = registry.checks.find(c => c.name === 'review-admission');
  if (gate) {
    for (let c of registry.checks.filter(c => !c.standalone && c.name !== 'review-admission' && !isAcceptance(c) && (!c.runs || c.runs.includes(runsCtx)))) {
      if (c.name === 'focused-tests') c = { ...c, selection: frozenSelection, database: focusedDatabase() };
      if (!selected.some(existing => existing.name === c.name)) {
        selected.push(existsSync(join(VERIFY_DIR, c.script)) ? c : { ...c, missing: true });
      }
    }
    selected.push({ ...gate, missing: !existsSync(join(VERIFY_DIR, gate.script)) });
  }
}
const observedStart = new Date().toISOString();
const observedHead = plan.comparison.head;
let sourceIdentity, frozenSource;
if (runsCtx === 'local' && registry.checks.some(c => c.name === 'review-admission')) {
  ({ sourceIdentity } = await import('./receipt-cache.mjs'));
  frozenSource = sourceIdentity(REPO_ROOT);
}
function sourceStable() {
  return !sourceIdentity || (focusedSelection() === frozenSelection && sourceIdentity(REPO_ROOT) === frozenSource && git(['rev-parse', 'HEAD'], REPO_ROOT).trim() === observedHead);
}
const cheap = selected.filter(c => !c.preflight && !isAcceptance(c));
const remaining = selected.filter(c => !c.preflight && isAcceptance(c));
let wholeAttempt = process.env.FITSY_LOCAL_DB === '1' ? null : beginTiming('verification', 'whole');
function interruptTiming() {
  for (const attempt of [...activeAttempts]) endTiming(attempt, 'interrupted');
  wholeAttempt = null;
}
process.on('exit', interruptTiming);
delivery?.closeOnSignals(interruptTiming);
function closeWhole(status) {
  if (wholeAttempt) { endTiming(wholeAttempt, status); wholeAttempt = null; }
}

function runCheck(c) {
  const attempt = beginTiming(c.layer === 2 ? 'unit' : 'verification', c.name);
  if (c.missing) {
    endTiming(attempt, 'fail');
    return Promise.resolve({ name: c.name, status: "fail", summary: `registry entry has no script ${c.script}`, fix: "add the script or remove the entry", blocking: c.blocking !== "shadow" });
  }
  return new Promise((resolve) => {
    const t0 = Date.now();
    const checkEnv = { ...process.env, FITSY_RUNS: runsCtx,
      FITSY_VERIFY_NEEDS_NATIVE: plan.native ? '1' : '0',
      FITSY_VERIFY_NEEDS_TEST_DEPS: selected.some(check => check.name === 'test') ? '1' : '0',
      ...(plan.comparison.base ? { FITSY_DIFF_BASE: plan.comparison.base } : {}),
      ...(runsCtx === 'ci' && plan.comparison.head ? { FITSY_DIFF_HEAD: plan.comparison.head } : {}) };
    if (c.name === 'dev-drift' && process.env.FITSY_VERIFY_OWNED_DB) {
      checkEnv.POSTGRES_URL_NON_POOLING = process.env.FITSY_VERIFY_CALLER_NON_POOLING_URL ?? '';
    }
    execFile("bash", [join(VERIFY_DIR, c.script), `--scope=${scope}`], { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024,
      env: checkEnv }, (err, stdout, stderr) => {
      const code = err ? (err.code ?? 1) : 0;
      let parsed;
      try {
        parsed = JSON.parse(stdout.trim().split("\n").at(-1));
      } catch {
        parsed = { name: c.name, summary: (stderr || stdout).trim().split("\n").at(-1)?.slice(0, 200) ?? "" };
      }
      const status = code === 0 ? "pass" : code === 2 ? "skipped" : "fail";
      endTiming(attempt, status);
      resolve({
        ...parsed,
        name: c.name,
        status,
        duration_ms: Date.now() - t0,
        blocking: c.blocking !== "shadow",
        // Keep the original failing workspace, even when later suites print a long passing log.
        // execFile's maxBuffer above bounds output; CI applies its normal log secret masking.
        stderr: status === "fail" ? stderr : undefined,
      });
    });
  });
}

async function runChecks(checks) {
  const completedResults = [];
  const cacheable = checks.filter(c => c.cache && runsCtx === 'local');
  let cache;
  try {
    if (cacheable.length && !plan.comparison.unknown) {
      const { verificationCache } = await import('./receipt-cache.mjs');
      cache = verificationCache(REPO_ROOT, process.env, plan);
    }
  } catch (error) {
    completedResults.push({ name: 'receipt-cache', status: 'fail', blocking: true, summary: error.message,
      fix: 'repair the local cache directory and rerun verification' });
  }
  if (completedResults.some(result => result.status === 'fail' && result.blocking)) {
    completedResults.push(...checks.map(c => ({ name: c.name, status: 'skipped', summary: 'receipt cache admission failed' })));
  } else {
    const completed = await Promise.all(checks.map(c => {
      const prior = args.reuse && c.cache && cache?.read(c);
      if (prior) {
        const attempt = beginTiming(c.layer === 2 ? 'unit' : 'verification', c.name);
        endTiming(attempt, 'cached');
      }
      if (!prior && c.cache && cache) cache.invalidate(c);
      return prior || runCheck(c);
    }));
    if (cache) {
      if (cache.unchanged()) {
        for (const check of cacheable) {
          const result = completed.find(r => r.name === check.name);
          if (!result.cached) cache.write(check, result);
        }
      } else {
        for (const check of cacheable) cache.invalidate(check);
        completed.push({ name: 'source-stability', status: 'fail', blocking: true,
          summary: 'source or local configuration changed during verification', fix: 'finish edits and rerun verification on stable inputs' });
      }
    }
    completedResults.push(...completed);
  }
  return completedResults;
}

const preflight = await Promise.all(selected.filter(c => c.preflight && c.name !== 'review-admission').map(runCheck));
const results = [...preflight];
// Cheap failures stop expensive work in local and combined CI invocations.
if (!results.some(r => r.status === 'fail' && r.blocking)) {
  const focused = cheap.filter(c => c.name === 'focused-tests');
  results.push(...await runChecks(cheap.filter(c => c.name !== 'focused-tests')));
  if (!results.some(r => r.status === 'fail' && r.blocking)) {
    if (runsCtx === 'local' && focused.some(c => c.database)) {
      const { runWithLocalDatabase, assertOwnedDatabase } = await import('./local-db.mjs');
      try {
        if (process.env.FITSY_VERIFY_OWNED_DB) {
          assertOwnedDatabase();
          results.push(...await runChecks(focused));
        } else {
          const forwarded = process.argv.slice(2).filter(arg => !/^--(?:only|layer|stage)(?:=|$)/.test(arg));
          const status = runWithLocalDatabase([...forwarded, '--only=focused-tests', '--stage=cheap', '--layer=0-2']);
          results.push({ name: 'focused-database', status: status === 0 ? 'pass' : 'fail', blocking: true,
            summary: 'focused database tests executed through owned disposable database admission' });
        }
      } catch (error) {
        results.push({ name: 'focused-database', status: 'fail', blocking: true, summary: error.message });
      }
    } else results.push(...await runChecks(focused));
  } else skipped.push(...focused.map(c => ({ name: c.name, status: 'skipped', summary: 'cheap checks failed' })));
} else {
  skipped.push(...cheap.map(c => ({ name: c.name, status: 'skipped', summary: 'preflight failed' })));
}
if (!sourceStable()) results.push({ name: 'source-stability', status: 'fail', blocking: true,
  summary: 'candidate changed during cheap checks', fix: 'freeze candidate source and rerun cheap/focused checks and review' });
if (!results.some(r => r.status === 'fail' && r.blocking)) {
  results.push(...await Promise.all(selected.filter(c => c.name === 'review-admission').map(runCheck)));
  if (!sourceStable()) results.push({ name: 'source-stability', status: 'fail', blocking: true,
    summary: 'candidate changed during review admission', fix: 'revalidate the changed candidate' });
}
let delegated = false;
if (results.some(result => result.status === 'fail' && result.blocking)) {
  skipped.push(...remaining.map(c => ({ name: c.name, status: 'skipped', summary: 'preflight failed' })));
} else if (runsCtx === 'local' && remaining.some(c => c.database) && !process.env.FITSY_VERIFY_OWNED_DB) {
  const { runWithLocalDatabase } = await import('./local-db.mjs');
  delegated = true;
  try { process.exitCode = runWithLocalDatabase(process.argv.slice(2)); }
  catch (error) {
    console.log(JSON.stringify({ name: 'local-database', status: 'fail', summary: error.message,
      fix: 'repair this worktree\'s owned disposable database and rerun verification' }));
    process.exitCode = 1;
  }
} else {
  if (runsCtx === 'local' && remaining.some(c => c.database)) {
    try {
      const { assertOwnedDatabase } = await import('./local-db.mjs');
      assertOwnedDatabase();
    } catch (error) {
      results.push({ name: 'local-database', status: 'fail', blocking: true,
        summary: error.message, fix: 'rerun through this worktree\'s owned database wrapper' });
    }
  }
  if (results.some(result => result.status === 'fail' && result.blocking)) {
    skipped.push(...remaining.map(c => ({ name: c.name, status: 'skipped', summary: 'local database admission failed' })));
  } else {
    // Build and tests share the API workspace; compile first rather than race its outputs.
    const builds = remaining.filter(c => c.name === 'build');
    results.push(...await runChecks(builds));
    if (!results.some(r => r.status === 'fail' && r.blocking)) results.push(...await runChecks(remaining.filter(c => c.name !== 'build')));
    else skipped.push(...remaining.filter(c => c.name !== 'build').map(c => ({ name: c.name, status: 'skipped', summary: 'production build failed' })));
  }
}
if (!sourceStable()) {
  process.exitCode = 1;
  results.push({ name: 'source-stability', status: 'fail', blocking: true,
  summary: 'candidate changed during verification', fix: 'revalidate cheap checks, review and affected full acceptance' });
  if (delegated) console.error('source-stability: candidate changed during delegated verification');
}
if (runsCtx === 'local' && registry.checks.some(c => c.name === 'review-admission')) {
  const directory = join(REPO_ROOT, '.evidence/verify/attempts');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(join(directory, `${randomUUID()}.json`), JSON.stringify({ version: 1, started_at: observedStart,
    finished_at: new Date().toISOString(), head_sha: observedHead, source_identity: frozenSource,
    stage, delegated, arguments: process.argv.slice(2), results, skipped }) + '\n', { mode: 0o600 });
}
if (!delegated) {
for (const r of [...results, ...skipped]) {
  const { stderr, ...line } = r;
  console.log(JSON.stringify(line));
}
for (const r of results) {
  if (r.status === "fail" && r.stderr) console.error(`\n--- ${r.name} output ---\n${r.stderr}`);
}

const failed = results.filter((r) => r.status === "fail");
const blockingFailed = failed.filter((r) => r.blocking);
const shadowFailed = failed.filter((r) => !r.blocking);
console.error(
  `\nverify: ${results.filter((r) => r.status === "pass").length} pass, ${blockingFailed.length} fail` +
    (shadowFailed.length ? `, ${shadowFailed.length} shadow-fail (${shadowFailed.map((r) => r.name).join(",")})` : "") +
    `, ${results.filter((r) => r.status === "skipped").length + skipped.length} skipped [layers ${layerArg}, scope ${scope}, runs ${runsCtx}]`,
);
for (const r of blockingFailed) console.error(`FAIL ${r.name}: ${r.summary ?? ""}${r.fix ? `\n  fix: ${r.fix}` : ""}`);
// Allow piped diagnostics to drain before Node exits, including failing CI logs.
process.exitCode = blockingFailed.length ? 1 : 0;
}
closeWhole(process.exitCode ? 'fail' : 'pass');
