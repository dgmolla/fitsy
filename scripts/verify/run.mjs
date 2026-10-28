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
 * line per check plus a summary. Complete stdout/stderr logs are retained under
 * .evidence/verify/logs in a fresh directory for every invocation.
 * Exit 1 if any BLOCKING check fails; shadow failures are reported only.
 *
 * Check contract (scripts/verify/README.md): exit 0 pass / 1 fail / 2 skipped;
 * last stdout line is JSON {name, status, summary, fix}.
 */
import { spawn } from "node:child_process";
import { closeSync, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { impactPlan, focusedDatabaseRequired, isMain } from "./impact-plan.mjs";

export async function verify(argv, prepareDatabase) {
  // Clear shell startup selectors before checks launch nested npm or Bash shells.
  for (const key of Object.keys(process.env)) {
    if (key === 'BASH_ENV' || key === 'ENV' || key.startsWith('BASH_FUNC_')) delete process.env[key];
  }

  const VERIFY_DIR = dirname(fileURLToPath(import.meta.url));
  const REPO_ROOT = join(VERIFY_DIR, "..", "..");
  const require = createRequire(import.meta.url);
  const lockfile = join(REPO_ROOT, "package-lock.json");
  const packages = existsSync(lockfile) ? JSON.parse(readFileSync(lockfile, "utf8")).packages : {};
  const missing = [];
  for (const [workspace, pkg] of Object.entries(packages ?? {})) {
    if (workspace.split("/").includes("node_modules")) continue;
    const from = createRequire(join(REPO_ROOT, workspace, "package.json"));
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      if (pkg.optionalDependencies?.[name]) continue;
      // Check hoisted and nested packages without executing them or relying on
      // entrypoints/package.json exports (some type-only packages have neither).
      if (!from.resolve.paths(name)?.some(path => existsSync(join(path, name, "package.json")))) {
        missing.push(`${workspace || "."}: ${name}`);
      }
    }
  }
  if (!existsSync(join(REPO_ROOT, "node_modules/js-yaml")) || missing.length) {
    console.log(JSON.stringify({ name: "dependencies", status: "fail",
      summary: "verification dependencies are missing" + (missing.length ? `: ${missing.join(", ")}` : ""),
      fix: "run npm ci before verification" }));
    return 1;
  }
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
  const only = args.only === undefined ? null : new Set(args.only.split(","));
  if (only?.has("")) throw new Error("--only requires at least one check name");
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
  if (runsCtx === 'local') console.error(`Simulator scope: ${plan.simulator.scope}; ${plan.simulator.reason}; flows: ${plan.simulator.flows.join(', ') || 'none'}`);
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
    selected.push(c);
  }
  if (!selected.length) {
    for (const result of skipped) console.log(JSON.stringify(result));
    throw new Error('no verification checks selected');
  }
  const cheap = selected.filter(c => !isAcceptance(c));
  const remaining = selected.filter(isAcceptance);
  const needsDatabase = remaining.some(c => c.database) || cheap.some(c => c.name === 'focused-tests' &&
    (c.database || focusedDatabaseRequired([])));
  if (needsDatabase && !prepareDatabase && !process.env.FITSY_VERIFY_OWNED_DB) {
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
      // Unknown parent history must not become a narrower child comparison.
      const checkArgs = [`--scope=${c.name === 'test' && plan.comparison.unknown ? 'all' : scope}`];
      if (c.name === 'test' && scope === 'changed' && !plan.comparison.unknown) {
        checkArgs.push(`--base=${plan.comparison.base}`);
        // changedFiles still includes local dirty and untracked inputs.
        checkArgs.push(`--head=${plan.comparison.head}`);
      }
      return { env: checkEnv, args: ['-p', join(VERIFY_DIR, c.script), ...checkArgs] };
  }

  const logsRoot = join(REPO_ROOT, '.evidence/verify/logs');
  mkdirSync(logsRoot, { recursive: true });
  const logsDir = mkdtempSync(join(logsRoot, 'run-'));
  // Read only the tail, expanding when the final JSON line itself is longer.
  function logTail(file, completeLine = false) {
    const fd = openSync(file, 'r');
    try {
      const size = fstatSync(fd).size;
      let length = Math.min(size, 10000);
      while (true) {
        const buffer = Buffer.alloc(length);
        readSync(fd, buffer, 0, length, size - length);
        const text = buffer.toString('utf8');
        if (!completeLine || length === size || text.trimEnd().includes('\n')) return text;
        length = Math.min(size, length * 2);
      }
    } finally { closeSync(fd); }
  }

  function runCheck(c, options) {
    if (c.missing) {
      return Promise.resolve({ name: c.name, status: "fail", summary: `registry entry has no script ${c.script}`, fix: "add the script or remove the entry", blocking: true });
    }
    return new Promise((resolve) => {
      const t0 = Date.now();
      const input = checkInputs(c, options);
      const logs = Object.fromEntries(['stdout', 'stderr'].map(stream =>
        [stream, relative(REPO_ROOT, join(logsDir, `${c.name}.${stream}.log`))]));
      // Direct child writes keep full logs available even if the parent exits,
      // without execFile's output buffer limit killing a verbose test suite.
      const descriptors = [];
      let child;
      try {
        for (const file of Object.values(logs)) descriptors.push(openSync(join(REPO_ROOT, file), 'wx', 0o600));
        child = spawn('/bin/bash', input.args, { cwd: REPO_ROOT, env: input.env,
          stdio: ['ignore', ...descriptors] });
      } finally {
        for (const fd of descriptors) closeSync(fd);
      }
      let spawnError;
      child.on('error', error => { spawnError = error; });
      child.on('close', (code, signal) => {
        const stdout = logTail(join(REPO_ROOT, logs.stdout), true);
        const stderr = logTail(join(REPO_ROOT, logs.stderr));
        let parsed;
        try {
          parsed = JSON.parse(stdout.trim().split("\n").at(-1));
        } catch {
          parsed = { name: c.name, summary: spawnError?.message ?? (signal ? `terminated by ${signal}` :
            (stderr || stdout).trim().split("\n").at(-1)?.slice(0, 200) ?? "") };
        }
        const status = code === 0 && parsed.status !== "fail" ? "pass" : code === 2 ? "skipped" : "fail";
        resolve({
          ...parsed,
          name: c.name,
          status,
          duration_ms: Date.now() - t0,
          blocking: c.blocking !== "shadow",
          logs,
          output: status === 'fail' ? [stdout && `stdout (last 10000 bytes):\n${stdout.slice(-10000)}`,
            stderr && `stderr (last 10000 bytes):\n${stderr}`].filter(Boolean).join('\n') : undefined,
        });
      });
    });
  }

  async function runChecks(checks, sequential = false) {
    if (!sequential) return Promise.all(checks.map(c => runCheck(c)));
    const results = [];
    for (const check of checks) results.push(await runCheck(check));
    return results;
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
  // A full build remains database-free and precedes real acquisition.
  // The same pipeline then prepares the DB and runs its selected focused/full
  // checks, so neither a second runner nor a skipped-cheap trust marker is needed.
  const preDatabaseBuild = needsDatabase
    ? remaining.filter(c => c.name === 'build' && !c.database) : [];
  if (preDatabaseBuild.length && !results.some(result => result.status === 'fail' && result.blocking)) {
    for (const build of preDatabaseBuild) results.push(await runCheck(build, { withoutDatabase: true }));
  }
  if ((databaseFocused || fullContextFocused) && !results.some(result => result.status === 'fail' && result.blocking)) {
    try {
      prepareOwnedDatabase();
      const { assertOwnedDatabase } = await import('./local-db-control.mjs');
      assertOwnedDatabase();
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
    // Hosted tests use the same owned target as local route fixtures, rather
    // than a separate service container that cannot satisfy their assertion.
    if (remaining.some(c => c.database)) {
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
    const { output, ...line } = r;
    console.log(JSON.stringify(line));
  }
  for (const r of results) {
    if (r.status === 'fail' && r.logs) console.error(`\n--- ${r.name} output ---\n${r.output}\nFull logs: ${r.logs.stdout}, ${r.logs.stderr}`);
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
