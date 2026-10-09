import { spawnSync } from "node:child_process";
import { join } from "node:path";

// Reuse #443's prepared subprocess controls in the canonical scripts suite.
test("private prospective policy preserves history and enforces finite admission", () => {
  const result = spawnSync("python3", ["-I", join(__dirname, "test_review_execution_policy.py")], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  expect(result.status).toBe(0);
}, 15000);
