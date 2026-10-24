import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const source = resolve(__dirname, "../..");
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fitsy-context-freshness-"));
  for (const dir of ["scripts/verify", "apps/api", "apps/mobile"]) mkdirSync(join(root, dir), { recursive: true });
  copyFileSync(join(source, "scripts/verify/context-freshness.sh"), join(root, "scripts/verify/context-freshness.sh"));
  for (const path of ["AGENTS.md", "CLAUDE.md", "apps/api/CLAUDE.md", "apps/mobile/CLAUDE.md", "scripts/CLAUDE.md", "apps/mobile/FEATURE_MAP.md"]) {
    writeFileSync(join(root, path), "Context\n");
  }
  writeFileSync(join(root, "package.json"), '{"scripts":{"verify":"true"}}');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function check() {
  return spawnSync("bash", ["scripts/verify/context-freshness.sh"], { cwd: root, encoding: "utf8" });
}
test("root instructions are checked for stale commands", () => {
  expect(check().status).toBe(0);
  writeFileSync(join(root, "AGENTS.md"), "Run npm run missing-script.\n");
  const result = check();
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("AGENTS.md->npm-run:missing-script");
});
