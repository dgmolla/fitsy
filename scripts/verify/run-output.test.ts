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

test.each(['--layer=99', '--only='])('empty check selection fails for %s', arg => {
  writeFileSync(join(directory, 'scripts/verify/registry.yml'), 'checks: []\n');
  const result = spawnSync(process.execPath, ['scripts/verify/run.mjs', '--runs=ci', arg],
    { cwd: directory, encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/no verification checks selected|requires at least one check/);
});

test.each([true, 'shadow'])('a missing registry script always fails, blocking=%s', blocking => {
  writeFileSync(join(directory, 'scripts/verify/registry.yml'), `checks:\n  - name: fixture\n    script: missing.sh\n    layer: 1\n    blocking: ${blocking}\n`);
  const result = spawnSync(process.execPath, ['scripts/verify/run.mjs', '--runs=ci'],
    { cwd: directory, encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ name: 'fixture', status: 'fail', blocking: true });
});

test('an aliased executable path still runs and fails an empty selection', () => {
  writeFileSync(join(directory, 'scripts/verify/registry.yml'), 'checks: []\n');
  const alias = join(directory, 'verify-alias.mjs');
  symlinkSync(join(directory, 'scripts/verify/run.mjs'), alias);
  const result = spawnSync(process.execPath, [alias, '--runs=ci'], { cwd: directory, encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('no verification checks selected');
  const imported = spawnSync(process.execPath, ['--input-type=module', '-'], {
    cwd: directory, encoding: 'utf8',
    input: "import {verify} from './scripts/verify/run.mjs'; process.exitCode = await verify(['--runs=ci']);",
  });
  expect(imported.status).toBe(1);
  expect(imported.stderr).toContain('no verification checks selected');
});

test('repeated verification executes again and reports the fresh failure', () => {
  const verify = join(directory, 'scripts/verify');
  writeFileSync(join(verify, 'registry.yml'), 'checks:\n  - name: fixture\n    script: fixture.sh\n    layer: 1\n    blocking: true\n');
  writeFileSync(join(verify, 'fixture.sh'), 'echo run >> calls\necho \'{"status":"pass"}\'\nexit "${FAIL_CHECK:-0}"\n');
  const run = (fail: string) => spawnSync(process.execPath, ['scripts/verify/run.mjs', '--runs=ci'],
    { cwd: directory, encoding: 'utf8', env: { ...process.env, FAIL_CHECK: fail } });
  expect(run('0').status).toBe(0);
  const failed = run('1');
  expect(failed.status).toBe(1);
  expect(JSON.parse(failed.stdout).status).toBe('fail');
  expect(readFileSync(join(directory, 'calls'), 'utf8')).toBe('run\nrun\n');
});

test('a reported failure cannot pass even when the check exits zero', () => {
  const verify = join(directory, 'scripts/verify');
  writeFileSync(join(verify, 'registry.yml'), 'checks:\n  - name: fixture\n    script: fixture.sh\n    layer: 1\n    blocking: true\n');
  writeFileSync(join(verify, 'fixture.sh'), 'echo \'{"status":"fail","summary":"engine failed"}\'\n');
  const result = spawnSync(process.execPath, ['scripts/verify/run.mjs', '--runs=ci'],
    { cwd: directory, encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ name: 'fixture', status: 'fail', summary: 'engine failed' });
});

test("a directory symlink cannot skip blocking verification checks", () => {
  const verify = join(directory, "scripts/verify");
  writeFileSync(join(verify, "registry.yml"), `checks:
  - name: fixture
    script: fail.sh
    layer: 0
    blocking: true
    runs: [ci]
`);
  writeFileSync(join(verify, "fail.sh"), 'echo \'{"summary":"intentional failure"}\'\nexit 1\n');
  const alias = join(directory, "linked-scripts");
  symlinkSync(join(directory, "scripts"), alias, "dir");
  const result = spawnSync(process.execPath, [join(alias, "verify/run.mjs"), "--scope=all", "--runs=ci"], {
    cwd: directory, encoding: "utf8", timeout: 10000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout.trim())).toMatchObject({ name: "fixture", status: "fail", blocking: true });
});

test("scopes an optional build heap to the production build command", () => {
  // Keep the real build guard independent of the caller's staged merge files.
  const build = join(directory, "scripts/verify/build.sh");
  copyFileSync(join(root, "scripts/verify/build.sh"), build);
  const git = spawnSync("git", ["init", "-q"], { cwd: directory, encoding: "utf8" });
  expect(git.status).toBe(0);
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
    const result = spawnSync("/bin/bash", [build],
      { cwd: directory, env, encoding: "utf8", timeout: 10000 });
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
