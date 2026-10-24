import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

test("builds before acquiring the modeled owned database and reports the full selection", () => {
  const verify = join(directory, "scripts/verify");
  writeFileSync(join(verify, "registry.yml"), `checks:
  - name: build
    script: build.sh
    layer: 3
    blocking: true
    runs: [local]
  - name: test
    script: test.sh
    layer: 2
    blocking: true
    database: true
    runs: [local]
`);
  writeFileSync(join(verify, "build.sh"), `#!/bin/bash
test -z "$FITSY_VERIFY_DB_LOCKED$FITSY_VERIFY_OWNED_DB$POSTGRES_PRISMA_URL$POSTGRES_URL_NON_POOLING" || exit 1
printf 'build\\n' >> order.log
printf '%s\\n' '{"summary":"build checked"}'
exit "\${FAIL_BUILD:-0}"
`);
  writeFileSync(join(verify, "test.sh"), `#!/bin/bash
printf 'test\\n' >> order.log
[ "$FITSY_VERIFY_OWNED_DB" = owned ] || exit 1
printf '%s\\n' '{"summary":"database test checked"}'
exit "\${FAIL_TEST:-0}"
`);
  writeFileSync(join(verify, "local-db-control.mjs"), `import { appendFileSync } from 'node:fs';
const event = value => appendFileSync('order.log', value + '\\n');
export function assertOwnedDatabase(env = process.env) {
  event('db-assert');
  if (env.FITSY_VERIFY_OWNED_DB !== 'owned') throw Error('modeled database owner mismatch');
}
export async function runWithLocalDatabase(args) {
  // Model the actual locked CLI's internal deferred preparation callback.
  // Import the same runner instead of marking the DB owned before its build.
  const { verify } = await import('./run.mjs');
  return verify(args, () => {
    event('db-acquire');
    if (process.env.FAIL_DB === '1') throw Error('modeled database acquisition failed');
    return { ...process.env, FITSY_VERIFY_OWNED_DB: 'owned' };
  });
}
`);
  for (const args of [["init", "-q", "-b", "main"], ["config", "user.name", "Fixture"],
    ["config", "user.email", "fixture@example.test"], ["add", "."], ["commit", "-qm", "fixture"],
    ["update-ref", "refs/remotes/origin/main", "HEAD"]]) {
    const git = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
    expect(git.status).toBe(0);
  }
  const command = [join(verify, "run.mjs"), "--layer=all", "--scope=all", "--runs=local"];
  // This copied target owns its Git comparison and acquisition, independently of the caller.
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(GIT_|GITHUB_|FITSY_DIFF_|FITSY_RUNS$|CI$|PR_NUMBER$)/.test(key) &&
    !key.startsWith("FITSY_VERIFY_") && !key.startsWith("FITSY_SHIPPING_") &&
    !["FITSY_LOCAL_DB", "POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING"].includes(key)));
  const run = (extra: NodeJS.ProcessEnv = {}, extraArgs: string[] = []) => spawnSync(process.execPath, [...command, ...extraArgs],
    { cwd: directory, encoding: "utf8", timeout: 10000, env: { ...environment, ...extra } });
  const names = (stdout: string) => stdout.trim().split("\n").map(line => JSON.parse(line).name);

  const valid = run({ FITSY_VERIFY_DB_LOCKED: '1', POSTGRES_PRISMA_URL: 'postgresql://unowned' });
  expect(valid.error).toBeUndefined();
  expect({ status: valid.status, output: valid.status === 0 ? "" : `${valid.stdout}\n${valid.stderr}` })
    .toEqual({ status: 0, output: "" });
  expect(readFileSync(join(directory, "order.log"), "utf8").trim().split("\n"))
    .toEqual(["build", "db-acquire", "db-assert", "test"]);
  expect(names(valid.stdout).filter(name => name === "build")).toHaveLength(1);
  expect(names(valid.stdout).filter(name => name === "test")).toHaveLength(1);
  expect(valid.stderr).toContain("verify:");

  writeFileSync(join(directory, "order.log"), "");
  const buildFailed = run({ FAIL_BUILD: "1" });
  expect(buildFailed.status).toBe(1);
  expect(readFileSync(join(directory, "order.log"), "utf8").trim()).toBe("build");
  expect(buildFailed.stdout).toContain('"name":"build","status":"fail"');

  writeFileSync(join(directory, "order.log"), "");
  const databaseFailed = run({ FAIL_DB: "1" });
  expect(databaseFailed.status).toBe(1);
  expect(readFileSync(join(directory, "order.log"), "utf8").trim().split("\n"))
    .toEqual(["build", "db-acquire"]);
  expect(databaseFailed.stdout).toContain('"name":"build","status":"pass"');

  writeFileSync(join(directory, "order.log"), "");
  const testFailed = run({ FAIL_TEST: "1" });
  expect(testFailed.status).toBe(1);
  expect(readFileSync(join(directory, "order.log"), "utf8").trim().split("\n"))
    .toEqual(["build", "db-acquire", "db-assert", "test"]);
  expect(testFailed.stdout).toContain('"name":"test","status":"fail"');

  writeFileSync(join(directory, "order.log"), "");
  const forged = run({ FITSY_VERIFY_OWNED_DB: "forged" });
  expect(forged.status).toBe(1);
  expect(readFileSync(join(directory, "order.log"), "utf8")).not.toContain("test");
  expect(forged.stdout).toContain("modeled database owner mismatch");

  expect(run({}, ["--only=unknown"]).status).toBe(1);
});
