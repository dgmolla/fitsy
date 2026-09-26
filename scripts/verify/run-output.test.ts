import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(__dirname, "../..");
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "fitsy-verify-output-"));
  mkdirSync(join(directory, "scripts/verify"), { recursive: true });
  copyFileSync(join(root, "scripts/verify/run.mjs"), join(directory, "scripts/verify/run.mjs"));
  copyFileSync(join(root, "scripts/verify/impact-plan.mjs"), join(directory, "scripts/verify/impact-plan.mjs"));
  symlinkSync(join(root, "node_modules"), join(directory, "node_modules"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

test.each([true, "shadow"])("drains a failed check's full piped diagnostics with blocking=%s", blocking => {
  const payload = "diagnostic detail\n".repeat(65536) + "FINAL_DIAGNOSTIC_SENTINEL\n";
  const verify = join(directory, "scripts/verify");
  writeFileSync(join(verify, "registry.yml"), `checks:\n  - name: fixture\n    script: fixture.sh\n    layer: 2\n    blocking: ${blocking}\n    runs: [ci]\n`);
  writeFileSync(join(directory, "diagnostics.txt"), payload);
  writeFileSync(join(verify, "fixture.sh"), `#!/bin/bash\ncat diagnostics.txt >&2\nprintf '%s\\n' '{"summary":"fixture failure","fix":"fixture remedy"}'\nexit 1\n`);

  // Pipes reproduce the CI transport, where a forced Node exit can truncate writes.
  const result = spawnSync(process.execPath, [join(verify, "run.mjs"), "--scope=all", "--runs=ci"], {
    encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 10000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(blocking === true ? 1 : 0);
  expect(JSON.parse(result.stdout.trim())).toMatchObject({ name: "fixture", status: "fail", blocking: blocking === true });
  expect(result.stderr.startsWith(`\n--- fixture output ---\n${payload}\n`)).toBe(true);
  expect(result.stderr).toContain("FINAL_DIAGNOSTIC_SENTINEL\n");
  expect(result.stderr).toContain(blocking === true ? "verify: 0 pass, 1 fail" : "verify: 0 pass, 0 fail, 1 shadow-fail (fixture)");
  if (blocking === true) expect(result.stderr).toContain("FAIL fixture: fixture failure\n  fix: fixture remedy\n");
});
