import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const normalizeFixtureResponse = `try:
 value=json.loads(result)
 if 'lens' in value and 'error' not in value:
  domains=next(line.split(': ',1)[1].split() for line in prompt.splitlines() if line.startswith('Required domains: '))
  findings=[dict(f,domains=[value['lens']]) for f in value['findings']]
  value={'verdict':value['verdict'], 'domains':{d: ('fail' if any(f['severity']=='CONFIRMED' and d in f['domains'] for f in findings) else 'pass') for d in domains}, 'findings':findings}
  result=json.dumps(value)
except (ValueError,KeyError,StopIteration): pass`;

export function runPrFixture(root: string, env: NodeJS.ProcessEnv, lens = "correctness", body = "Delivery-Issue: #355\n", provider = "claude") {
  writeFileSync(join(root, "pr-body"), body);
  const gh = join(root, "bin/gh-fixture");
  writeFileSync(gh, `#!/bin/sh
if [ "$1" = pr ] && [ "$2" = diff ]; then
  if [ -f ${JSON.stringify(join(root, 'pr-diff'))} ]; then cat ${JSON.stringify(join(root, 'pr-diff'))}; else git diff --abbrev=8 origin/main...HEAD; fi
  exit
fi
if [ "$1" = pr ] && [ "$2" = view ]; then
  case "$5" in
    title) printf '%s\\n' 'Fixture change' ;;
    body) cat ${JSON.stringify(join(root, 'pr-body'))} ;;
    headRefOid)
      if [ -f ${JSON.stringify(join(root, 'race-head'))} ]; then
        n=$(cat ${JSON.stringify(join(root, 'race-head'))}); n=$((n+1)); printf '%s' "$n" > ${JSON.stringify(join(root, 'race-head'))}
        if [ "$n" -gt 1 ]; then printf '%040d\\n' 1; else git rev-parse HEAD; fi
      else git rev-parse HEAD; fi ;;
    headRefName) git branch --show-current ;;
    baseRefOid) git rev-parse origin/main ;;
  esac
  exit
fi
if [ "$1" = issue ] && [ "$2" = view ]; then
  if [ -f ${JSON.stringify(join(root, 'issue-fail'))} ]; then exit 1; fi
  cat ${JSON.stringify(join(root, 'issue-body'))}; exit
fi
if [ "$1" = api ]; then printf '%s\\n' "$*" >> "$REVIEW_TEST_GH_CALLS"; exit; fi
if [ "$1" = pr ] && [ "$2" = comment ]; then printf '%s\\n' "$*" >> "$REVIEW_TEST_GH_CALLS"; exit; fi
exit 1
`, { mode: 0o755 });
  return spawnSync("bash", ["scripts/review/run-lens.sh", "123", lens], {
    cwd: root, encoding: "utf8", env: { ...env, FITSY_REVIEW_MODEL: "fixture-model", FITSY_REVIEW_PROVIDER: provider,
      FITSY_GH_BIN: gh, REVIEW_TEST_GH_CALLS: join(root, "gh-calls") }, timeout: 15000,
  });
}

