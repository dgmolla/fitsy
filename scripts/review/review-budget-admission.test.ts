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
