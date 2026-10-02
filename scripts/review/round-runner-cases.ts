import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
    headRefOid) git rev-parse HEAD ;;
    headRefName) git branch --show-current ;;
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


test("cache normalizes optional hunk labels but preserves actual patch content", () => {
  expect(run().status).toBe(0);
  const diff = git("diff", "--abbrev=8", "origin/main...HEAD");
  writeFileSync(join(root, "pr-diff"), diff.replace(/(@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@).*$/gm, "$1 function example"));
  expect(runPr().status).toBe(0);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
  writeFileSync(join(root, "pr-diff"), diff.replace("+export const value = 2;", "+export const value = 3;"));
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

}
