import { deliveryTimingCases } from "./delivery-timing-cases";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const source = resolve(__dirname, "../..");
let root: string;
let guard: string;
let guardHead: string;
let inheritedGit: NodeJS.ProcessEnv;
function isolatedEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
}
let calls: string;
let cache: string;
let env: NodeJS.ProcessEnv;
const verdict = JSON.stringify({ lens: "correctness", verdict: "pass", findings: [] });
function git(...args: string[]) {
  return execFileSync("git", args, { cwd: root, env: isolatedEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function run(model = "fixture-model", provider = "claude", lens = "correctness") {
  return spawnSync("bash", ["scripts/review/run-lens.sh", "--local", lens], {
    cwd: root, encoding: "utf8", env: { ...env, FITSY_REVIEW_MODEL: model, FITSY_REVIEW_PROVIDER: provider }, timeout: 15000,
  });
}
function runPr(lens = "correctness", body = "") {
  writeFileSync(join(root, "pr-body"), body);
  const gh = join(root, "bin/gh-fixture");
  writeFileSync(gh, `#!/bin/sh
if [ "$1" = pr ] && [ "$2" = diff ]; then git diff --abbrev=8 origin/main...HEAD; exit; fi
if [ "$1" = pr ] && [ "$2" = view ]; then
  case "$5" in
    title) printf '%s\\n' 'Fixture change' ;;
    body) cat ${JSON.stringify(join(root, 'pr-body'))} ;;
    headRefOid) git rev-parse HEAD ;;
  esac
  exit
fi
if [ "$1" = api ]; then printf '%s\\n' "$*" >> "$REVIEW_TEST_GH_CALLS"; exit; fi
if [ "$1" = pr ] && [ "$2" = comment ]; then printf '%s\\n' "$*" >> "$REVIEW_TEST_GH_CALLS"; exit; fi
exit 1
`, { mode: 0o755 });
  return spawnSync("bash", ["scripts/review/run-lens.sh", "123", lens], {
    cwd: root, encoding: "utf8", env: { ...env, FITSY_REVIEW_MODEL: "fixture-model", FITSY_REVIEW_PROVIDER: "claude",
      FITSY_GH_BIN: gh, REVIEW_TEST_GH_CALLS: join(root, "gh-calls") }, timeout: 15000,
  });
}
beforeEach(() => {
  // A real hook environment points Git at its caller even when cwd changes.
  // Use a disposable caller repository so this regression cannot damage ours.
  inheritedGit = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("GIT_")));
  guard = mkdtempSync(join(tmpdir(), "fitsy-review-caller-"));
  const options = { cwd: guard, env: isolatedEnv(), encoding: "utf8" as const, stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"] };
  execFileSync("git", ["init", "-q"], options);
  execFileSync("git", ["-c", "user.name=Caller", "-c", "user.email=caller@example.test", "commit", "--allow-empty", "-qm", "caller"], options);
  guardHead = execFileSync("git", ["rev-parse", "HEAD"], options).trim();
  Object.assign(process.env, { GIT_DIR: join(guard, ".git"), GIT_WORK_TREE: guard, GIT_INDEX_FILE: join(guard, ".git/index"), GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "fixture.owner", GIT_CONFIG_VALUE_0: "caller" });
  root = mkdtempSync(join(tmpdir(), "fitsy-review-runner-"));
  calls = join(root, "calls"); cache = join(root, "cache");
  mkdirSync(join(root, "scripts/review"), { recursive: true });
  mkdirSync(join(root, "scripts/verify"), { recursive: true });
  mkdirSync(join(root, ".claude/lenses"), { recursive: true });
  mkdirSync(join(root, "bin"));
  for (const name of ["run-lens.sh", "execute-review.py", "extract-verdict.py", "format-comment.py", "review-gate.py", "review-budget.py", "tier.mjs"]) {
    cpSync(join(source, "scripts/review", name), join(root, "scripts/review", name));
  }
  cpSync(join(source, "scripts/verify/risk-tiers.yml"), join(root, "scripts/verify/risk-tiers.yml"));
  writeFileSync(join(root, "REVIEW.md"), "Review rules\n");
  writeFileSync(join(root, ".claude/lenses/correctness.md"), "Review correctness.\n");
  writeFileSync(join(root, "app.ts"), "export const value = 1;\n");
  const cli = `#!/usr/bin/env python3
import json,os,pathlib,sys
if '--version' in sys.argv:
 print('fixture-cli 1.0'); sys.exit(0)
with open(${JSON.stringify(calls)},'a') as f: f.write('called\\n')
result=pathlib.Path(${JSON.stringify(join(root, 'verdict'))}).read_text()
if '--output-last-message' in sys.argv:
 pathlib.Path(sys.argv[sys.argv.index('--output-last-message')+1]).write_text(result)
elif '-o' in sys.argv:
 pathlib.Path(sys.argv[sys.argv.index('-o')+1]).write_text(result)
print(json.dumps({'is_error':False,'result':result}))
sys.exit(int(pathlib.Path(${JSON.stringify(join(root, 'exit'))}).read_text()))
`;
  writeFileSync(join(root, "verdict"), verdict); writeFileSync(join(root, "exit"), "0");
  for (const name of ["claude", "codex"]) writeFileSync(join(root, "bin", name), cli, { mode: 0o755 });
  env = { ...isolatedEnv(), PATH: join(root, "bin") + ":" + process.env.PATH, FITSY_REVIEW_CACHE: cache,
    REVIEW_TEST_CALLS: calls, REVIEW_TEST_VERDICT: verdict };
  git("init", "-q"); git("config", "user.name", "Review fixture"); git("config", "user.email", "fixture@example.test");
  git("add", "."); git("commit", "-qm", "base"); git("update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(join(root, "app.ts"), "export const value = 2;\n"); git("add", "app.ts"); git("commit", "-qm", "change");
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) delete process.env[key];
  Object.assign(process.env, inheritedGit);
  try {
    const options = { cwd: guard, env: isolatedEnv(), encoding: "utf8" as const };
    expect(execFileSync("git", ["rev-parse", "HEAD"], options).trim()).toBe(guardHead);
    expect(execFileSync("git", ["for-each-ref", "--format=%(refname)"], options).trim().split("\n")).toHaveLength(1);
    expect(execFileSync("git", ["config", "--local", "--list"], options)).not.toContain("fixture@example.test");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(guard, { recursive: true, force: true });
  }
});
test("local caller runs independent CLI, records identity, and reuses only matching cache", () => {
  const first = run();
  expect(first.stderr).not.toContain("Traceback");
  expect(first.status).toBe(0);
  expect(JSON.parse(first.stdout)).toMatchObject({ verdict: "pass", reviewer: { provider: "claude", model: "fixture-model" } });
  expect(run().status).toBe(0);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
  expect(run("different-model").status).toBe(0);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(2);
});
test("local review uses the source-bound adoption permit after the historical cap", () => {
  const head = git("rev-parse", "HEAD").trim();
  const ledger = join(root, "adoption-budget.jsonl");
  writeFileSync(ledger, ["old-head-1", "old-head-2"].map((round, index) => JSON.stringify({
    event: "start", epoch: Date.now() / 1000, round_id: round, lens: "correctness",
    source_sha: round, attempt_id: `old-${index}`, exception: false,
  })).join("\n") + "\n");
  const permit = join(root, "adoption.json");
  writeFileSync(permit, JSON.stringify({ version: 1, kind: "one-time-adoption", source_sha: head,
    budget_seconds: 600, lens_timeouts: { correctness: 390, "test-quality": 190 }, authorization: "owner approval" }));
  env = { ...env, FITSY_REVIEW_BUDGET_LEDGER: ledger, FITSY_REVIEW_ADOPTION: permit,
    FITSY_REVIEW_TIMEOUT_SECONDS: "390" };
  expect(run().status).toBe(0);
  const events = readFileSync(ledger, "utf8").trim().split("\n").map(line => JSON.parse(line));
  expect(events.filter(event => event.event === "start" && event.adoption)).toHaveLength(1);
  const repeated = run("different-model");
  expect(repeated.status).toBe(1);
  expect(repeated.stderr).toContain("adoption lens already attempted");
});
test("local review uses a final delta closeout after an earlier adoption", () => {
  const head = git("rev-parse", "HEAD").trim();
  const ledger = join(root, "closeout-budget.jsonl");
  writeFileSync(ledger, ["old-head-1", "old-head-2"].map((round, index) => JSON.stringify({
    event: "start", epoch: Date.now() / 1000, round_id: round, lens: "correctness",
    source_sha: round, attempt_id: `old-${index}`, exception: false,
  })).join("\n") + "\n" + JSON.stringify({
    event: "start", epoch: Date.now() / 1000, round_id: "adopted-head", lens: "correctness",
    source_sha: "adopted-head", attempt_id: "old-adoption", adoption: true,
  }) + "\n" + JSON.stringify({
    event: "finish", elapsed_seconds: 60, round_id: "adopted-head", lens: "correctness",
    source_sha: "adopted-head", attempt_id: "old-adoption", adoption: true,
  }) + "\n");
  const permit = join(root, "closeout.json");
  writeFileSync(permit, JSON.stringify({ version: 1, kind: "final-delta-closeout", source_sha: head,
    budget_seconds: 600, lens_timeouts: { correctness: 390, "test-quality": 190 }, authorization: "final delta approval" }));
  env = { ...env, FITSY_REVIEW_BUDGET_LEDGER: ledger, FITSY_REVIEW_CLOSEOUT: permit,
    FITSY_REVIEW_TIMEOUT_SECONDS: "390" };
  expect(run().status).toBe(0);
  const events = readFileSync(ledger, "utf8").trim().split("\n").map(line => JSON.parse(line));
  expect(events.filter(event => event.event === "start" && event.closeout)).toHaveLength(1);
  const repeated = run("different-model");
  expect(repeated.status).toBe(1);
  expect(repeated.stderr).toContain("closeout lens already attempted");
});
test("nonzero external execution cannot publish or cache a partial pass", () => {
  writeFileSync(join(root, "exit"), "1");
  const result = run();
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ verdict: "incomplete", findings: [], error: { kind: "execution_error" } });
  expect(readdirSync(cache).filter(name => name.endsWith(".json"))).toHaveLength(0);
  const posted = runPr();
  expect(posted.status).toBe(1);
  expect(readFileSync(join(root, "gh-calls"), "utf8")).toContain("state=error");
  writeFileSync(join(root, "exit"), "0");
  expect(run().status).toBe(0);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(3);
});
test("invalid reviewer response is incomplete and cannot publish advisory success", () => {
  writeFileSync(join(root, ".claude/lenses/docs-sanity.md"), "Review documentation.\n");
  writeFileSync(join(root, "verdict"), '{"lens":"docs-sanity","verdict":"pass"');
  const local = run("fixture-model", "claude", "docs-sanity");
  expect(local.status).toBe(1);
  expect(JSON.parse(local.stdout)).toMatchObject({ verdict: "incomplete", findings: [], error: { kind: "invalid_output" } });
  expect(readdirSync(cache).filter(name => name.endsWith(".json"))).toHaveLength(0);
  const posted = runPr("docs-sanity");
  expect(posted.status).toBe(1);
  const postedCalls = readFileSync(join(root, "gh-calls"), "utf8");
  expect(postedCalls).toMatch(/state=error[\s\S]*Independent review incomplete/);
  expect(postedCalls).not.toMatch(/state=success|P1/);
});
test("provider identity separates cache entries", () => {
  expect(run().status).toBe(0);
  const codex = run("fixture-model", "codex");
  expect(codex.status).toBe(0);
  expect(JSON.parse(codex.stdout)).toMatchObject({ reviewer: { provider: "codex" } });
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(2);
});
test("advisory docs findings remain visible without blocking the caller", () => {
  writeFileSync(join(root, ".claude/lenses/docs-sanity.md"), "Review documentation.\n");
  const advisory = { lens: "docs-sanity", verdict: "fail", findings: [{ severity: "CONFIRMED", priority: "P2", impact: "Setup instruction fails for new developers", file: "docs/setup.md", line: 3, summary: "Missing command", scenario: "Setup command fails", fix: "Use the existing command" }] };
  writeFileSync(join(root, "verdict"), JSON.stringify(advisory));
  const result = run("fixture-model", "claude", "docs-sanity");
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject(advisory);
});
test("plausible findings retain their raw comment-only status without a disposition", () => {
  writeFileSync(join(root, "verdict"), JSON.stringify({ lens: "correctness", verdict: "pass", findings: [{
    severity: "PLAUSIBLE", priority: "P2", impact: "A rare input may fail", file: "app.ts", line: 1,
    summary: "Possible edge case", scenario: "Rare input may fail", fix: "Investigate the input",
  }] }));
  const result = run();
  expect(result.status).toBe(0);
  expect(result.stderr).toContain("no confirmed findings");
});
const impact = { user_outcome: "Native proof starts", trigger: "Historical movie without ffprobe", scope: "No-video simulator run", evidence: "review58 reproduction", contract: "Optional video tools" };
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function failingReview(priority: "P1" | "P2") {
  const finding = { severity: "CONFIRMED", priority, impact: "A no-video run stops before its required flow", file: "scripts/sim/xctest-attachments.mjs", line: 81,
    summary: "Historical movie requires ffprobe", scenario: "Historical movie and missing ffprobe -> run aborts", fix: "Classify only new movies" };
  writeFileSync(join(root, "verdict"), JSON.stringify({ lens: "correctness", verdict: "fail", findings: [finding] }));
  const first = run();
  expect(first.status).toBe(1);
  expect(JSON.parse(first.stdout)).toMatchObject({ verdict: "fail", findings: [{ priority }] });
  const match = first.stderr.match(/\[run-lens\] gate: (\{[^\n]+\})/);
  expect(match).not.toBeNull();
  const identity = JSON.parse(match![1]!).identity;
  const receiptPath = ".evidence/review-tests/verify.json";
  mkdirSync(join(root, ".evidence/review-tests"), { recursive: true });
  const receipt = JSON.stringify({ id: "verify", source_sha: git("rev-parse", "HEAD").trim(), command: "npm run verify", result: "pass", exit_code: 0, finished_at: "2026-09-25T12:00:00Z" });
  writeFileSync(join(root, receiptPath), receipt);
  const disposition = { version: 1, lens: "correctness", ...identity, findings: [{ index: 0, finding_sha256: hash(stable(finding)), priority,
    disposition: priority === "P1" ? "block" : "defer", impact, owner: "shipping follow-up", acceptance: "No-video historical movie snapshot works",
    required_tests: [{ id: "verify", receipt: receiptPath, sha256: hash(receipt) }] }] };
  const dir = join(root, ".evidence/review-dispositions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "correctness.json"), JSON.stringify(disposition));
  return { first, disposition, receiptPath };
}
test("deferred P2 passes the effective gate while raw failure and cache stay intact", () => {
  failingReview("P2");
  const accepted = run();
  expect(accepted.status).toBe(0);
  expect(JSON.parse(accepted.stdout)).toMatchObject({ verdict: "fail", findings: [{ priority: "P2" }] });
  expect(accepted.stderr).toContain('"gate": "pass"');
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
  const posted = runPr();
  if (posted.status !== 0) throw new Error(posted.stderr);
  expect(posted.status).toBe(0);
  expect(JSON.parse(posted.stdout)).toMatchObject({ verdict: "fail" });
  expect(readFileSync(join(root, "gh-calls"), "utf8")).toContain("state=success");
});
test("P1 remains blocking even with a complete disposition", () => {
  failingReview("P1");
  const rejected = run();
  expect(rejected.status).toBe(1);
  expect(rejected.stderr).toContain("P0/P1 finding blocks");
  const posted = runPr();
  if (posted.status !== 1) throw new Error(posted.stderr);
  expect(readFileSync(join(root, "gh-calls"), "utf8")).toContain("state=failure");
});
test("malformed disposition and missing required test fail closed", () => {
  const { disposition, receiptPath } = failingReview("P2");
  const path = join(root, ".evidence/review-dispositions/correctness.json");
  writeFileSync(path, JSON.stringify({ ...disposition, findings: [{ ...disposition.findings[0], disposition: "pass" }] }));
  expect(run().status).toBe(1);
  writeFileSync(path, JSON.stringify(disposition));
  rmSync(join(root, receiptPath));
  const missing = run();
  expect(missing.status).toBe(1);
  expect(missing.stderr).toContain("missing required test receipt");
});
test("stale source-bound receipt and changed review inputs cannot reuse a pass", () => {
  const { disposition, receiptPath } = failingReview("P2");
  const receipt = JSON.parse(readFileSync(join(root, receiptPath), "utf8"));
  receipt.source_sha = "old-head";
  const bytes = JSON.stringify(receipt);
  writeFileSync(join(root, receiptPath), bytes);
  disposition.findings[0].required_tests[0].sha256 = hash(bytes);
  writeFileSync(join(root, ".evidence/review-dispositions/correctness.json"), JSON.stringify(disposition));
  expect(run().stderr).toContain("failed or stale required test");
  writeFileSync(join(root, "REVIEW.md"), "Changed review policy\n");
  expect(run().status).toBe(1);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(2);
});
test("new head rejects an old disposition even with a current required-test receipt", () => {
  const { disposition, receiptPath } = failingReview("P2");
  expect(run().status).toBe(0);
  git("commit", "--amend", "-qm", "same diff, new head");
  const receipt = JSON.parse(readFileSync(join(root, receiptPath), "utf8"));
  receipt.source_sha = git("rev-parse", "HEAD").trim();
  const bytes = JSON.stringify(receipt);
  writeFileSync(join(root, receiptPath), bytes);
  disposition.findings[0].required_tests[0].sha256 = hash(bytes);
  writeFileSync(join(root, ".evidence/review-dispositions/correctness.json"), JSON.stringify(disposition));
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("stale disposition identity");
});
deliveryTimingCases({ root: () => root, env: () => env, source, run, runPr, git });
