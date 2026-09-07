#!/usr/bin/env node
/**
 * Registry-driven check runner. One implementation, every caller:
 * the pre-push hook, CI jobs, agents, and `npm run verify` all come here.
 *
 *   node scripts/verify/run.mjs [--layer=0-2|all] [--scope=changed|all]
 *                               [--runs=local|ci|scheduled] [--only=name,...]
 *
 * Reads scripts/verify/registry.yml, filters checks by layer, run context and
 * (for --scope=changed) path globs against the diff vs origin/main, runs them
 * in parallel, and prints one JSON result line per check plus a summary.
 * Exit 1 if any BLOCKING check fails; shadow failures are reported only.
 *
 * Check contract (scripts/verify/README.md): exit 0 pass / 1 fail / 2 skipped;
 * last stdout line is JSON {name, status, summary, fix}.
 */
import { execFile } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

const VERIFY_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(VERIFY_DIR, "..", "..");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  }),
);
const layerArg = args.layer ?? "all";
const scope = args.scope ?? "changed";
const runsCtx = args.runs ?? (process.env.CI ? "ci" : "local");
const only = args.only ? new Set(args.only.split(",")) : null;

const [layerMin, layerMax] =
  layerArg === "all" ? [0, 99] : layerArg.includes("-") ? layerArg.split("-").map(Number) : [Number(layerArg), Number(layerArg)];

function changedFiles() {
  const tries = ["git diff --name-only origin/main...HEAD", "git diff --name-only HEAD^ HEAD"];
  for (const cmd of tries) {
    try {
      const out = execSync(cmd, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      return out ? out.split("\n") : [];
    } catch {
      /* next */
    }
  }
  return null; // unknown -> run everything
}

function globToRegExp(glob) {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*|\*/g, (m) => (m === "**" ? ".*" : "[^/]*"));
  return new RegExp(`^${re}$`);
}

const registry = yaml.load(readFileSync(join(VERIFY_DIR, "registry.yml"), "utf8"));
const files = scope === "changed" ? changedFiles() : null;

const selected = [];
const skipped = [];
for (const c of registry.checks) {
  if (only && !only.has(c.name)) continue;
  if (!only) {
    if (c.standalone) continue;
    if (c.layer < layerMin || c.layer > layerMax) continue;
    if (c.runs && !c.runs.includes(runsCtx)) continue;
    if (files && c.paths?.length) {
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
  selected.push(c);
}

function runCheck(c) {
  if (c.missing) {
    return Promise.resolve({ name: c.name, status: "fail", summary: `registry entry has no script ${c.script}`, fix: "add the script or remove the entry", blocking: c.blocking !== "shadow" });
  }
  return new Promise((resolve) => {
    const t0 = Date.now();
    execFile("bash", [join(VERIFY_DIR, c.script), `--scope=${scope}`], { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, FITSY_RUNS: runsCtx } }, (err, stdout, stderr) => {
      const code = err ? (err.code ?? 1) : 0;
      let parsed;
      try {
        parsed = JSON.parse(stdout.trim().split("\n").at(-1));
      } catch {
        parsed = { name: c.name, summary: (stderr || stdout).trim().split("\n").at(-1)?.slice(0, 200) ?? "" };
      }
      resolve({
        ...parsed,
        name: c.name,
        status: code === 0 ? "pass" : code === 2 ? "skipped" : "fail",
        duration_ms: Date.now() - t0,
        blocking: c.blocking !== "shadow",
        stderr: code === 1 ? stderr.slice(-4000) : undefined,
      });
    });
  });
}

const results = await Promise.all(selected.map(runCheck));
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
process.exit(blockingFailed.length ? 1 : 0);
