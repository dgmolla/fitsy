import { spawnSync } from "node:child_process";
import { join } from "node:path";

test("corrected review history reaches local and PR review callers", () => {
  const result = spawnSync("python3", ["-I", "-B", join(__dirname, "review-completed-accounting.test.py"),
    "RuntimeAccounting",
    "CompletedAdmission.test_corrected_history_reaches_local_pr_and_identity_callers"], {
    encoding: "utf8",
    timeout: 60000,
  });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr + (result.error?.message ?? ""));
  expect(result.status).toBe(0);
}, 65000);
