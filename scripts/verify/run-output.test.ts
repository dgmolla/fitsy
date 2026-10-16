import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

test("scopes an optional build heap to the production build command", () => {
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const npm = join(bin, "npm");
  writeFileSync(npm, `#!/bin/sh
printf '%s' "\${NODE_OPTIONS-}" > "$FITSY_NPM_STUB_OUTPUT"
exit "\${FITSY_NPM_STUB_EXIT:-0}"
`);
  chmodSync(npm, 0o700);
  const run = (name: string, heap?: string, exit = 0) => {
    const output = join(directory, name);
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, NODE_OPTIONS: "",
      FITSY_NPM_STUB_OUTPUT: output, FITSY_NPM_STUB_EXIT: String(exit) };
    delete env.FITSY_BUILD_HEAP_MIB;
    if (heap !== undefined) env.FITSY_BUILD_HEAP_MIB = heap;
    const result = spawnSync("/bin/bash", [join(root, "scripts/verify/build.sh")],
      { cwd: root, env, encoding: "utf8", timeout: 10000 });
    return { output, result };
  };
  const ordinary = run("ordinary");
  expect(ordinary.result.status).toBe(0);
  expect(readFileSync(ordinary.output, "utf8")).toBe("");
  const bounded = run("bounded", "384");
  expect(bounded.result.status).toBe(0);
  expect(readFileSync(bounded.output, "utf8")).toBe("--max-old-space-size=384");
  const invalid = run("invalid", "not-a-number");
  expect(invalid.result.status).toBe(1);
  expect(existsSync(invalid.output)).toBe(false);
  const failed = run("failed", "384", 7);
  expect(failed.result.status).toBe(1);
  expect(failed.result.stdout).toContain('"name":"build","status":"fail"');
});

