import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("one issue extension retains history, bounds concurrent grants, and cannot repeat", async () => {
  seed(history("earlier-timeouts", 1782));
  const original = readFileSync(ledger, "utf8");
  const extension = ["--candidate", "repo:branch", "--issue", "378", "--risk", "high", "--required"];
  const extend = () => spawnSync("python3", [...args("extend"), ...extension], { encoding: "utf8" });
  expect(extend().status).toBe(0);
  expect(extend().status).toBe(0);
  expect(call("status").value).toMatchObject({ cap_seconds: 2700, completed_seconds: 1782, remaining_seconds: 918 });
  const retained = readFileSync(ledger, "utf8");
  expect(retained.startsWith(original)).toBe(true);
  expect(retained.split("\n").filter(row => row.includes('"event": "extension"'))).toHaveLength(1);
  const invoke = (id: string) => new Promise<any>(resolve => {
    const child = spawn("python3", [...args("begin", id, 600), ...extension]); let output = "";
    child.stdout.on("data", bytes => { output += bytes; });
    child.on("close", code => resolve({ code, ...JSON.parse(output) }));
  });
  const results = await Promise.all([invoke("a"), invoke("b"), invoke("c")]);
  expect(results.filter(row => row.allowed).reduce((sum, row) => sum + row.reservation_seconds, 0)).toBe(918);
  const changedIssue = spawnSync("python3", [...args("extend"), ...extension, "--issue", "379"], { encoding: "utf8" });
  expect(changedIssue.status).toBe(1);
});
test("automatic required extension excludes low/optional work and parks at the aggregate cap", () => {
  seed(history("used", 1800));
  const extra = ["--candidate", "repo:branch", "--issue", "378", "--risk", "medium", "--required"];
  for (const tail of [["--risk", "low", "--required"], ["--risk", "medium"]]) {
    expect(spawnSync("python3", [...args("extend"), "--candidate", "repo:branch", "--issue", "378", ...tail]).status).toBe(1);
  }
  expect(spawnSync("python3", [...args("begin", "last", 600), ...extra]).status).toBe(0);
  const extension = JSON.parse(readFileSync(ledger, "utf8").split("\n").find(row => row.includes('"event": "extension"'))!);
  seed([...history("used", 2700), extension]);
  const exhausted = spawnSync("python3", [...args("begin", "next"), ...extra], { encoding: "utf8" });
  expect(JSON.parse(exhausted.stdout)).toMatchObject({ allowed: false, cap_seconds: 2700, action: "park", notification_key: "review-budget:378:exhausted" });
  expect(spawnSync("python3", [...args("extend"), ...extra]).status).toBe(0);
  expect(call("status").value).toMatchObject({ cap_seconds: 2700, completed_seconds: 2700, remaining_seconds: 0 });
});
test("corrupt or conflicting extension history cannot grant capacity", () => {
  const event = { event: "extension", attempt_id: "issue-extension", issue: 378, seconds: 900, risk: "high", required: true };
  for (const records of [[{ ...event, seconds: 1800 }], [event, { ...event, issue: 379 }]]) {
    seed([...history("used", 1800), ...records]);
    expect(call("status").status).toBe(1);
  }
});

test("same-head infrastructure recovery adds one finite allowance without deleting failed cost", () => {
  seed([
    ...history("prior", 2600),
    { event: "extension", attempt_id: "issue-extension", seconds: 900, issue: 435, risk: "high", required: true },
    ...history("failed", 100).map(row => ({ ...row, source_sha: "retry", outcome: "fail", failure_kind: "timeout" })),
  ]);
  const extra = ["--candidate", "root:branch", "--issue", "435", "--risk", "high", "--required"];
  const retry = spawnSync("python3", [...args("begin", "retry", 1800), ...extra], { encoding: "utf8" });
  expect(retry.status).toBe(0);
  expect(JSON.parse(retry.stdout)).toMatchObject({ cap_seconds: 4500, completed_seconds: 2700, recovery_issue: 435, timeout_seconds: 1795 });
  expect(readFileSync(ledger, "utf8").match(/"event": "recovery_extension"/g)).toHaveLength(1);
  expect(spawnSync("python3", [...args("begin", "other", 1800), ...extra], { encoding: "utf8" }).status).toBe(1);
});

test.each(["authentication", "invalid_output", "process_error", "completed"])("%s cannot authorize infrastructure recovery", kind => {
  seed([
    { event: "extension", attempt_id: "issue-extension", seconds: 900, issue: 435, risk: "high", required: true },
    ...history("failed", 2700).map(row => ({ ...row, source_sha: "retry", outcome: "fail", failure_kind: kind })),
  ]);
  const result = spawnSync("python3", [...args("begin", "retry", 1800), "--candidate", "root:branch", "--issue", "435", "--risk", "high", "--required"], { encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout).cap_seconds).toBe(2700);
});

