import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(__dirname, "review-budget.py");
let root: string;
let ledger: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "fitsy-review-admission-")); ledger = join(root, "events.jsonl"); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function seed(events: unknown[]) { writeFileSync(ledger, events.map(row => JSON.stringify(row)).join("\n") + "\n"); }
function call(action: string, id: string, extra: string[] = []) {
  const result = spawnSync("python3", [script, action, "--ledger", ledger, "--round-id", id,
    "--lens", "review-round", "--source-sha", id, "--attempt-id", id, ...extra], { encoding: "utf8" });
  return { ...result, value: JSON.parse(result.stdout) };
}
function history(id: string, seconds: number, lens = "review-round") {
  return [{ event: "start", epoch: Date.now() / 1000 - seconds, round_id: id, lens, source_sha: id, attempt_id: id },
    { event: "finish", elapsed_seconds: seconds, round_id: id, lens, source_sha: id, attempt_id: id, outcome: "pass", failure_kind: "completed" }];
}

test("completed failing verdict and incomplete execution remain distinct; legacy rows stay readable", () => {
  seed(history("legacy", 10));
  expect(call("begin", "finding").status).toBe(0);
  expect(call("finish", "finding", ["--outcome", "pass", "--verdict", "fail", "--failure-kind", "completed"]).status).toBe(0);
  expect(call("begin", "timeout").status).toBe(0);
  expect(call("finish", "timeout", ["--outcome", "fail", "--verdict", "incomplete", "--failure-kind", "timeout"]).status).toBe(0);
  const rows = readFileSync(ledger, "utf8").trim().split("\n").map(row => JSON.parse(row));
  expect(rows.find(row => row.attempt_id === "legacy" && row.event === "finish").verdict).toBeUndefined();
  expect(rows.find(row => row.attempt_id === "finding" && row.event === "finish")).toMatchObject({ outcome: "pass", verdict: "fail" });
  expect(rows.find(row => row.attempt_id === "timeout" && row.event === "finish")).toMatchObject({ outcome: "fail", verdict: "incomplete" });
  expect(call("status", "current").value).toMatchObject({ execution_outcomes: { pass: 2, fail: 1, interrupted: 0 }, review_verdicts: { pass: 0, fail: 1, incomplete: 1, legacy_unknown: 1 } });
});

test("required combined review denies 329 seconds after a 370 second completion without charging", () => {
  seed([...history("completed", 370),
    { event: "extension", attempt_id: "issue-extension", seconds: 900, issue: 438, risk: "medium", required: true },
    { event: "authorized-grant", attempt_id: "approved", issue: 438, seconds: 1800, provenance: "https://github.com/dgmolla/fitsy/issues/438#issuecomment-5965291371" },
    ...history("prior", 3796, "correctness")]);
  const before = readFileSync(ledger, "utf8");
  const result = call("begin", "new", ["--timeout-seconds", "900", "--candidate", "root:branch", "--issue", "438", "--risk", "medium", "--required"]);
  expect(result.status).toBe(1);
  expect(result.value).toMatchObject({ allowed: false, required_window_seconds: 900, remaining_seconds: 334 });
  expect(readFileSync(ledger, "utf8")).toBe(before);
});

test("capacity status raises the default window after a long completed round", () => {
  seed([{ event: "extension", attempt_id: "issue-extension", seconds: 900, issue: 438, risk: "medium", required: true },
    ...history("completed", 800)]);
  const result = call("status", "current", ["--required", "--risk", "medium"]);
  expect(result.status).toBe(0);
  expect(result.value).toMatchObject({ required_window_seconds: 1000, remaining_seconds: 1900, can_admit: true });
});

function bindLimit(baseline: number, max = baseline + 1800) {
  ledger = join(root, "issue-456.jsonl");
  const approval = join(root, "bound.json");
  writeFileSync(approval, JSON.stringify({ issue: 456, baseline_completed_seconds: baseline,
    completed_seconds_stop_at: max, new_rounds_max: 2, per_round_timeout_seconds_max: 900 }), { mode: 0o600 });
  return call("bind-limit", "current", ["--candidate", "root:branch", "--issue", "456", "--authorization-file", approval]);
}
const boundArgs = ["--candidate", "root:branch", "--issue", "456", "--required", "--risk", "high"];