test("keeps the public typecheck uncapped while scoping the build heap", () => {
  const verify = join(directory, "scripts/verify");
  copyFileSync(join(root, "scripts/verify/typecheck.sh"), join(verify, "typecheck.sh"));
  copyFileSync(join(root, "scripts/verify/build.sh"), join(verify, "build.sh"));
  writeFileSync(join(verify, "registry.yml"), `checks:
  - name: typecheck
    script: typecheck.sh
    layer: 1
    blocking: true
    runs: [ci]
  - name: build
    script: build.sh
    layer: 3
    blocking: true
    runs: [ci]
`);
  mkdirSync(join(directory, "apps/mobile"), { recursive: true });
  writeFileSync(join(directory, "apps/mobile/tsconfig.json"), "{}\n");
  const bin = join(directory, "bin");
  mkdirSync(bin);
  for (const command of ["npx", "npm"]) {
    const executable = join(bin, command);
    writeFileSync(executable, `#!/bin/sh
printf '%s:%s\\n' '${command}' "\${NODE_OPTIONS-}" >> "$FITSY_CHILD_STUB_LOG"
`);
    chmodSync(executable, 0o700);
  }
  const log = join(directory, "children.log");
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`,
    FITSY_BUILD_HEAP_MIB: "384", FITSY_CHILD_STUB_LOG: log };
  delete env.NODE_OPTIONS;
  const result = spawnSync(process.execPath,
    [join(verify, "run.mjs"), "--only=typecheck,build", "--scope=all", "--runs=ci"],
    { cwd: directory, env, encoding: "utf8", timeout: 10000 });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout.trim().split("\n").map(line => JSON.parse(line))).toMatchObject([
    { name: "typecheck", status: "pass" }, { name: "build", status: "pass" },
  ]);
  expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
    "npx:", "npm:--max-old-space-size=384",
  ]);
});

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

test.each([["ci", "cheap"], ["local", "cheap"], ["local", "full"]])("serializes %s %s-stage checks without resource overlap", (runs, stage) => {
  const verify = join(directory, "scripts/verify");
  writeFileSync(join(verify, "registry.yml"), `checks:
  - name: lint
    script: lint.sh
    layer: 1
    blocking: true
    runs: [ci, local]
  - name: typecheck
    script: typecheck.sh
    layer: 1
    blocking: true
    runs: [ci, local]
`);
  const check = `#!/bin/bash
set -eu
if ! mkdir active-cheap-check 2>/dev/null; then
  printf '%s\\n' '{"summary":"cheap checks overlapped","fix":"serialize cheap checks"}'
  exit 1
fi
sleep 0.2
rmdir active-cheap-check
printf '%s\\n' '{"summary":"check completed","fix":""}'
`;
  writeFileSync(join(verify, "lint.sh"), check);
  writeFileSync(join(verify, "typecheck.sh"), check);

  const result = spawnSync(process.execPath, [join(verify, "run.mjs"), `--stage=${stage}`, "--scope=all", `--runs=${runs}`], {
    encoding: "utf8", timeout: 10000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout.trim().split("\n").map(line => JSON.parse(line))).toMatchObject([
    { name: "lint", status: "pass" },
    { name: "typecheck", status: "pass" },
  ]);
});

test("runs local post-build acceptance checks without overlap and retains blocking failures", () => {
  const verify = join(directory, "scripts/verify");
  writeFileSync(join(verify, "registry.yml"), `checks:
  - name: product-flow
    script: product-flow.sh
    stage: acceptance
    layer: 1
    blocking: true
    runs: [local]
  - name: test
    script: test.sh
    layer: 2
    blocking: true
    runs: [local]
  - name: media-integration
    script: media-integration.sh
    layer: 2
    blocking: true
    runs: [local]
  - name: build
    script: build.sh
    layer: 3
    blocking: true
    runs: [local]
`);
  writeFileSync(join(verify, "build.sh"), `#!/bin/bash
printf 'build\\n' >> order.log
printf '%s\\n' '{"summary":"build completed"}'
`);
  const check = (name: string, fail = false) => `#!/bin/bash
set -eu
printf '${name}-start\\n' >> order.log
if ! mkdir active-post-build 2>/dev/null; then
  printf '%s\\n' '{"summary":"post-build overlap","fix":"serialize local checks"}'
  exit 1
fi
sleep 0.15
rmdir active-post-build
printf '${name}-end\\n' >> order.log
printf '%s\\n' '{"summary":"${fail ? "intended failure" : "check completed"}"}'
exit ${fail ? 1 : 0}
`;
  for (const name of ["product-flow", "test", "media-integration"]) writeFileSync(join(verify, `${name}.sh`), check(name));
  const command = [join(verify, "run.mjs"), "--stage=full", "--layer=all", "--scope=all", "--runs=local"];
  const run = () => spawnSync(process.execPath, command, { cwd: directory, encoding: "utf8", timeout: 10000 });
  const first = run();
  expect(first.error).toBeUndefined();
  expect(first.status).toBe(0);
  expect(first.stdout.trim().split("\n").map(line => JSON.parse(line))).toMatchObject([
    { name: "build", status: "pass" },
    { name: "product-flow", status: "pass" },
    { name: "test", status: "pass" },
    { name: "media-integration", status: "pass" },
  ]);
  expect(readFileSync(join(directory, "order.log"), "utf8").trim().split("\n")).toEqual([
    "build", "product-flow-start", "product-flow-end", "test-start", "test-end", "media-integration-start", "media-integration-end",
  ]);

  writeFileSync(join(verify, "test.sh"), check("test", true));
  const failed = run();
  expect(failed.error).toBeUndefined();
  expect(failed.status).toBe(1);
  expect(failed.stdout.trim().split("\n").map(line => JSON.parse(line))).toMatchObject([
    { name: "build", status: "pass" },
    { name: "product-flow", status: "pass" },
    { name: "test", status: "fail", blocking: true, summary: "intended failure" },
    { name: "media-integration", status: "pass" },
  ]);
  expect(failed.stderr).toContain("FAIL test: intended failure");
});

test("builds before acquiring the modeled owned database and reports the full selection", () => {
  const verify = join(directory, "scripts/verify");
  writeFileSync(join(verify, "registry.yml"), `checks:
  - name: review-admission
    script: review-admission.sh
    stage: acceptance
    layer: 0
    blocking: true
    preflight: true
    runs: [local]
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
  writeFileSync(join(verify, "review-admission.sh"), `#!/bin/bash
if [ "$MUTATE_SOURCE" = 1 ]; then printf changed > source.marker; fi
[ "\${FAIL_REVIEW:-0}" = 0 ] || exit 1
printf '%s\\n' '{"summary":"review admitted"}'
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
  writeFileSync(join(verify, "local-db.mjs"), `import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const event = value => appendFileSync('order.log', value + '\\n');
export function assertOwnedDatabase(env = process.env) {
  event('db-assert');
  if (env.FITSY_VERIFY_OWNED_DB !== 'owned') throw Error('modeled database owner mismatch');
}
export function runWithLocalDatabase(args) {
  event('db-acquire');
  if (process.env.FAIL_DB === '1') return 1;
  const result = spawnSync(process.execPath, ['scripts/verify/run.mjs', ...args],
    { env: { ...process.env, FITSY_VERIFY_OWNED_DB: 'owned' }, stdio: 'inherit' });
  return result.status ?? 1;
}
`);
  writeFileSync(join(directory, "source.marker"), "original");
  writeFileSync(join(verify, "receipt-cache.mjs"), "import { readFileSync } from 'node:fs'; export const sourceIdentity = () => readFileSync('source.marker', 'utf8');\n");
  for (const args of [["init", "-q", "-b", "main"], ["config", "user.name", "Fixture"],
    ["config", "user.email", "fixture@example.test"], ["add", "."], ["commit", "-qm", "fixture"],
    ["update-ref", "refs/remotes/origin/main", "HEAD"]]) {
    const git = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
    expect(git.status).toBe(0);
  }
  const command = [join(verify, "run.mjs"), "--layer=all", "--scope=all", "--runs=local"];
  const run = (extra: NodeJS.ProcessEnv = {}, extraArgs: string[] = []) => spawnSync(process.execPath, [...command, ...extraArgs],
    { cwd: directory, encoding: "utf8", timeout: 10000, env: { ...process.env, ...extra } });
  const names = (stdout: string) => stdout.trim().split("\n").map(line => JSON.parse(line).name);

  const valid = run({ FITSY_VERIFY_DB_LOCKED: '1', POSTGRES_PRISMA_URL: 'postgresql://unowned' });
  expect(valid.error).toBeUndefined();
  expect(valid.status).toBe(0);
  expect(readFileSync(join(directory, "order.log"), "utf8").trim().split("\n"))
    .toEqual(["build", "db-acquire", "db-assert", "test"]);
  expect(names(valid.stdout).filter(name => name === "build")).toHaveLength(1);
  expect(names(valid.stdout).filter(name => name === "test")).toHaveLength(1);
  expect(names(valid.stdout).filter(name => name === "review-admission")).toHaveLength(1);
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

  writeFileSync(join(directory, "order.log"), "");
  const reviewFailed = run({ FAIL_REVIEW: "1" });
  expect(reviewFailed.status).toBe(1);
  expect(readFileSync(join(directory, "order.log"), "utf8")).toBe("");
  expect(reviewFailed.stdout).toContain('"name":"build","status":"skipped"');

  const mutated = run({ MUTATE_SOURCE: "1" });
  expect(mutated.status).toBe(1);
  expect(readFileSync(join(directory, "order.log"), "utf8")).toBe("");
  expect(mutated.stdout).toContain('"name":"source-stability","status":"fail"');
  writeFileSync(join(directory, "source.marker"), "original");

  expect(run({}, ["--only=unknown"]).status).toBe(1);
});
