import { mkdtempSync, writeFileSync, symlinkSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
const root = resolve(__dirname, "../..");
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "fitsy-actionlint-"));
  symlinkSync(execFileSync("which", ["dirname"], { encoding: "utf8" }).trim(), join(directory, "dirname"));
});
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
const tool = (name: string, code = 0) => writeFileSync(join(directory, name), `#!/bin/sh\nexit ${code}\n`, { mode: 0o755 });
const run = () => spawnSync("/bin/bash", [join(root, "scripts/verify/actionlint.sh")], { env: { ...process.env, PATH: directory, FITSY_RUNS: "ci" }, encoding: "utf8" });
test("CI rejects missing actionlint instead of silently skipping", () => {
  tool("shellcheck"); const result = run(); expect(result.status).toBe(1); expect(JSON.parse(result.stdout).status).toBe("fail");
});
test("CI rejects missing ShellCheck even when actionlint exists", () => {
  tool("actionlint"); const result = run(); expect(result.status).toBe(1); expect(JSON.parse(result.stdout).summary).toContain("shellcheck");
});
test.each([0, 1])("installed tool exit %i determines the check verdict", code => {
  tool("actionlint", code); tool("shellcheck"); const result = run(); expect(result.status).toBe(code); expect(JSON.parse(result.stdout).status).toBe(code ? "fail" : "pass");
});
test("workflow lint cannot be scoped away for an API-only PR", () => {
  const registry = readFileSync(join(root, "scripts/verify/registry.yml"), "utf8");
  const entry = registry.split("  - name: actionlint\n")[1]!.split("\n  - name:")[0]!;
  expect(entry).not.toMatch(/^\s*paths:/m); expect(entry).toContain("blocking: true"); expect(entry).toContain("runs: [local, ci]");
});
