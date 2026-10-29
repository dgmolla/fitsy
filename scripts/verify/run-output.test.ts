import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(__dirname, "../..");
let directory: string;
beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), "fitsy-verify-output-")));
  mkdirSync(join(directory, "scripts/verify"), { recursive: true });
  copyFileSync(join(root, "scripts/verify/run.mjs"), join(directory, "scripts/verify/run.mjs"));
  copyFileSync(join(root, "scripts/verify/impact-plan.mjs"), join(directory, "scripts/verify/impact-plan.mjs"));
  symlinkSync(join(root, "node_modules"), join(directory, "node_modules"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

test("an aliased CLI entrypoint executes selected checks instead of silently passing", () => {
  const verify = join(directory, "scripts/verify");
  writeFileSync(join(verify, "registry.yml"), "checks:\n  - name: fixture\n    script: fixture.sh\n    layer: 1\n    blocking: true\n    runs: [ci]\n");
  writeFileSync(join(verify, "fixture.sh"), "printf '%s\\n' '{\"summary\":\"executed through alias\"}'\nexit 1\n");
  const alias = join(directory, "verify-alias.mjs");
  symlinkSync(join(verify, "run.mjs"), alias);
  const result = spawnSync(process.execPath, [alias, "--only=fixture", "--scope=all", "--runs=ci"],
    { cwd: directory, encoding: "utf8", timeout: 10000 });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout.trim())).toMatchObject({ name: "fixture", status: "fail", summary: "executed through alias" });
});

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
  const passed = run('0');
  expect(passed.status).toBe(0);
  const originalLog = JSON.parse(passed.stdout).logs.stdout;
  const originalOutput = readFileSync(join(directory, originalLog), 'utf8');
  const failed = run('1');
  expect(failed.status).toBe(1);
  expect(JSON.parse(failed.stdout).status).toBe('fail');
  expect(JSON.parse(failed.stdout).logs.stdout).not.toBe(originalLog);
  expect(readFileSync(join(directory, originalLog), 'utf8')).toBe(originalOutput);
  expect(readFileSync(join(directory, 'calls'), 'utf8')).toBe('run\nrun\n');
});

test.each(['verify', 'verify:all'])('the public npm %s alias retains check logs', alias => {
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, scripts: { [alias]: scripts[alias] } }));
  writeFileSync(join(directory, 'scripts/verify/registry.yml'), 'checks:\n  - name: fixture\n    script: fixture.sh\n    layer: 1\n    blocking: true\n');
  writeFileSync(join(directory, 'scripts/verify/fixture.sh'), 'echo \'{"summary":"npm alias ran"}\'\n');
  const result = spawnSync('npm', ['run', '--silent', alias, '--', '--runs=ci'],
    { cwd: directory, encoding: 'utf8', timeout: 10000 });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  const check = JSON.parse(result.stdout);
  expect(check).toMatchObject({ name: 'fixture', status: 'pass' });
  expect(readFileSync(join(directory, check.logs.stdout), 'utf8')).toContain('npm alias ran');
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

test('a JSON failure longer than the console excerpt cannot become a pass', () => {
  const verify = join(directory, 'scripts/verify');
  writeFileSync(join(verify, 'registry.yml'), 'checks:\n  - name: fixture\n    script: fixture.sh\n    layer: 1\n    blocking: true\n');
  const summary = 'long failure detail '.repeat(1024);
  writeFileSync(join(directory, 'result.json'), JSON.stringify({ status: 'fail', summary }) + '\n');
  writeFileSync(join(verify, 'fixture.sh'), 'echo earlier-output\ncat result.json\n');
  const result = spawnSync(process.execPath, [join(verify, 'run.mjs'), '--runs=ci'],
    { cwd: directory, encoding: 'utf8', timeout: 10000 });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ name: 'fixture', status: 'fail', summary });
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
  expect(spawnSync('git', ['init', '-q'], { cwd: directory }).status).toBe(0);
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
    "npm:", "npm:--max-old-space-size=384",
  ]);
});

test.each(['unchanged', 'new-output', 'changed-source', 'source-map'])(
  'the real build guard compares source contents before/after: %s', effect => {
    const build = join(directory, 'scripts/verify/build.sh');
    copyFileSync(join(root, 'scripts/verify/build.sh'), build);
    expect(spawnSync('git', ['init', '-q'], { cwd: directory }).status).toBe(0);
    writeFileSync(join(directory, 'source.js'), 'original source\n');
    expect(spawnSync('git', ['add', 'source.js'], { cwd: directory }).status).toBe(0);
    // Preserve a legitimate uncommitted JS edit, exactly like the worker checkout.
    writeFileSync(join(directory, 'source.js'), 'existing user edit\n');
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    const output = effect === 'new-output' ? 'generated.js' : effect === 'source-map' ? 'generated.js.map' : 'source.js';
    const command = effect === 'unchanged' ? 'exit 0' : `printf 'build output\\n' > '${output}'`;
    writeFileSync(join(bin, 'npm'), `#!/bin/sh\n${command}\n`);
    chmodSync(join(bin, 'npm'), 0o700);
    const result = spawnSync('/bin/bash', [build], { cwd: directory, encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, timeout: 10_000 });
    expect(result.status).toBe(effect === 'unchanged' ? 0 : 1);
    if (effect === 'unchanged') expect(readFileSync(join(directory, 'source.js'), 'utf8')).toBe('existing user edit\n');
    else expect(result.stdout).toContain('build changed JavaScript source or emitted files');
  },
);

