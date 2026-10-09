import { execFileSync, spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Fixture = {
  root: () => string; setRoot: (value: string) => void;
  env: () => NodeJS.ProcessEnv; setEnv: (value: NodeJS.ProcessEnv) => void;
  calls: () => string; cache: () => string;
  run: (model?: string) => SpawnSyncReturns<string>;
  runPr: (lens?: string, body?: string) => SpawnSyncReturns<string>;
  git: (...args: string[]) => string; isolatedEnv: () => NodeJS.ProcessEnv;
};
// Register policy integration cases against the existing real executable fixture.
export function policyRunnerCases(fixture: Fixture) {
  const { run, runPr, git, isolatedEnv } = fixture;
  let root: string, calls: string, cache: string, env: NodeJS.ProcessEnv;
  beforeEach(() => { root = fixture.root(); calls = fixture.calls(); cache = fixture.cache(); env = fixture.env(); });
test("third source head is denied after two review executions despite remaining time", () => {
  for (let head = 1; head <= 2; head++) {
    writeFileSync(join(root, "app.ts"), `export const value = ${head + 2};\n`);
    git("add", "app.ts"); git("commit", "-qm", `candidate ${head}`);
    const result = run();
    if (result.status !== 0) throw new Error(`Head ${head}: ${result.stderr}`);
  }
  const ledger = join(root, "budgets/issue-355.jsonl");
  const retained = readFileSync(ledger, "utf8");
  writeFileSync(join(root, "app.ts"), "export const value = 5;\n");
  git("add", "app.ts"); git("commit", "-qm", "third candidate");
  const denied = run();
  expect(denied.status).toBe(1);
  expect(denied.stderr).toContain("issue execution limit exhausted");
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(2);
  expect(readFileSync(ledger, "utf8")).toBe(retained);
});
test("local and PR review share imported history without resetting exception time", () => {
  const ledger = join(root, ".evidence/review-budget.jsonl");
  const rows = ["exception", "adoption", "closeout"].flatMap((flag, index) => [
    { event: "start", epoch: Date.now() / 1000 - 50, round_id: `old-${index}`, lens: "correctness",
      source_sha: `old-${index}`, attempt_id: `old-${index}`, [flag]: true },
    { event: "finish", elapsed_seconds: 50, round_id: `old-${index}`, lens: "correctness",
      source_sha: `old-${index}`, attempt_id: `old-${index}`, [flag]: true },
  ]);
  writeFileSync(ledger, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  expect(run().status).toBe(0);
  const canonical = join(root, "budgets/issue-355.jsonl");
  expect(JSON.parse(readFileSync(canonical, "utf8").split("\n")[0]!)).toMatchObject({ event: "import", events: rows });
  const localRoot = root;
  const prRoot = mkdtempSync(join(tmpdir(), "fitsy-review-pr-"));
  const base = git("rev-parse", "origin/main").trim();
  execFileSync("git", ["clone", "-q", localRoot, prRoot], { env: isolatedEnv() });
  root = prRoot; fixture.setRoot(root);
  try {
    git("config", "user.name", "PR fixture"); git("config", "user.email", "fixture@example.test");
    git("update-ref", "refs/remotes/origin/main", base);
    writeFileSync(join(root, "app.ts"), "export const value = 9;\n");
    git("add", "app.ts"); git("commit", "-qm", "PR follow-up");
    // Issue bodies are ignored task context, so the PR clone needs its own brief.
    writeFileSync(join(root, "issue-body"), "Goal: Verify the changed issue binding.\nAcceptance: reject migration to issue 356.\n");
    const changedIssue = runPr("correctness", "Delivery-Issue: #356\n");
    expect(changedIssue.status).toBe(1);
    expect(changedIssue.stderr).toContain("candidate issue binding conflict");
    const result = runPr();
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/"completed_seconds": 15[0-9]/);
  } finally { root = localRoot; fixture.setRoot(root); rmSync(prRoot, { recursive: true, force: true }); }
  expect(readFileSync(ledger, "utf8").trim().split("\n")).toHaveLength(6);
});
test("a missing explicit historical ledger refuses any reviewer launch", () => {
  fixture.setEnv({ ...env, FITSY_REVIEW_BUDGET_IMPORT_LEDGER: join(root, "missing-history.jsonl") });
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("missing required review ledger");
  expect(existsSync(calls)).toBe(false);
});
test("a real shallow clone refuses review before deriving a candidate identity", () => {
  const original = root;
  const shallow = mkdtempSync(join(tmpdir(), "fitsy-shallow-review-"));
  execFileSync("git", ["clone", "-q", "--no-local", "--depth", "1", original, shallow], { env: isolatedEnv() });
  root = shallow; fixture.setRoot(root);
  try {
    expect(git("rev-parse", "--is-shallow-repository").trim()).toBe("true");
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("complete Git ancestry");
    expect(existsSync(calls)).toBe(false);
  } finally { root = original; fixture.setRoot(root); rmSync(shallow, { recursive: true, force: true }); }
});
test("full PR body is validated before limiting review prompt metadata", () => {
  const longBody = "Description ".repeat(410) + "\nDelivery-Issue: #355\n";
  expect(runPr("correctness", longBody).status).toBe(0);
  expect(runPr("correctness", "Delivery-Issue: #355\n" + longBody).status).toBe(1);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
});
test("insufficient capacity refuses execution before a short deadline is charged", () => {
  const rows = [
    { event: "extension", attempt_id: "issue-extension", seconds: 900, issue: 355, risk: "medium", required: true },
    { event: "recovery_extension", attempt_id: "issue-recovery", seconds: 1800, issue: 355, failed_attempt: "old" },
    { event: "start", epoch: Date.now() / 1000 - 4494, round_id: "old", lens: "correctness", source_sha: "old", attempt_id: "old" },
    { event: "finish", elapsed_seconds: 4494, round_id: "old", lens: "correctness", source_sha: "old", attempt_id: "old", outcome: "fail", failure_kind: "timeout" },
  ];
  mkdirSync(join(root, "budgets"), { recursive: true });
  writeFileSync(join(root, "budgets/issue-355.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("insufficient review capacity");
  const events = readFileSync(join(root, "budgets/issue-355.jsonl"), "utf8").trim().split("\n").map(row => JSON.parse(row));
  expect(events.at(-1)).toMatchObject({ event: "finish", outcome: "fail" });
  const status = spawnSync("python3", ["scripts/review/review-budget.py", "status", "--ledger", join(root, "budgets/issue-355.jsonl")], { cwd: root, encoding: "utf8" });
  expect(status.status).toBe(0);
  const total = JSON.parse(status.stdout);
  expect(total.completed_seconds).toBe(4494);
  expect(total.remaining_seconds).toBe(6);
  expect(run().status).toBe(1);
  expect(existsSync(calls)).toBe(false);
  expect(readdirSync(cache).filter(name => name.endsWith(".json"))).toHaveLength(0);
});
test("prospective policy default requests the available bounded execution window", () => {
  const directory = mkdtempSync(join(tmpdir(), "fitsy-private-review-policy-"));
  const policy = join(directory, "policy.json");
  const candidate = `${git("rev-list", "--max-parents=0", "HEAD").trim()}:${git("symbolic-ref", "--short", "HEAD").trim()}`;
  writeFileSync(policy, JSON.stringify({ issue: 355, candidate, seconds: 300, baseline: {},
    provenance: "https://github.com/dgmolla/fitsy/issues/355#issuecomment-123" }), { mode: 0o600 });
  fixture.setEnv({ ...env, FITSY_REVIEW_EXECUTION_POLICY: policy });
  try {
    const result = run();
    if (result.status !== 0) throw new Error(result.stderr);
    expect(JSON.parse(result.stdout).reviewer.timeout_seconds).toBe(295);
    expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("default CLI deadline grows to the observed admission window", () => {
  const rows = [
    { event: "extension", attempt_id: "issue-extension", seconds: 900, issue: 355, risk: "medium", required: true },
    { event: "start", epoch: Date.now() / 1000 - 800, round_id: "old", lens: "review-round", source_sha: "old", attempt_id: "old" },
    { event: "finish", elapsed_seconds: 800, round_id: "old", lens: "review-round", source_sha: "old", attempt_id: "old", outcome: "pass", failure_kind: "completed" },
  ];
  mkdirSync(join(root, "budgets"), { recursive: true });
  writeFileSync(join(root, "budgets/issue-355.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  const result = run();
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).reviewer.timeout_seconds).toBe(1000);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
});
test("poller retry timeout rises to the observed admission window", () => {
  const rows = [
    { event: "extension", attempt_id: "issue-extension", seconds: 900, issue: 355, risk: "medium", required: true },
    { event: "start", epoch: Date.now() / 1000 - 800, round_id: "old", lens: "review-round", source_sha: "old", attempt_id: "old" },
    { event: "finish", elapsed_seconds: 800, round_id: "old", lens: "review-round", source_sha: "old", attempt_id: "old", outcome: "pass", failure_kind: "completed" },
  ];
  mkdirSync(join(root, "budgets"), { recursive: true });
  writeFileSync(join(root, "budgets/issue-355.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  fixture.setEnv({ ...env, FITSY_REVIEW_TIMEOUT_SECONDS: "900", FITSY_REVIEW_TIMEOUT_FLOOR: "1" });
  const result = run();
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).reviewer.timeout_seconds).toBe(1000);
});
test("signal stops reviewer before releasing its reservation", async () => {
  writeFileSync(join(root, "delay"), "60");
  // Reproduce slow CLI startup before the reviewer publishes its ready PID.
  const cli = join(root, "bin/claude");
  writeFileSync(cli, readFileSync(cli, "utf8").replace("if '--version' in sys.argv:", "if '--version' in sys.argv: time.sleep(2.2)\nif '--version' in sys.argv:"), { mode: 0o755 });
  git("add", "bin/claude"); git("commit", "-qm", "slow provider fixture");
  const child = spawn("bash", ["scripts/review/run-lens.sh", "--local", "correctness"], {
    cwd: root, env: { ...env, FITSY_REVIEW_MODEL: "fixture-model", FITSY_REVIEW_PROVIDER: "claude" }, stdio: "ignore",
  });
  const done = new Promise(resolve => child.on("close", resolve));
  try {
    const deadline = Date.now() + 10_000;
    while (!existsSync(join(root, "reviewer-pid")) && child.exitCode === null && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(existsSync(join(root, "reviewer-pid"))).toBe(true);
  } finally {
    child.kill("SIGTERM");
    await done;
  }
  expect(() => process.kill(Number(readFileSync(join(root, "reviewer-pid"), "utf8")), 0)).toThrow();
  const events = readFileSync(join(root, "budgets/issue-355.jsonl"), "utf8").trim().split("\n").map(row => JSON.parse(row));
  expect(events.at(-1)).toMatchObject({ event: "finish", outcome: "interrupted" });
}, 20_000);
test("a completed verdict reuses cache after remaining time is exhausted", () => {
  mkdirSync(join(root, "budgets"), { recursive: true });
  const first = run();
  expect(first.status).toBe(0);
  expect(JSON.parse(first.stdout).reviewer.timeout_seconds).toBe(900);
  const ledger = join(root, "budgets/issue-355.jsonl");
  const spent = 1800 - JSON.parse(readFileSync(ledger, "utf8").trim().split("\n").at(-1)!).elapsed_seconds;
  const rows = [
    { event: "start", epoch: Date.now() / 1000 - spent, round_id: "old", lens: "correctness", source_sha: "old", attempt_id: "old" },
    { event: "finish", elapsed_seconds: spent, round_id: "old", lens: "correctness", source_sha: "old", attempt_id: "old", outcome: "fail", failure_kind: "timeout" },
  ];
  writeFileSync(ledger, readFileSync(ledger, "utf8") + rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  expect(runPr().status).toBe(0);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
  expect(run("new-model").status).toBe(1);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
});
test("poller legacy history imports before another independent PR review", () => {
  mkdirSync(join(root, "old-poller/budgets"), { recursive: true });
  const legacy = join(root, "old-poller/budgets/123.jsonl");
  writeFileSync(legacy, [
    { event: "extension", attempt_id: "issue-extension", seconds: 900, issue: 355, risk: "medium", required: true },
    { event: "start", epoch: Date.now() / 1000 - 2700, round_id: "old", lens: "correctness", source_sha: "old", attempt_id: "old", exception: true },
    { event: "finish", elapsed_seconds: 2700, round_id: "old", lens: "correctness", source_sha: "old", attempt_id: "old", exception: true },
  ].map(row => JSON.stringify(row)).join("\n") + "\n");
  const result = runPr();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('"completed_seconds": 2700');
  expect(existsSync(calls)).toBe(false);
});
test("confirmed P1 blocks even an otherwise advisory docs lens", () => {
  writeFileSync(join(root, ".claude/lenses/docs-sanity.md"), "Review documentation.\n");
  writeFileSync(join(root, "verdict"), JSON.stringify({ lens: "docs-sanity", verdict: "fail", findings: [{
    severity: "CONFIRMED", priority: "P1", impact: "Published operational instructions erase production data", file: "REVIEW.md", line: 1,
    summary: "Instructions target production", scenario: "Follow the procedure -> production data is removed", fix: "Require a disposable database",
  }] }));
  const result = runPr("docs-sanity");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("P0/P1 finding blocks");
  expect(readFileSync(join(root, "gh-calls"), "utf8")).toContain("state=failure");
});
test("confirmed P3 is advisory without hiding raw failure or finding priority", () => {
  writeFileSync(join(root, "verdict"), JSON.stringify({ lens: "correctness", verdict: "fail", findings: [{
    severity: "CONFIRMED", priority: "P3", impact: "Minor local diagnostic wording with no release acceptance impact", file: "app.ts", line: 1,
    summary: "Diagnostic wording is unclear", scenario: "Read diagnostic -> extra interpretation", fix: "Clarify the wording",
  }] }));
  const local = run();
  expect(local.status).toBe(0);
  expect(JSON.parse(local.stdout)).toMatchObject({ verdict: "fail", findings: [{ priority: "P3" }] });
  expect(local.stderr).toContain("P3 findings are advisory");
  expect(runPr().status).toBe(0);
  const posted = readFileSync(join(root, "gh-calls"), "utf8");
  expect(posted).toContain("state=success");
  expect(posted).toContain("P3");
});
}
