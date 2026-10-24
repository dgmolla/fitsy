#!/usr/bin/env -S -u NODE_OPTIONS -u NODE_PATH PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin node
/**
 * Registry-driven check runner. One implementation, every caller:
 * the pre-push hook, CI jobs, agents, and `npm run verify` all come here.
 *
 *   node scripts/verify/run.mjs [--layer=0-2|all] [--scope=changed|all]
 *                               [--runs=local|ci|scheduled] [--only=name,...]
 *
 * Reads scripts/verify/registry.yml, filters checks by layer, run context and
 * (for advisory checks with --scope=changed) path globs against origin/main, runs cheap
 * checks sequentially within the local resource envelope, and prints one JSON result
 * line per check plus a summary.
 * Exit 1 if any BLOCKING check fails; shadow failures are reported only.
 *
 * Check contract (scripts/verify/README.md): exit 0 pass / 1 fail / 2 skipped;
 * last stdout line is JSON {name, status, summary, fix}.
 */
import { execFile } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { impactPlan, focusedDatabaseRequired, allTestGroups, isMain } from "./impact-plan.mjs";

export async function verify(argv, prepareDatabase) {
  // Clear shell startup selectors before checks launch nested npm or Bash shells.
  for (const key of Object.keys(process.env)) {
    if (key === 'BASH_ENV' || key === 'ENV' || key.startsWith('BASH_FUNC_')) delete process.env[key];
  }

  const VERIFY_DIR = dirname(fileURLToPath(import.meta.url));
  const REPO_ROOT = join(VERIFY_DIR, "..", "..");
  if (!existsSync(join(REPO_ROOT, "node_modules/js-yaml"))) {
    console.log(JSON.stringify({ name: "dependencies", status: "fail",
      summary: "verification dependencies are missing", fix: "run npm ci before verification" }));
    return 1;
  }
  const require = createRequire(import.meta.url);
  const yaml = require("js-yaml");

  const args = Object.fromEntries(
    argv.map((a) => {
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
  const [layerMin, layerMax] =
    layerArg === "all" ? [0, 99] : layerArg.includes("-") ? layerArg.split("-").map(Number) : [Number(layerArg), Number(layerArg)];

  function globToRegExp(glob) {
    const re = glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*|\*/g, (m) => (m === "**" ? ".*" : "[^/]*"));
    return new RegExp(`^${re}$`);
  }

  const registry = yaml.load(readFileSync(join(VERIFY_DIR, "registry.yml"), "utf8"));
  if (only) {
    const unknown = [...only].filter(name => !registry.checks.some(check => check.name === name));
    if (unknown.length) throw new Error(`unknown --only checks: ${unknown.join(',')}`);
  }
  const plan = impactPlan({ base: args.base, head: args.head });
  const files = scope === "changed" ? plan.files : null;

  const focusedSelection = () => existsSync(join(REPO_ROOT, '.evidence/verify/focused-tests.json')) ? readFileSync(join(REPO_ROOT, '.evidence/verify/focused-tests.json'), 'utf8') : null;
  const selectedRecipe = focusedSelection();
  function focusedDatabase() {
    try { return focusedDatabaseRequired(JSON.parse(selectedRecipe ?? '{}').tests ?? [], {}); }
    catch { return false; } // The focused check reports malformed recipes as blocking failures.
  }
  const selected = [];
  const skipped = [];
  for (let c of registry.checks) {
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
    if (c.name === 'focused-tests') c = { ...c, selection: selectedRecipe, database: focusedDatabase() };
    if (c.name === 'test') c = { ...c, selection: {
      groups: scope === 'changed' ? plan.testGroups : allTestGroups, comparison: plan.comparison } };
    if (c.name === 'mobile-e2e') console.error(`Simulator scope: ${plan.simulator.scope} (${plan.simulator.mode}); ${plan.simulator.reason}`);
    selected.push(c);
  }
  const cheap = selected.filter(c => !isAcceptance(c));
  const remaining = selected.filter(isAcceptance);
  const needsDatabase = remaining.some(c => c.database) || cheap.some(c => c.name === 'focused-tests' &&
    (c.database || focusedDatabaseRequired([])));
  if (runsCtx === 'local' && needsDatabase && !prepareDatabase && !process.env.FITSY_VERIFY_OWNED_DB) {
    // Enter the existing OS-lock supervisor before executing this pipeline.
    // The locked CLI calls verify with an internal preparation callback, not a
    // caller-controlled marker authorizing omitted safety checks.
    const { runWithLocalDatabase } = await import('./local-db-control.mjs');
    return runWithLocalDatabase(argv);
  }
  let prepared = false;
  function prepareOwnedDatabase() {
    if (prepareDatabase && !prepared) {
      Object.assign(process.env, prepareDatabase());
      prepared = true;
    }
  }
  let scriptsEnvironment;
  try {
    const recipe = JSON.parse(selectedRecipe ?? '{}');
    if (selected.some(c => c.name === 'focused-tests' && c.script === 'focused-tests.sh') &&
        recipe.tests?.length && recipe.tests.every(path => /^scripts\/.*\.test\.tsx?$/.test(path))) {
      ({ scriptsJestEnvironment: scriptsEnvironment } = await import('./receipt-cache.mjs'));
    }
  } catch { /* The focused launcher reports invalid selections. */ }
  function checkInputs(c, { withoutDatabase = false } = {}) {
      const checkEnv = { ...process.env, FITSY_RUNS: runsCtx,
        ...(c.name === 'focused-tests' ? { FITSY_VERIFY_FOCUSED_RECIPE: c.selection ?? '' } : {}),
        FITSY_VERIFY_NEEDS_NATIVE: plan.native ? '1' : '0',
        FITSY_VERIFY_NEEDS_TEST_DEPS: selected.some(check => check.name === 'test') ? '1' : '0',
        // Nested local checks must inspect the same resolved range as their parent.
        // A missing parent range stays unknown instead of falling back to origin/main.
        FITSY_DIFF_BASE: plan.comparison.base ?? 'unavailable-parent-comparison',
        FITSY_DIFF_HEAD: plan.comparison.head ?? 'HEAD' };
      if (withoutDatabase) {
        for (const key of ['FITSY_VERIFY_DB_LOCKED', 'FITSY_VERIFY_OWNED_DB', 'FITSY_VERIFY_DB_IMAGE',
          'FITSY_VERIFY_DB_HOST', 'FITSY_VERIFY_CALLER_NON_POOLING_URL', 'FITSY_LOCAL_DB',
          'POSTGRES_PRISMA_URL', 'POSTGRES_URL_NON_POOLING']) delete checkEnv[key];
      }
      if (c.name === 'dev-drift' && process.env.FITSY_VERIFY_OWNED_DB) {
        checkEnv.POSTGRES_URL_NON_POOLING = process.env.FITSY_VERIFY_CALLER_NON_POOLING_URL ?? '';
      }
      if (c.name === 'focused-tests' && scriptsEnvironment) {
        Object.assign(checkEnv, scriptsEnvironment(checkEnv), { FITSY_VERIFY_FOCUSED_RECIPE: c.selection ?? '' });
      }
      // Unknown parent history must not become a narrower child comparison.
      const checkArgs = [`--scope=${c.name === 'test' && plan.comparison.unknown ? 'all' : scope}`];
      if (c.name === 'test' && scope === 'changed' && !plan.comparison.unknown) {
        checkArgs.push(`--base=${plan.comparison.base}`);
        // changedFiles still includes local dirty and untracked inputs.
        checkArgs.push(`--head=${plan.comparison.head}`);
      }
      return { env: checkEnv, args: ['-p', join(VERIFY_DIR, c.script), ...checkArgs] };
  }

  function runCheck(c, options) {
    if (c.missing) {
      return Promise.resolve({ name: c.name, status: "fail", summary: `registry entry has no script ${c.script}`, fix: "add the script or remove the entry", blocking: c.blocking !== "shadow" });
    }
    return new Promise((resolve) => {
      const t0 = Date.now();
      const input = checkInputs(c, options);
      execFile("/bin/bash", input.args, { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024,
        env: input.env }, (err, stdout, stderr) => {
        const code = err ? (err.code ?? 1) : 0;
        let parsed;
        try {
          parsed = JSON.parse(stdout.trim().split("\n").at(-1));
        } catch {
          parsed = { name: c.name, summary: (stderr || stdout).trim().split("\n").at(-1)?.slice(0, 200) ?? "" };
        }
        const status = code === 0 ? "pass" : code === 2 ? "skipped" : "fail";
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

  async function runChecks(checks, sequential = false) {
    const completedResults = [];
    // DB-backed focused runs retain fresh execution. Their new complete-file
    // reports may only cover residual work in this same live invocation.
    const cacheable = checks.filter(c => c.cache && runsCtx === 'local' &&
      (c.name !== 'focused-tests' || !c.database));
    let cache;
    try {
      if (cacheable.length && !plan.comparison.unknown) {
        const { verificationCache } = await import('./receipt-cache.mjs');
        cache = verificationCache(REPO_ROOT, process.env, plan, scope, checkInputs);
      }
    } catch (error) {
      completedResults.push({ name: 'receipt-cache', status: 'fail', blocking: true, summary: error.message,
        fix: 'repair the local cache directory and rerun verification' });
    }
    if (completedResults.some(result => result.status === 'fail' && result.blocking)) {
      completedResults.push(...checks.map(c => ({ name: c.name, status: 'skipped', summary: 'receipt cache initialization failed' })));
    } else {
      const runSelected = c => {
        const reusable = cacheable.includes(c);
        const prior = args.reuse && reusable &&
          !(['focused-tests', 'test'].includes(c.name) && focusedDatabaseRequired([])) && cache?.read(c);
        if (!prior && reusable && cache) cache.invalidate(c);
        return prior || runCheck(c);
      };
      const completed = sequential ? [] : await Promise.all(checks.map(runSelected));
      if (sequential) {
        for (const check of checks) completed.push(await runSelected(check));
      }
      if (cache) {
        if (cache.unchanged() && focusedSelection() === selectedRecipe) {
          for (const check of cacheable) {
            const result = completed.find(r => r.name === check.name);
            if (!result.cached) cache.write(check, { ...result, invocation_pid: process.pid });
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

  const results = [];
  const focused = cheap.filter(c => c.name === 'focused-tests');
  const databaseFocused = runsCtx === 'local' && focused.some(c => c.database || focusedDatabaseRequired([]));
  // Full local verification runs focused tests in its prepared test context.
  const fullContextFocused = runsCtx === 'local' && focused.length > 0 && needsDatabase && remaining.some(c => c.name === 'test');
  // Cheap failures stop expensive work in local and combined CI invocations.
  results.push(...await runChecks(cheap.filter(c => c.name !== 'focused-tests'), true));
  if (!results.some(r => r.status === 'fail' && r.blocking)) {
    if (!databaseFocused && !fullContextFocused) results.push(...await runChecks(focused));
  } else skipped.push(...focused.map(c => ({ name: c.name, status: 'skipped', summary: 'cheap checks failed' })));
  // A full local build remains database-free and precedes real acquisition.
  // The same pipeline then prepares the DB and runs its selected focused/full
  // checks, so neither a second runner nor a skipped-cheap trust marker is needed.
  const preDatabaseBuild = runsCtx === 'local' && needsDatabase
    ? remaining.filter(c => c.name === 'build' && !c.database) : [];
  if (preDatabaseBuild.length && !results.some(result => result.status === 'fail' && result.blocking)) {
    for (const build of preDatabaseBuild) results.push(await runCheck(build, { withoutDatabase: true }));
  }
  if ((databaseFocused || fullContextFocused) && !results.some(result => result.status === 'fail' && result.blocking)) {
    try {
      prepareOwnedDatabase();
      const { assertOwnedDatabase } = await import('./local-db-control.mjs');
      assertOwnedDatabase();
      // Cache identities are computed from the actual prepared environment.
      // DB-focused checks remain ineligible for reusable receipts.
      results.push(...await runChecks(focused));
    } catch (error) {
      results.push({ name: 'focused-database', status: 'fail', blocking: true, summary: error.message });
    }
  }
  if (results.some(result => result.status === 'fail' && result.blocking)) {
    skipped.push(...remaining.filter(c => !results.some(result => result.name === c.name))
      .map(c => ({ name: c.name, status: 'skipped', summary: 'cheap checks failed' })));
    if ((databaseFocused || fullContextFocused) && !focused.some(c => results.some(result => result.name === c.name))) {
      skipped.push(...focused.filter(c => !skipped.some(result => result.name === c.name))
        .map(c => ({ name: c.name, status: 'skipped', summary: 'database prerequisites failed' })));
    }
  } else {
    if (runsCtx === 'local' && remaining.some(c => c.database)) {
      try {
        prepareOwnedDatabase();
        const { assertOwnedDatabase } = await import('./local-db-control.mjs');
        assertOwnedDatabase();
      } catch (error) {
        results.push({ name: 'local-database', status: 'fail', blocking: true,
          summary: error.message, fix: 'rerun through this worktree\'s owned database wrapper' });
      }
    }
    if (results.some(result => result.status === 'fail' && result.blocking)) {
      skipped.push(...remaining.filter(c => !results.some(result => result.name === c.name))
        .map(c => ({ name: c.name, status: 'skipped', summary: 'local database setup failed' })));
    } else {
      // Build and tests share the API workspace; compile first rather than race its outputs.
      const pending = remaining.filter(c => !preDatabaseBuild.includes(c));
      const builds = pending.filter(c => c.name === 'build');
      results.push(...await runChecks(builds));
      if (!results.some(r => r.status === 'fail' && r.blocking)) results.push(...await runChecks(pending.filter(c => c.name !== 'build'), runsCtx === 'local'));
      else skipped.push(...pending.filter(c => c.name !== 'build').map(c => ({ name: c.name, status: 'skipped', summary: 'production build failed' })));
    }
  }
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
  const status = blockingFailed.length ? 1 : 0;
  return status;
}

if (isMain(import.meta.url)) {
  verify(process.argv.slice(2)).then(status => { process.exitCode = status; })
    .catch(error => { console.error(error); process.exitCode = 1; });
}
