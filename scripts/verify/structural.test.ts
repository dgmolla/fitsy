import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const root = resolve(__dirname, "../..");
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_") && !key.startsWith("FITSY_DIFF_")));
const gitBinary = process.platform === "darwin" ? "/Applications/Xcode.app/Contents/Developer/usr/bin/git"
  : execFileSync("/bin/sh", ["-c", "command -v git"], { env: environment, encoding: "utf8" }).trim();
environment.PATH = [dirname(gitBinary), dirname(process.execPath), "/bin", "/usr/bin", environment.PATH].join(":");
let directory: string;
const git = (...args: string[]) => execFileSync(gitBinary, args, { cwd: directory, env: environment, encoding: "utf8" });

beforeEach(() => {
  // Node canonicalizes the entrypoint path, including macOS temporary aliases.
  directory = realpathSync(mkdtempSync(join(tmpdir(), "fitsy-structural-")));
  for (const path of ["apps/api/lib", "apps/mobile", "packages/shared", "scripts/verify"]) mkdirSync(join(directory, path), { recursive: true });
  for (const path of ["scripts/structural-tests.sh", "scripts/verify/structural.sh", "scripts/verify/run.mjs", "scripts/verify/impact-plan.mjs"]) copyFileSync(join(root, path), join(directory, path));
  symlinkSync(join(root, "node_modules"), join(directory, "node_modules"));
  writeFileSync(join(directory, "scripts/verify/structural-allowlist.txt"), "");
  writeFileSync(join(directory, "scripts/verify/registry.yml"), "checks:\n  - name: structural\n    script: structural.sh\n    layer: 0\n    blocking: true\n    runs: [ci]\n");
  git("init", "-q"); git("config", "user.name", "Structural fixture"); git("config", "user.email", "fixture@example.test");
  git("add", "."); git("commit", "-qm", "baseline"); git("update-ref", "refs/remotes/origin/main", "HEAD");
  // One cohesive exported catalog exceeds the retired file-length quota.
  const catalog = "export const catalog = [\n" + Array.from({ length: 512 }, (_, index) => `  "catalog-entry-${index}",`).join("\n") + "\n] as const;\n";
  writeFileSync(join(directory, "apps/api/lib/catalog.ts"), catalog);
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function verify() {
  git("add", "."); git("commit", "-qm", "candidate");
  return spawnSync(process.execPath, [join(directory, "scripts/verify/run.mjs"), "--only=structural", "--stage=cheap", "--runs=ci", "--scope=changed"], {
    cwd: directory, env: environment, encoding: "utf8", timeout: 10000,
  });
}

test("a cohesive source module passes the canonical structural caller regardless of file length", () => {
  const result = verify();
  expect(result.error).toBeUndefined();
  if (result.status !== 0) throw new Error(result.stdout + "\n" + result.stderr);
  expect(JSON.parse(result.stdout)).toMatchObject({ name: "structural", status: "pass", blocking: true });
});

test("the same canonical caller still refuses unguarded subscriber data", () => {
  const route = join(directory, "apps/api/app/api/restaurants"); mkdirSync(route, { recursive: true });
  writeFileSync(join(route, "route.ts"), "export const GET = () => Response.json([]);\n");
  const result = verify();
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ name: "structural", status: "fail", blocking: true });
  expect(result.stderr).toContain("Subscription gating invariant violated");
});

test("a release review packet passes the canonical documentation layout check", () => {
  mkdirSync(join(directory, "docs/release"), { recursive: true });
  writeFileSync(join(directory, "docs/release/next-submission.md"), "# Submission review packet\n");
  const result = verify();
  expect(result.error).toBeUndefined();
  if (result.status !== 0) throw new Error(result.stdout + "\n" + result.stderr);
  expect(JSON.parse(result.stdout)).toMatchObject({ name: "structural", status: "pass", blocking: true });
});

test.each(["misc", "releases"])("an unrelated docs/%s domain is still rejected", domain => {
  mkdirSync(join(directory, "docs", domain), { recursive: true });
  writeFileSync(join(directory, "docs", domain, "notes.md"), "# Notes\n");
  const result = verify();
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ name: "structural", status: "fail", blocking: true });
  expect(result.stderr).toContain(`docs/${domain}/ is not an allowed domain`);
});

test("release preparation does not permit loose tracked documents at the docs root", () => {
  mkdirSync(join(directory, "docs"));
  writeFileSync(join(directory, "docs/submission.md"), "# Submission\n");
  const result = verify();
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ name: "structural", status: "fail", blocking: true });
  expect(result.stderr).toContain("submission.md is a file directly in docs/");
});
