import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(__dirname, "review-budget.py");
let root: string;
let ledger: string;
let count: number;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "fitsy-review-budget-")); ledger = join(root, "events.jsonl"); count = 0; });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function call(action: "begin" | "finish", round: string, lens = "correctness", exception?: string, adoption?: string, timeout?: number) {
  const id = `${round}-${lens}-${count}`;
  if (action === "begin") count++;
  const attempt = action === "finish" ? `${round}-${lens}-${count - 1}` : id;
  const args = [script, action, "--ledger", ledger, "--round-id", round, "--lens", lens, "--source-sha", round, "--attempt-id", attempt];
  if (exception) args.push("--exception", exception);
  if (adoption) args.push("--adoption", adoption);
  if (timeout) args.push("--timeout-seconds", String(timeout));
  return spawnSync("python3", args, { encoding: "utf8" });
}
test("two source rounds permit all routed lenses but reject a third head", () => {
  expect(call("begin", "head-1").status).toBe(0);
  expect(call("begin", "head-1", "test-quality").status).toBe(0);
  expect(call("begin", "head-2").status).toBe(0);
  const capped = call("begin", "head-3");
  expect(capped.status).toBe(1);
  expect(JSON.parse(capped.stdout).reason).toBe("review cap reached");
  expect(readFileSync(ledger, "utf8").trim().split("\n")).toHaveLength(3);
});
test("30 minutes of measured review time stops another lens", () => {
  const now = Date.now() / 1000;
  writeFileSync(ledger, JSON.stringify({ event: "start", epoch: now - 1801, round_id: "head-1", lens: "correctness", source_sha: "head-1", attempt_id: "earlier", exception: false }) + "\n");
  expect(call("begin", "head-1", "test-quality").status).toBe(1);
});
test("completed review time counts toward the 30-minute cap", () => {
  expect(call("begin", "head-1").status).toBe(0);
  const started = JSON.parse(readFileSync(ledger, "utf8"));
  started.epoch -= 1801;
  writeFileSync(ledger, JSON.stringify(started) + "\n");
  expect(call("finish", "head-1").status).toBe(0);
  const events = readFileSync(ledger, "utf8").trim().split("\n").map(line => JSON.parse(line));
  expect(events[1].elapsed_seconds).toBeGreaterThanOrEqual(1800);
  const capped = call("begin", "head-1", "test-quality");
  expect(capped.status).toBe(1);
  expect(JSON.parse(capped.stdout).reason).toBe("review cap reached");
});
test("only a named high-impact exception admits scoped review after the cap", () => {
  expect(call("begin", "head-1").status).toBe(0);
  expect(call("begin", "head-2").status).toBe(0);
  const exception = join(root, "exception.json");
  writeFileSync(exception, JSON.stringify({ version: 1, priority: "P1", lens: "correctness", source_sha: "head-3",
    finding: "required evidence is invalid", realistic_impact: "cannot validate native flow", evidence: "receipt path",
    repair: "restore validation", exit_condition: "required flow receipt passes", owner: "shipping task", budget_seconds: 300 }));
  expect(call("begin", "head-3", "test-quality", exception).status).toBe(1);
  expect(call("begin", "head-3", "correctness", exception).status).toBe(0);
});
test("one-time adoption admits one bounded attempt per lens after the historical cap", () => {
  expect(call("begin", "old-1").status).toBe(0);
  expect(call("begin", "old-2").status).toBe(0);
  const permit = join(root, "adoption.json");
  writeFileSync(permit, JSON.stringify({ version: 1, kind: "one-time-adoption", source_sha: "new-head",
    budget_seconds: 600, lens_timeouts: { correctness: 390, "test-quality": 190 }, authorization: "owner approval" }));
  expect(call("begin", "new-head", "correctness", undefined, permit, 390).status).toBe(0);
  expect(call("finish", "new-head", "correctness").status).toBe(0);
  expect(call("begin", "new-head", "correctness", undefined, permit, 390).status).toBe(1);
  expect(call("begin", "other-head", "test-quality", undefined, permit, 190).status).toBe(1);
  expect(call("begin", "new-head", "test-quality", undefined, permit, 900).status).toBe(1);
  expect(call("begin", "new-head", "test-quality", undefined, permit, 190).status).toBe(0);
  expect(call("finish", "new-head", "test-quality").status).toBe(0);
  expect(call("begin", "new-head", "test-quality", undefined, permit, 190).status).toBe(1);
  const events = readFileSync(ledger, "utf8").trim().split("\n").map(line => JSON.parse(line));
  expect(events.filter(event => event.event === "start" && event.adoption)).toHaveLength(2);
});
test("adoption refuses a second lens when the aggregate deadline cannot hold it", () => {
  expect(call("begin", "old-1").status).toBe(0);
  expect(call("begin", "old-2").status).toBe(0);
  const permit = join(root, "adoption.json");
  writeFileSync(permit, JSON.stringify({ version: 1, kind: "one-time-adoption", source_sha: "new-head",
    budget_seconds: 600, lens_timeouts: { correctness: 390, "test-quality": 190 }, authorization: "owner approval" }));
  expect(call("begin", "new-head", "correctness", undefined, permit, 390).status).toBe(0);
  const events = readFileSync(ledger, "utf8").trim().split("\n").map(line => JSON.parse(line));
  events.at(-1).epoch -= 410;
  writeFileSync(ledger, events.map(event => JSON.stringify(event)).join("\n") + "\n");
  expect(call("finish", "new-head", "correctness").status).toBe(0);
  const denied = call("begin", "new-head", "test-quality", undefined, permit, 190);
  expect(denied.status).toBe(1);
  expect(JSON.parse(denied.stdout).reason).toBe("adoption aggregate deadline exhausted");
});