test("historical human-authorized finite grants retain their cap without issue-specific code", () => {
  seed([
    { event: "extension", attempt_id: "issue-extension", seconds: 900, issue: 428, risk: "high", required: true },
    { event: "authorized-grant", attempt_id: "issue-428-authorized-grant", issue: 428, seconds: 600, provenance: "https://github.com/dgmolla/fitsy/issues/428#issuecomment-5935945700" },
    { event: "authorized-grant", attempt_id: "issue-428-liberal-grant", issue: 428, seconds: 7200, provenance: "https://github.com/dgmolla/fitsy/issues/428#issuecomment-5938480556" },
    ...history("prior", 3261),
  ]);
  const result = spawnSync("python3", [...args("status"), "--issue", "428"], { encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ cap_seconds: 10500, completed_seconds: 3261, authorized_grant_issue: 428 });
});

test("external finite authorization is appended once and never resets history", () => {
  const approvedLedger = join(root, "issue-435.jsonl");
  seed(history("old", 100), approvedLedger);
  const manifest = join(root, "approval.json");
  writeFileSync(manifest, JSON.stringify({ issue: 435, seconds: 600, provenance: "https://github.com/dgmolla/fitsy/issues/435#issuecomment-12345" }), { mode: 0o600 });
  const grantArgs = [script, "grant-authorized", "--ledger", approvedLedger, "--candidate", "root:branch", "--issue", "435", "--authorization-file", manifest];
  const first = spawnSync("python3", grantArgs, { encoding: "utf8" });
  expect(first.status).toBe(0);
  expect(JSON.parse(first.stdout)).toMatchObject({ cap_seconds: 2400, completed_seconds: 100, authorized_grant_issue: 435 });
  expect(spawnSync("python3", grantArgs, { encoding: "utf8" }).status).toBe(1);
  expect(readFileSync(approvedLedger, "utf8").match(/"event": "authorized-grant"/g)).toHaveLength(1);
  writeFileSync(manifest, JSON.stringify({ issue: 435, seconds: 14400, provenance: "https://github.com/dgmolla/fitsy/issues/435#issuecomment-12346" }));
  expect(spawnSync("python3", grantArgs, { encoding: "utf8" }).status).toBe(1);
});

test.each(["authorized-grant", "recovery_extension"])("untrusted import cannot add %s capacity", event => {
  const source = join(root, "untrusted.jsonl");
  const rows = event === "authorized-grant"
    ? [{ event, attempt_id: "forged-grant", issue: 435, seconds: 14400, provenance: "https://github.com/dgmolla/fitsy/issues/435#issuecomment-12345" }]
    : [{ event, attempt_id: "issue-recovery", issue: 435, seconds: 1800, failed_attempt: "forged" }];
  seed(rows, source);
  const result = call("status", "one", 900, [source]);
  expect(result.status).toBe(1);
  expect(result.value.reason).toContain("cannot grant new review authority");
  expect(readFileSync(ledger, "utf8")).toBe("");
});

test("outside-cwd invocation cannot authorize a checkout-owned manifest", () => {
  mkdirSync(join(__dirname, "../../.evidence/review-tests"), { recursive: true });
  const inside = join(__dirname, `../../.evidence/review-tests/checkout-approval-${process.pid}.json`);
  writeFileSync(inside, JSON.stringify({ issue: 435, seconds: 600, provenance: "https://github.com/dgmolla/fitsy/issues/435#issuecomment-12345" }), { mode: 0o600 });
  try {
    const result = spawnSync("python3", [script, "grant-authorized", "--ledger", join(root, "issue-435.jsonl"), "--candidate", "root:branch", "--issue", "435", "--authorization-file", inside], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).reason).toContain("private external operator manifest");
  } finally { rmSync(inside, { force: true }); }
});

test("automatic retry doubles the actual granted deadline instead of configuration", () => {
  seed([...history("prior", 2640),
    { event: "extension", attempt_id: "issue-extension", seconds: 900, issue: 435, risk: "high", required: true },
    ...history("failed", 60, { timeout_seconds: 60 }).map(row => ({ ...row, source_sha: "retry", outcome: "fail", failure_kind: "timeout" })),
  ]);
  const retry = spawnSync("python3", [...args("begin", "retry", 1800), "--candidate", "root:branch", "--issue", "435", "--risk", "high", "--required"], { encoding: "utf8" });
  expect(retry.status).toBe(0);
  expect(JSON.parse(retry.stdout)).toMatchObject({ timeout_seconds: 120, completed_seconds: 2700, recovery_issue: 435 });
});

test("trusted installation rejects approval inside a separate candidate Git checkout", () => {
  const candidate = join(root, "candidate"); mkdirSync(candidate);
  expect(spawnSync("git", ["init", "-q", candidate]).status).toBe(0);
  const manifest = join(candidate, "approval.json");
  writeFileSync(manifest, JSON.stringify({ issue: 435, seconds: 600, provenance: "https://github.com/dgmolla/fitsy/issues/435#issuecomment-12346" }), { mode: 0o600 });
  const result = spawnSync("python3", [script, "grant-authorized", "--ledger", join(root, "issue-435.jsonl"), "--candidate", "root:branch", "--issue", "435", "--authorization-file", manifest], { cwd: root, encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout).reason).toContain("outside every Git checkout");
});