test("prospective operator bound retains old costs and counts already executed retries", () => {
  ledger = join(root, "issue-456.jsonl");
  seed([...history("baseline", 5409), { event: "authorized-grant", attempt_id: "old-authority", issue: 456,
    seconds: 14400, provenance: "https://github.com/dgmolla/fitsy/issues/456#issuecomment-12345" }, ...history("after-one", 10)]);
  const before = readFileSync(ledger, "utf8");
  expect(bindLimit(5409).value).toMatchObject({ cap_seconds: 7209, completed_seconds: 5419, bounded_executions_used: 1 });
  expect(readFileSync(ledger, "utf8").startsWith(before)).toBe(true);
  const begin = call("begin", "after-two", [...boundArgs, "--timeout-seconds", "3600"]);
  expect(begin.status).toBe(0);
  expect(begin.value.timeout_seconds).toBe(900);
  expect(call("finish", "after-two", [...boundArgs, "--outcome", "fail", "--verdict", "incomplete", "--failure-kind", "timeout"]).status).toBe(0);
  const retained = readFileSync(ledger, "utf8");
  expect(call("begin", "third-head", boundArgs).status).toBe(1);
  expect(call("extend", "third-head", boundArgs).status).toBe(1);
  expect(call("grant-authorized", "third-head", boundArgs).status).toBe(1);
  expect(call("begin", "new-branch", [...boundArgs, "--candidate", "root:replacement"]).status).toBe(1);
  expect(bindLimit(5409).status).toBe(1);
  expect(readFileSync(ledger, "utf8")).toBe(retained);
});

test("new bound issue defaults stop after two executions without caller flags", () => {
  for (const id of ["first", "second"]) {
    const begin = call("begin", id, boundArgs);
    expect(begin.status).toBe(0);
    expect(begin.value.timeout_seconds).toBeLessThanOrEqual(900);
    expect(call("finish", id, boundArgs).status).toBe(0);
  }
  const before = readFileSync(ledger, "utf8");
  expect(call("begin", "third", boundArgs).status).toBe(1);
  expect(readFileSync(ledger, "utf8")).toBe(before);
});

test("binding refuses unfinished reservations and an invented history baseline", () => {
  ledger = join(root, "issue-456.jsonl");
  seed(history("prior", 100));
  expect(bindLimit(99).status).toBe(1);
  expect(call("begin", "active", boundArgs).status).toBe(0);
  expect(bindLimit(100).status).toBe(1);
});

test("bounded timeout overrides inflated observed duration without increasing deadline", () => {
  ledger = join(root, "issue-456.jsonl");
  seed([...history("prior", 1000), { event: "authorized-grant", attempt_id: "old-authority", issue: 456,
    seconds: 1800, provenance: "https://github.com/dgmolla/fitsy/issues/456#issuecomment-12345" }]);
  expect(bindLimit(1000).status).toBe(0);
  const begin = call("begin", "new", [...boundArgs, "--timeout-seconds", "3600"]);
  expect(begin.status).toBe(0);
  expect(begin.value).toMatchObject({ required_window_seconds: 900, timeout_seconds: 900 });
  expect(call("finish", "new", [...boundArgs, "--outcome", "pass", "--verdict", "pass", "--failure-kind", "timeout"]).status).toBe(1);
  expect(call("finish", "new", [...boundArgs, "--outcome", "fail", "--verdict", "incomplete", "--failure-kind", "timeout"]).status).toBe(0);
});


test("imported limit cannot reset the shared issue allowance", () => {
  ledger = join(root, "issue-456.jsonl");
  seed(history("prior", 100));
  expect(bindLimit(100).status).toBe(0);
  const bound = readFileSync(ledger, "utf8");
  const original = ledger;
  ledger = join(root, "replacement.jsonl");
  const result = call("status", "replacement", [...boundArgs, "--import-ledger", original]);
  expect(result.status).toBe(1);
  expect(result.value.reason).toContain("cannot grant new review authority");
  expect(readFileSync(original, "utf8")).toBe(bound);
});
