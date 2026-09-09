import { mkdtempSync, writeFileSync, symlinkSync, rmSync, readFileSync, mkdirSync, copyFileSync } from "node:fs";
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
const run = (runs = "ci", ci = "") => spawnSync("/bin/bash", [join(root, "scripts/verify/actionlint.sh")], { env: { PATH: directory, FITSY_RUNS: runs, CI: ci }, encoding: "utf8" });
test.each([["ci", ""], ["local", "true"]])("CI rejects missing actionlint via FITSY_RUNS=%s CI=%s", (runs, ci) => {
  tool("shellcheck"); const result = run(runs, ci); expect(result.status).toBe(1); expect(JSON.parse(result.stdout).status).toBe("fail");
});
test("CI rejects missing ShellCheck even when actionlint exists", () => {
  tool("actionlint"); const result = run(); expect(result.status).toBe(1); expect(JSON.parse(result.stdout).summary).toContain("shellcheck");
});
test.each([0, 1])("installed tool exit %i determines the check verdict", code => {
  tool("actionlint", code); tool("shellcheck"); const result = run(); expect(result.status).toBe(code); expect(JSON.parse(result.stdout).status).toBe(code ? "fail" : "pass");
});
test.each([false, true])("local callers explicitly skip incomplete tools (actionlint installed: %s)", installed => {
  if (installed) tool("actionlint");
  const result = run("local"); expect(result.status).toBe(2); expect(JSON.parse(result.stdout).status).toBe("skipped");
});
test("workflow lint cannot be scoped away for an API-only PR", () => {
  const registry = readFileSync(join(root, "scripts/verify/registry.yml"), "utf8");
  const entry = registry.split("  - name: actionlint\n")[1]!.split("\n  - name:")[0]!;
  const verify = join(directory, "scripts/verify"); mkdirSync(verify, { recursive: true });
  copyFileSync(join(root, "scripts/verify/run.mjs"), join(verify, "run.mjs"));
  writeFileSync(join(verify, "registry.yml"), "checks:\n  - name: actionlint\n" + entry);
  writeFileSync(join(verify, "actionlint.sh"), '#!/bin/sh\nprintf \'{"name":"actionlint","status":"pass"}\\n\'\n');
  // The real selector sees an API-only diff; only external git/tool execution is stubbed.
  writeFileSync(join(directory, "git"), '#!/bin/sh\nprintf "apps/api/services/search.ts\\n"\n', { mode: 0o755 });
  symlinkSync("/bin/bash", join(directory, "bash"));
  symlinkSync(join(root, "node_modules"), join(directory, "node_modules"));
  const result = spawnSync(process.execPath, [join(verify, "run.mjs"), "--layer=0-1", "--runs=ci", "--scope=changed"], { env: { PATH: directory, CI: "" }, encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout.trim())).toMatchObject({ name: "actionlint", status: "pass", blocking: true });
});
