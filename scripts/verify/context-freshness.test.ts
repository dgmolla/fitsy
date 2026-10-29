import { execFileSync, spawnSync } from "node:child_process";
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
  execFileSync('git', ['init', '-q'], { cwd: root });
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

test('new package AGENTS files participate without a hard-coded file list', () => {
  mkdirSync(join(root, 'packages/shared'), { recursive: true });
  writeFileSync(join(root, 'packages/shared/AGENTS.md'), 'Run npm run missing-shared-test.\n');
  const result = check();
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('packages/shared/AGENTS.md->npm-run:missing-shared-test');
});

test.each(['apps/mobile', '@fitsy/mobile'])('workspace test commands accept the actual path or package name: %s', workspace => {
  writeFileSync(join(root, 'apps/mobile/package.json'), JSON.stringify({ name: '@fitsy/mobile' }));
  writeFileSync(join(root, 'apps/mobile/AGENTS.md'), `Run npm test -w ${workspace}.\n`);
  expect(check().status).toBe(0);
  writeFileSync(join(root, 'apps/mobile/AGENTS.md'), 'Run npm test -w @fitsy/missing.\n');
  expect(check().stdout).toContain('apps/mobile/AGENTS.md->workspace:@fitsy/missing');
});