test.each([true, "shadow"])("retains diagnostics beyond the old buffer limit with blocking=%s", blocking => {
  const payload = "FIRST_DIAGNOSTIC_SENTINEL\n" + "diagnostic detail\n".repeat(1048576) + "FINAL_DIAGNOSTIC_SENTINEL\n";
  const verify = join(directory, "scripts/verify");
  writeFileSync(join(verify, "registry.yml"), `checks:\n  - name: fixture\n    script: fixture.sh\n    layer: 2\n    blocking: ${blocking}\n    runs: [ci]\n`);
  writeFileSync(join(directory, "diagnostics.txt"), payload);
  writeFileSync(join(verify, "fixture.sh"), `#!/bin/bash\ncat diagnostics.txt >&2\nprintf '%s\\n' '{"summary":"fixture failure","fix":"fixture remedy"}'\nexit 1\n`);

  // Pipes reproduce the CI console transport; the full payload belongs in the artifact.
  const result = spawnSync(process.execPath, [join(verify, "run.mjs"), "--scope=all", "--runs=ci"], {
    encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 10000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(blocking === true ? 1 : 0);
  const check = JSON.parse(result.stdout.trim());
  expect(check).toMatchObject({ name: "fixture", status: "fail", blocking: blocking === true });
  expect(readFileSync(join(directory, check.logs.stderr), 'utf8')).toBe(payload);
  expect(readFileSync(join(directory, check.logs.stdout), 'utf8')).toContain('fixture failure');
  expect(result.stderr.length).toBeLessThan(12000);
  expect(result.stderr).not.toContain('FIRST_DIAGNOSTIC_SENTINEL');
  expect(result.stderr).toContain(`Full logs: ${check.logs.stdout}, ${check.logs.stderr}`);
  expect(result.stderr).toContain("FINAL_DIAGNOSTIC_SENTINEL\n");
  expect(result.stderr).toContain(blocking === true ? "verify: 0 pass, 1 fail" : "verify: 0 pass, 0 fail, 1 shadow-fail (fixture)");
  if (blocking === true) expect(result.stderr).toContain("FAIL fixture: fixture failure\n  fix: fixture remedy\n");
});

test.each([0, 2, 7])('retains both streams and the actual exit status for exit %s', code => {
  const verify = join(directory, 'scripts/verify');
  writeFileSync(join(verify, 'registry.yml'), 'checks:\n  - name: fixture\n    script: fixture.sh\n    layer: 1\n    blocking: true\n');
  writeFileSync(join(verify, 'fixture.sh'), `echo stdout-detail\necho stderr-detail >&2\nexit ${code}\n`);
  const result = spawnSync(process.execPath, [join(verify, 'run.mjs'), '--runs=ci'],
    { cwd: directory, encoding: 'utf8', timeout: 10000 });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(code === 7 ? 1 : 0);
  const check = JSON.parse(result.stdout);
  expect(check.status).toBe(code === 7 ? 'fail' : code === 2 ? 'skipped' : 'pass');
  expect(readFileSync(join(directory, check.logs.stdout), 'utf8')).toBe('stdout-detail\n');
  expect(readFileSync(join(directory, check.logs.stderr), 'utf8')).toBe('stderr-detail\n');
  if (code === 7) expect(result.stderr).toContain('stdout-detail');
});

test.each(['static', 'test', 'build'])('Verify uploads %s logs after failed checks and retains previous attempts', jobName => {
  const yaml = require('js-yaml') as { load(text: string): unknown };
  const workflow = yaml.load(readFileSync(join(root, '.github/workflows/verify.yml'), 'utf8')) as {
    jobs: Record<string, { steps: { run?: string; if?: string; uses?: string; with?: Record<string, unknown> }[] }>;
  };
  const steps = workflow.jobs[jobName]!.steps;
  const runIndex = steps.findIndex(step => step.run?.includes('node scripts/verify/run.mjs'));
  const uploadIndex = steps.findIndex(step => step.uses === 'actions/upload-artifact@v4');
  expect(runIndex).toBeGreaterThanOrEqual(0);
  expect(uploadIndex).toBeGreaterThan(runIndex);
  const upload = steps[uploadIndex]!;
  expect(upload.if).toBe('${{ always() }}');
  expect(upload.with).toMatchObject({ path: '.evidence/verify/logs/', 'include-hidden-files': true,
    'retention-days': 7, 'if-no-files-found': 'warn', name: expect.stringContaining('${{ github.run_attempt }}') });
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
