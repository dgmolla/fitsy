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

function verify({ commitCandidate = true, runs = "ci" } = {}) {
  if (commitCandidate) { git("add", "."); git("commit", "-qm", "candidate"); }
  return spawnSync(process.execPath, [join(directory, "scripts/verify/run.mjs"), "--only=structural", "--stage=cheap", "--runs=" + runs, "--scope=changed"], {
    cwd: directory, env: { ...environment, CI: runs === "ci" ? "true" : "", GITHUB_EVENT_NAME: "" }, encoding: "utf8", timeout: 10000,
  });
}

test.each([{ runs: "local", status: 0 }, { runs: "ci", status: 1 }])(
  "$runs checks the intended source when a forbidden cast is corrected before committing", ({ runs, status }) => {
    const source = join(directory, "apps/api/lib/catalog.ts");
    writeFileSync(source, "export const value = input as " + "any;\n");
    git("add", "."); git("commit", "-qm", "unsafe fixture");
    writeFileSync(source, "export const value: unknown = 1;\n");
    const result = verify({ commitCandidate: false, runs });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(status);
    expect(JSON.parse(result.stdout)).toMatchObject({ name: "structural", status: status === 0 ? "pass" : "fail" });
    if (status !== 0) expect(result.stderr).toContain("types added in this branch");
  },
);

test.each([false, true])("local checks refuse a newly added forbidden cast before commit (staged=%s)", staged => {
  const source = join(directory, "apps/api/lib/catalog.ts");
  git("add", "."); git("commit", "-qm", "safe catalog");
  writeFileSync(source, "export const value = input as " + "any;\n");
  if (staged) git("add", ".");
  const result = verify({ commitCandidate: false, runs: "local" });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ name: "structural", status: "fail" });
  expect(result.stderr).toContain("types added in this branch");
});

test("a cohesive source module passes the canonical structural caller regardless of file length", () => {
  const result = verify();
  expect(result.error).toBeUndefined();
  if (result.status !== 0) throw new Error(result.stdout + "\n" + result.stderr);
  expect(JSON.parse(result.stdout)).toMatchObject({ name: "structural", status: "pass", blocking: true });
});

test.each([
  { path: "scripts/local.test.ts", octets: [127, 0, 0, 1], note: " // loopback test fixture", status: 0 },
  { path: "apps/mobile/local.test.tsx", octets: [127, 0, 0, 1], note: " // loopback test fixture", status: 0 },
  { path: "scripts/local.test.ts", octets: [127, 0, 0, 1], note: "", status: 1 },
  { path: "apps/api/lib/local.ts", octets: [127, 0, 0, 1], note: " // loopback test fixture", status: 1 },
  ...[[192, 168, 1, 1], [10, 0, 0, 1], [172, 16, 0, 1], [172, 31, 0, 1]].map(octets => ({
    path: "scripts/local.test.ts", octets, note: " // loopback test fixture", status: 1,
  })),
])("only an explained loopback test fixture is allowed: $path $octets $note", ({ path, octets, note, status }) => {
  writeFileSync(join(directory, path), `export const url = 'http://${octets.join(".")}:8099';${note}\n`);
  const result = verify();
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(status);
  expect(JSON.parse(result.stdout)).toMatchObject({ name: "structural", status: status === 0 ? "pass" : "fail", blocking: true });
  if (status !== 0) expect(result.stderr).toContain("Hardcoded private IPs found");
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
