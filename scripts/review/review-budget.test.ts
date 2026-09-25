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
function call(action: "begin" | "finish", round: string, lens = "correctness", exception?: string) {
  const id = `${round}-${lens}-${count}`;
  if (action === "begin") count++;
  const attempt = action === "finish" ? `${round}-${lens}-${count}` : id;
  const args = [script, action, "--ledger", ledger, "--round-id", round, "--lens", lens, "--source-sha", round, "--attempt-id", attempt];
  if (exception) args.push("--exception", exception);
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
