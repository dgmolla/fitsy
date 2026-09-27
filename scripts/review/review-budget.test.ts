import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(__dirname, "review-budget.py");
let root: string;
let ledger: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "fitsy-review-budget-")); ledger = join(root, "events.jsonl"); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function args(action: string, id = "one", timeout = 900, imports: string[] = []) {
  return [script, action, "--ledger", ledger, "--round-id", id, "--lens", "correctness",
    "--source-sha", id, "--attempt-id", id, "--timeout-seconds", String(timeout),
    ...imports.flatMap(path => ["--import-ledger", path])];
}
function call(action: string, id = "one", timeout = 900, imports: string[] = []) {
  const result = spawnSync("python3", args(action, id, timeout, imports), { encoding: "utf8" });
  return { ...result, value: JSON.parse(result.stdout) };
}
function history(id: string, seconds: number, flags = {}) {
  return [{ event: "start", epoch: Date.now() / 1000 - seconds, round_id: id, lens: "correctness", source_sha: id, attempt_id: id, ...flags },
    { event: "finish", elapsed_seconds: seconds, round_id: id, lens: "correctness", source_sha: id, attempt_id: id, ...flags }];
}
function seed(events: unknown[], path = ledger) { writeFileSync(path, events.map(row => JSON.stringify(row)).join("\n") + "\n"); }

test("completed source rounds and failed outcomes count time without a head limit", () => {
  for (const id of ["head-1", "head-2", "head-3", "head-4"]) {
    expect(call("begin", id).status).toBe(0);
    expect(call("finish", id).status).toBe(0);
  }
  expect(call("status").value).toMatchObject({ rounds: 4, unfinished_attempts: [], reserved_seconds: 0 });
  expect(call("status").value.completed_seconds).toBeGreaterThan(0);
});
test("remaining time bounds the grant, including closeout reserve", () => {
  seed(history("earlier", 1770));
  const granted = call("begin", "new-head", 900);
  expect(granted.status).toBe(0);
  expect(granted.value).toMatchObject({ timeout_seconds: 25, reservation_seconds: 30, completed_seconds: 1770 });
  expect(call("begin", "other-lens").status).toBe(1);
});
test("concurrent invocations atomically reserve the same remaining pool", async () => {
  const invoke = (id: string) => new Promise<any>((resolve, reject) => {
    const child = spawn("python3", args("begin", id, 1200));
    let output = "";
    child.stdout.on("data", bytes => { output += bytes; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, ...JSON.parse(output) }));
  });
  const results = await Promise.all([invoke("first"), invoke("second"), invoke("third")]);
  const admitted = results.filter(row => row.allowed);
  expect(admitted).toHaveLength(2);
  expect(admitted.reduce((sum, row) => sum + row.reservation_seconds, 0)).toBe(1800);
  expect(admitted.map(row => row.timeout_seconds).sort((a, b) => a - b)).toEqual([590, 1200]);
  expect(call("status").value.remaining_seconds).toBe(0);
});
test("legacy exceptions and failed or timed out work all consume the same cap", () => {
  seed([...history("ordinary", 500), ...history("exception", 600, { exception: true }),
    ...history("adoption", 400, { adoption: true }), ...history("closeout", 301, { closeout: true })]);
  const before = readFileSync(ledger, "utf8");
  const denied = call("begin", "another-head");
  expect(denied.status).toBe(1);
  expect(denied.value).toMatchObject({ completed_seconds: 1801, remaining_seconds: 0 });
  expect(readFileSync(ledger, "utf8")).toBe(before);
});
test("legacy permit arguments never extend cumulative time", () => {
  seed(history("used", 1800));
  const permit = join(root, "permit.json"); writeFileSync(permit, "{}");
  for (const option of ["--exception", "--adoption", "--closeout"]) {
    const result = spawnSync("python3", [...args("begin"), option, permit], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).completed_seconds).toBe(1800);
  }
});
test("append-only imports retain flags, deduplicate copies and import later finishes", () => {
  const old = join(root, "old.jsonl"); const copied = join(root, "copied.jsonl");
  const prior = [...history("ordinary", 120), ...history("repair", 50, { exception: true })];
  seed(prior, old); seed(prior, copied);
  const original = readFileSync(old, "utf8");
  expect(call("status", "one", 900, [old, copied]).value.completed_seconds).toBe(170);
  const imported = readFileSync(ledger, "utf8");
  expect(JSON.parse(imported).events).toEqual(prior);
  expect(call("status", "one", 900, [old, copied]).value.completed_seconds).toBe(170);
  expect(readFileSync(ledger, "utf8")).toBe(imported);
  expect(readFileSync(old, "utf8")).toBe(original);
  const later = history("later", 30, { closeout: true });
  seed([...prior, later[0]], old);
  expect(call("status", "one", 900, [old]).value).toMatchObject({ completed_seconds: 170, reserved_seconds: 1800, remaining_seconds: 0, unfinished_attempts: ["later"] });
  seed([...prior, ...later], old);
  expect(call("status", "one", 900, [old]).value).toMatchObject({ completed_seconds: 200, reserved_seconds: 0, remaining_seconds: 1600, unfinished_attempts: [] });
  expect(readFileSync(ledger, "utf8").startsWith(imported)).toBe(true);
});
test("conflicting history and unbounded unfinished legacy execution refuse admission", () => {
  seed(history("old", 100));
  const conflict = join(root, "conflict.jsonl"); seed(history("old", 200), conflict);
  expect(call("begin", "new", 900, [conflict]).value.reason).toContain("conflicting");
  seed(history("unfinished", 20).slice(0, 1));
  expect(call("begin", "new").value).toMatchObject({ allowed: false, reserved_seconds: 1800, unfinished_attempts: ["unfinished"] });
});
test("closeout validates identity, releases unused reservation, and cannot repeat", () => {
  expect(call("begin", "one", 60).status).toBe(0);
  const mismatch = spawnSync("python3", [...args("finish", "one"), "--lens", "test-quality"], { encoding: "utf8" });
  expect(mismatch.status).toBe(1);
  expect(call("finish").status).toBe(0);
  expect(call("finish").status).toBe(1);
  expect(call("status").value.reserved_seconds).toBe(0);
  expect(call("begin", "two", 900).status).toBe(0);
});
test("malformed time and invalid requested deadlines fail closed", () => {
  for (const seconds of [-1, 0, 3601]) expect(call("begin", "one", seconds).status).toBe(1);
  seed([{ ...history("old", 10)[0], epoch: "unknown" }]);
  expect(call("begin").status).toBe(1);
});

test("explicit missing histories fail while absent optional defaults are allowed", () => {
  const missing = join(root, "missing.jsonl");
  const explicit = call("begin", "required", 60, [missing]);
  expect(explicit.status).toBe(1);
  expect(explicit.value.reason).toContain("missing required review ledger");
  const optional = spawnSync("python3", [...args("begin", "optional", 60), "--optional-import-ledger", missing], { encoding: "utf8" });
  expect(optional.status).toBe(0);
  expect(call("status").value.unfinished_attempts).toEqual(["optional"]);
});