type Fixture = {
  root: () => string; calls: () => string; env: () => NodeJS.ProcessEnv;
  run: (model?: string, provider?: string, domain?: string) => SpawnSyncReturns<string>;
  runPr: (domain?: string, body?: string, provider?: string) => SpawnSyncReturns<string>;
  git: (...args: string[]) => string;
};
export function roundRunnerCases(fixture: Fixture) {
  const { run, runPr, git } = fixture;
  let root: string, calls: string;
  beforeEach(() => { root = fixture.root(); calls = fixture.calls(); });
test("one invocation covers all required domains and legacy callers reuse the whole round", () => {
  for (const domain of ["danger-zone", "workflow-security"]) writeFileSync(join(root, `.claude/lenses/${domain}.md`), `Review ${domain}.\n`);
  mkdirSync(join(root, "apps/api/lib"), { recursive: true });
  writeFileSync(join(root, "apps/api/lib/auth.ts"), "export const auth = true;\n");
  writeFileSync(join(root, "scripts/review/change.sh"), "echo review-control\n");
  git("add", "."); git("commit", "-qm", "sensitive controls");
  expect(run().status).toBe(0);
  expect(JSON.parse(runPr().stdout).domains).toEqual({ correctness: "pass", "danger-zone": "pass", "workflow-security": "pass" });
  expect(run("fixture-model", "claude", "danger-zone").status).toBe(0);
  expect(run("fixture-model", "claude", "workflow-security").status).toBe(0);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
  const posts = readFileSync(join(root, "gh-calls"), "utf8");
  for (const domain of ["correctness", "danger-zone", "workflow-security"]) expect(posts).toContain(`context=lens/${domain}`);
  expect(posts).toContain("context=review/round");
  const budget = readFileSync(join(root, "budgets/issue-355.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  expect(budget.filter(row => row.event === "start")).toHaveLength(1);
});

test("missing required domain refuses every passing projection", () => {
  writeFileSync(join(root, ".claude/lenses/workflow-security.md"), "Review controls.\n");
  writeFileSync(join(root, "scripts/review/change.sh"), "echo control\n");
  git("add", "."); git("commit", "-qm", "controls");
  writeFileSync(join(root, "verdict"), JSON.stringify({ verdict: "pass", domains: { correctness: "pass" }, findings: [] }));
  const result = runPr();
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout).verdict).toBe("incomplete");
  const posts = readFileSync(join(root, "gh-calls"), "utf8");
  expect(posts).not.toContain("state=success");
  expect(posts).toContain("context=lens/workflow-security");
  expect(posts).toContain("state=error");
});


test("local and PR share exact committed patch and changed source invalidates cache", () => {
  expect(run().status).toBe(0);
  const diff = git("diff", "--abbrev=8", "origin/main...HEAD");
  writeFileSync(join(root, "pr-diff"), diff.replace(/(@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@).*$/gm, "$1 function example"));
  expect(runPr().status).toBe(0);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
  writeFileSync(join(root, "app.ts"), "export const value = 3;\n");
  git("add", "app.ts"); git("commit", "-qm", "changed actual source");
  expect(runPr().status).toBe(0);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(2);
});

test("deleted sensitive files still require danger-zone coverage", () => {
  mkdirSync(join(root, "apps/api/lib"), { recursive: true });
  writeFileSync(join(root, "apps/api/lib/auth.ts"), "export const auth = true;\n");
  writeFileSync(join(root, ".claude/lenses/danger-zone.md"), "Review authorization.\n");
  git("add", "."); git("commit", "-qm", "sensitive baseline");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("rm", "apps/api/lib/auth.ts"); git("commit", "-qm", "delete auth");
  expect(JSON.parse(run().stdout).domains).toEqual({ correctness: "pass", "danger-zone": "pass" });
});


test("current input probe tracks acceptance without executing or charging a reviewer", () => {
  const probe = () => spawnSync("bash", ["scripts/review/run-review.sh", "--local", "--identity"], { cwd: root, env: { ...fixture.env(), FITSY_REVIEW_MODEL: "fixture-model", FITSY_REVIEW_PROVIDER: "claude" }, encoding: "utf8" });
  const first = probe();
  expect(first.status).toBe(0);
  writeFileSync(join(root, "issue-body"), "Acceptance: current required behavior changed.\n");
  const changed = probe();
  expect(changed.status).toBe(0);
  expect(JSON.parse(changed.stdout).cache_key).not.toBe(JSON.parse(first.stdout).cache_key);
  expect(existsSync(calls)).toBe(false);
  const budget = readFileSync(join(root, "budgets/issue-355.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  expect(budget.filter(row => row.event === "start")).toHaveLength(0);
});


test("PR budget denial withdraws every required result without executing a reviewer", () => {
  const rows = [
    { event: "extension", attempt_id: "issue-extension", seconds: 900, issue: 355, risk: "medium", required: true },
    { event: "recovery_extension", attempt_id: "issue-recovery", seconds: 1800, issue: 355, failed_attempt: "old" },
    { event: "start", epoch: Date.now() / 1000 - 4500, round_id: "old", lens: "correctness", source_sha: "old", attempt_id: "old" },
    { event: "finish", elapsed_seconds: 4500, round_id: "old", lens: "correctness", source_sha: "old", attempt_id: "old", outcome: "fail", failure_kind: "timeout" },
  ];
  mkdirSync(join(root, "budgets"), { recursive: true });
  writeFileSync(join(root, "budgets/issue-355.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  expect(runPr().status).toBe(1);
  expect(existsSync(calls)).toBe(false);
  const posts = readFileSync(join(root, "gh-calls"), "utf8");
  expect(posts).toContain("state=error");
  expect(posts).toContain("context=lens/correctness");
  expect(posts).toContain("context=review/round");
  expect(posts).not.toContain("state=success");
});

test("PR push during input gathering cannot launch or publish a wrong-head review", () => {
  writeFileSync(join(root, "race-head"), "0");
  const result = runPr();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("source changed during input gathering");
  expect(existsSync(calls)).toBe(false);
  expect(existsSync(join(root, "gh-calls"))).toBe(false);
});

test("PR patch comes from exact immutable commits rather than a separately fetched diff", () => {
  writeFileSync(join(root, "pr-diff"), git("diff", "--abbrev=8", "origin/main...HEAD").replace("+export const value = 2;", "+export const value = 999;"));
  expect(runPr().status).toBe(0);
  const prompt = readFileSync(join(root, "prompt"), "utf8");
  expect(prompt).toContain("+export const value = 2;");
  expect(prompt).not.toContain("+export const value = 999;");
});

test("manual added coverage survives default PR replacement after source changes", () => {
  writeFileSync(join(root, ".claude/lenses/workflow-security.md"), "Review controls.\n");
  git("add", ".claude/lenses/workflow-security.md"); git("commit", "-qm", "domain instructions");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(join(root, "app.ts"), "export const value = 3;\n");
  git("add", "app.ts"); git("commit", "-qm", "outside routed paths");
  expect(run("fixture-model", "claude", "workflow-security").status).toBe(0);
  writeFileSync(join(root, "app.ts"), "export const value = 4;\n");
  git("add", "app.ts"); git("commit", "-qm", "replacement source");
  expect(JSON.parse(runPr().stdout).domains).toEqual({ correctness: "pass", "workflow-security": "pass" });
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(2);
});

test("same patch on a new committed head requires a new review", () => {
  expect(run().status).toBe(0);
  git("commit", "--amend", "-qm", "new immutable source context");
  expect(run().status).toBe(0);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(2);
});

test.each(["binary", "mode"])("%s-only sensitive changes route and execute one round", kind => {
  writeFileSync(join(root, ".claude/lenses/workflow-security.md"), "Review controls.\n");
  writeFileSync(join(root, "scripts/review/change.sh"), kind === "binary" ? Buffer.from([0,1,2]) : "echo baseline\n", { mode: 0o644 });
  git("add", "."); git("commit", "-qm", "control baseline");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  if (kind === "binary") writeFileSync(join(root, "scripts/review/change.sh"), Buffer.from([0,3,4]));
  else { chmodSync(join(root, "scripts/review/change.sh"), 0o755); git("update-index", "--chmod=+x", "scripts/review/change.sh"); }
  if (kind === "binary") git("add", "scripts/review/change.sh");
  git("commit", "-qm", "control metadata change");
  expect(JSON.parse(run().stdout).domains).toEqual({ correctness: "pass", "workflow-security": "pass" });
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
});

test("cache-only revalidation cannot execute a missing independent result", () => {
  const result = spawnSync("bash", ["scripts/review/run-review.sh", "--local", "--cached-only"], { cwd: root, env: { ...fixture.env(), FITSY_REVIEW_MODEL: "fixture-model", FITSY_REVIEW_PROVIDER: "claude" }, encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("cache unavailable");
  expect(existsSync(calls)).toBe(false);
});

}

// Model the existing external trusted checkout without changing candidate refs.
export function seedManagedFixture(root: string, git: (...args: string[]) => string) {
  const managed = join(root, "old-poller/repo");
  git("clone", "--quiet", "--shared", "--no-checkout", root, managed);
  git("-C", managed, "update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD").trim());
  git("-C", managed, "remote", "set-url", "origin", "https://github.com/dgmolla/fitsy.git");
}
