import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const source = resolve(__dirname, '../..');
let root: string;
// Nested checkouts own no database and cannot inherit the launcher's datasources.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GIT_|FITSY_DIFF_|GITHUB_|CI$|FITSY_RUNS$|FITSY_LOCAL_DB$|FITSY_VERIFY_|POSTGRES_|PIPELINE_DATABASE_URL$)/.test(key)));
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, env, stdio: 'ignore' });
const cli = (...args: string[]) => spawnSync(process.execPath, ['scripts/verify/focused-tests.mjs', ...args], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fitsy-focused-'));
  mkdirSync(join(root, 'scripts/verify'), { recursive: true });
  for (const name of ['focused-tests.mjs', 'test-results.mjs', 'impact-plan.mjs', 'python-focused.py', 'local-db.mjs', 'local-db-control.mjs', 'docker-runtime.mjs', 'node-focused-reporter.mjs']) copyFileSync(join(source, 'scripts/verify', name), join(root, 'scripts/verify', name));
  symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'));
  writeFileSync(join(root, '.gitignore'), 'node_modules\n.evidence/\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, workspaces: ['scripts'] }));
  writeFileSync(join(root, 'scripts/package.json'), JSON.stringify({ name: '@fitsy/scripts', scripts: { test: 'jest --config=jest.config.cjs' } }));
  writeFileSync(join(root, 'scripts/jest.config.cjs'), 'module.exports = { testMatch: ["**/*.test.ts"], transform: {} };\n');
  writeFileSync(join(root, 'scripts/fixture.test.ts'), "test('fixture outcome', () => { expect(2 + 2).toBe(4); expect(process.env.PIPELINE_DATABASE_URL).toBeUndefined(); });\n");
  git('init', '-q'); git('config', 'user.name', 'Focused fixture'); git('config', 'user.email', 'fixture@example.test');
  git('add', '.'); git('commit', '-qm', 'baseline'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  writeFileSync(join(root, 'scripts/candidate.ts'), 'export const changed = true;\n');
  git('add', 'scripts/candidate.ts'); git('commit', '-qm', 'candidate');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
test('persisted focused recipe executes real matching Jest tests and retains their results', () => {
  expect(cli('--set', 'scripts/fixture.test.ts', '--jest-pattern=fixture outcome').status).toBe(0);
  expect(cli().status).toBe(0);
  expect(JSON.parse(readFileSync(join(root, '.evidence/verify/focused-tests.json'), 'utf8'))).toMatchObject({ pattern: 'fixture outcome' });
});
test('the full affected group reruns focused files and includes unselected failing assertions', () => {
  copyFileSync(join(source, 'scripts/verify/test.sh'), join(root, 'scripts/verify/test.sh'));
  mkdirSync(join(root, 'apps/mobile'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, workspaces: ['scripts', 'apps/mobile'] }));
  writeFileSync(join(root, 'apps/mobile/package.json'), JSON.stringify({ name: '@fitsy/mobile', scripts: { test: 'jest --config=jest.config.cjs' } }));
  copyFileSync(join(root, 'scripts/jest.config.cjs'), join(root, 'apps/mobile/jest.config.cjs'));
  writeFileSync(join(root, 'apps/mobile/fixture.test.ts'), `const fs = require('node:fs');
test('focused outcome', () => fs.appendFileSync('../../.evidence/cases', 'A'));
test('whole group outcome', () => { fs.appendFileSync('../../.evidence/cases', 'B'); expect(process.env.FULL_FAILURE).not.toBe('1'); });
`);
  git('add', '.'); git('commit', '-qm', 'whole-group fixture'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  writeFileSync(join(root, 'apps/mobile/candidate.ts'), 'export const changed = true;\n');
  git('add', '.'); git('commit', '-qm', 'mobile candidate');
  expect(cli('--set', 'apps/mobile/fixture.test.ts', '--jest-pattern=focused outcome').status).toBe(0);
  expect(cli().status).toBe(0);
  const full = (failure: string) => spawnSync('/bin/bash', ['scripts/verify/test.sh', '--scope=changed'],
    { cwd: root, encoding: 'utf8', env: { ...env, FULL_FAILURE: failure }, timeout: 30000 });
  const passed = full('0');
  expect({ status: passed.status, output: passed.status === 0 ? '' : passed.stderr }).toEqual({ status: 0, output: '' });
  expect(readFileSync(join(root, '.evidence/cases'), 'utf8')).toBe('AAB');
  expect(full('1').status).toBe(1);
  expect(readFileSync(join(root, '.evidence/cases'), 'utf8')).toBe('AABAB');
}, 45000);
test('Verify retains an API assertion followed by more than 10000 characters of mobile output', () => {
  for (const name of ['run.mjs', 'test.sh']) copyFileSync(join(source, 'scripts/verify', name), join(root, 'scripts/verify', name));
  writeFileSync(join(root, 'scripts/verify/registry.yml'), 'checks:\n  - name: test\n    script: test.sh\n    layer: 2\n    blocking: true\n    runs: [ci]\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, workspaces: ['scripts', 'apps/api', 'apps/mobile'] }));
  for (const workspace of ['api', 'mobile']) {
    const path = join(root, 'apps', workspace);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'package.json'), JSON.stringify({ name: `@fitsy/${workspace}`,
      scripts: { test: 'jest --config=jest.config.cjs', 'test:coverage': 'jest --config=jest.config.cjs' } }));
    copyFileSync(join(root, 'scripts/jest.config.cjs'), join(path, 'jest.config.cjs'));
  }
  git('add', '.'); git('commit', '-qm', 'workspace fixture'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  writeFileSync(join(root, 'apps/api/fixture.test.ts'), "test('API assertion sentinel', () => expect('actual API value').toBe('expected API value'));\n");
  writeFileSync(join(root, 'apps/mobile/fixture.test.ts'), "test('later mobile output', () => { process.stderr.write('MOBILE_PASS_DETAIL\\n'.repeat(1024)); expect(true).toBe(true); });\n");
  git('add', '.'); git('commit', '-qm', 'changed workspace tests');
  const yaml = require('js-yaml') as { load(text: string): unknown };
  const workflow = yaml.load(readFileSync(join(source, '.github/workflows/verify.yml'), 'utf8')) as {
    jobs: { test: { steps: { name?: string; run?: string }[] } };
  };
  const command = workflow.jobs.test.steps.find(step => step.name === 'Run L2 checks')!.run!;
  const result = spawnSync('/bin/bash', ['-e', '-c', command],
    { cwd: root, env, encoding: 'utf8', timeout: 30000 });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  const check = JSON.parse(result.stdout);
  expect(check).toMatchObject({ name: 'test', status: 'fail', summary: 'tests failed in: api' });
  expect(result.stderr).toContain('FAIL test: tests failed in: api');
  expect(check.logs).toEqual({ stdout: expect.any(String), stderr: expect.any(String) });
  const diagnostics = readFileSync(join(root, check.logs.stderr), 'utf8');
  expect(diagnostics).toContain('API assertion sentinel');
  expect(diagnostics).toContain('Expected: "expected API value"');
  expect(diagnostics).toContain('Received: "actual API value"');
  expect(diagnostics.indexOf('API assertion sentinel')).toBeLessThan(diagnostics.indexOf('MOBILE_PASS_DETAIL'));
  expect(diagnostics.slice(-10000)).not.toContain('API assertion sentinel');
  expect(diagnostics.match(/MOBILE_PASS_DETAIL/g)).toHaveLength(1024);
  expect(readFileSync(join(root, check.logs.stdout), 'utf8')).toContain('tests failed in: api');
}, 45000);
test('missing or skipped focused selections cannot satisfy the cheap gate', () => {
  const missing = cli();
  expect(missing.status).toBe(1);
  expect(JSON.parse(missing.stdout).summary).toContain('select meaningful focused reproduction/regression tests');
  expect(cli('--set', 'scripts/fixture.test.ts', '--jest-pattern=absent outcome').status).toBe(0);
  const skipped = cli(); expect(skipped.status).toBe(1); expect(skipped.stdout).toContain('executed no passing tests');
});
test('the canonical verifier diagnoses a missing recipe and runs the selected tests after repair', () => {
  for (const name of ['run.mjs', 'focused-tests.sh']) copyFileSync(join(source, 'scripts/verify', name), join(root, 'scripts/verify', name));
  copyFileSync(join(source, 'scripts/verify/registry.yml'), join(root, 'scripts/verify/registry.yml'));
  const verify = () => spawnSync(process.execPath, ['scripts/verify/run.mjs', '--only=focused-tests', '--scope=changed', '--runs=local'],
    { cwd: root, env, encoding: 'utf8', timeout: 30000 });
  const missing = verify();
  expect(missing.status).toBe(1);
  expect(JSON.parse(missing.stdout)).toMatchObject({ name: 'focused-tests', status: 'fail', blocking: true,
    summary: expect.stringContaining('select meaningful focused reproduction/regression tests'),
    fix: expect.stringContaining('focused-tests.mjs --set <test paths>') });
  expect(cli('--set', 'scripts/fixture.test.ts').status).toBe(0);
  const repaired = verify();
  expect(repaired.status).toBe(0);
  expect(JSON.parse(repaired.stdout)).toMatchObject({ name: 'focused-tests', status: 'pass', executed_tests: 1 });
});
test.each(['', ' \n', '{"version":'])('an invalid focused recipe reports actionable diagnostics: %p', recipe => {
  mkdirSync(join(root, '.evidence/verify'), { recursive: true });
  writeFileSync(join(root, '.evidence/verify/focused-tests.json'), recipe);
  const result = cli();
  expect(result.status).toBe(1);
  const check = JSON.parse(result.stdout);
  expect(check.summary).toContain(recipe.trim() ? 'invalid focused test selection JSON' : 'select meaningful focused reproduction/regression tests');
  expect(check.fix).toContain('focused-tests.mjs --set <test paths>');
});
test('an empty runner recipe cannot fall back to a saved selection', () => {
  expect(cli('--set', 'scripts/fixture.test.ts').status).toBe(0);
  const result = spawnSync(process.execPath, ['scripts/verify/focused-tests.mjs'], {
    cwd: root, env: { ...env, FITSY_VERIFY_FOCUSED_RECIPE: '' }, encoding: 'utf8', timeout: 30000,
  });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout).summary).toContain('select meaningful focused reproduction/regression tests');
});
test('empty and deleted focused selections fail before execution', () => {
  expect(cli('--set').status).toBe(1);
  expect(cli('--set', 'scripts/fixture.test.ts').status).toBe(0);
  rmSync(join(root, 'scripts/fixture.test.ts'));
  expect(cli().status).toBe(1);
});
test('unknown comparison history cannot skip focused execution', () => {
  expect(cli('--set', 'scripts/fixture.test.ts').status).toBe(0);
  git('update-ref', '-d', 'refs/remotes/origin/main');
  const result = cli();
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('known source comparison');
});
test.each(['ts', 'mjs', 'py'])('a failed focused %s assertion remains a failure', extension => {
  const path = `scripts/fixture.test.${extension}`;
  writeFileSync(join(root, path), extension === 'py'
    ? "import unittest\nclass Outcome(unittest.TestCase):\n def test_failure(self): self.fail('real failure')\n"
    : extension === 'mjs'
      ? "import {test} from 'node:test'; test('failure', () => {throw Error('real failure')});\n"
      : "test('failure', () => {throw Error('real failure')});\n");
  expect(cli('--set', path).status).toBe(0);
  expect(cli().status).toBe(1);
});
test.each(['../outside.test.ts', '--runInBand', 'scripts/missing.test.ts'])('rejects unsupported or escaping test path %s', path => {
  expect(cli('--set', path).status).toBe(1);
});

test('focused Python imports preserve the frozen source without bytecode artifacts', () => {
  writeFileSync(join(root, 'scripts/focused_library.py'), 'value = 7\n');
  writeFileSync(join(root, 'scripts/fixture.test.py'), "import unittest\nimport focused_library\nclass Outcome(unittest.TestCase):\n def test_value(self): self.assertEqual(focused_library.value, 7)\n");
  expect(cli('--set', 'scripts/fixture.test.py').status).toBe(0);
  expect(cli().status).toBe(0);
  expect(existsSync(join(root, 'scripts/__pycache__'))).toBe(false);
});

test.each(["import unittest\nclass Outcome(unittest.TestCase):\n @unittest.expectedFailure\n def test_value(self): self.fail('known failure')\n", 'value = 7\n', "import unittest\n@unittest.skip('fixture')\nclass Outcome(unittest.TestCase):\n def test_value(self): pass\n"])('focused Python selection rejects zero executed passing tests', content => {
  writeFileSync(join(root, 'scripts/fixture.test.py'), content);
  expect(cli('--set', 'scripts/fixture.test.py').status).toBe(0);
  expect(cli().status).toBe(1);
});
test.each(['apps/api/fixture.test.ts', 'scripts/pipeline-v2/fixture.db.test.ts'].flatMap(path =>
  [undefined, 'postgresql://external.example/prod'].map(url => ({ path, url }))))('direct $path rejects unowned database $url', ({ path, url }) => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), "throw new Error('must not execute');\n");
  expect(cli('--set', path).status).toBe(0);
  const result = spawnSync(process.execPath, ['scripts/verify/focused-tests.mjs'], { cwd: root, encoding: 'utf8', env: { ...env, FITSY_VERIFY_OWNED_DB: '', POSTGRES_PRISMA_URL: url, POSTGRES_URL_NON_POOLING: url } });
  expect(result.status).toBe(1);
  expect(result.stderr).not.toContain('must not execute');
});

test.each(['mjs', 'py'])('direct API focused %s rejects an external database before loading the file', extension => {
  mkdirSync(join(root, 'apps/api'), { recursive: true });
  const path = `apps/api/fixture.test.${extension}`;
  const content = extension === 'mjs'
    ? "import fs from 'node:fs'; import { test } from 'node:test'; fs.writeFileSync('.evidence/api-executed', 'unsafe'); test('outcome', () => {});\n"
    : "import pathlib, unittest\npathlib.Path('.evidence/api-executed').write_text('unsafe')\nclass Outcome(unittest.TestCase):\n def test_value(self): pass\n";
  writeFileSync(join(root, path), content);
  expect(cli('--set', path).status).toBe(0);
  const result = spawnSync(process.execPath, ['scripts/verify/focused-tests.mjs'], { cwd: root, encoding: 'utf8', env: { ...env, FITSY_VERIFY_OWNED_DB: '', POSTGRES_PRISMA_URL: 'postgresql://external.example/prod', POSTGRES_URL_NON_POOLING: 'postgresql://external.example/prod' } });
  expect(existsSync(join(root, '.evidence/api-executed'))).toBe(false);
  expect(result.status).toBe(1);
});

test.each(['', "import { test } from 'node:test'; test('skip', {skip:true}, () => {});\n", "import { describe } from 'node:test'; describe('empty suite', () => {});\n"])('focused Node selection rejects empty or unexecuted cases', content => {
  writeFileSync(join(root, 'scripts/fixture.test.mjs'), content);
  expect(cli('--set', 'scripts/fixture.test.mjs').status).toBe(0);
  const result = cli(); expect(result.status).toBe(1); expect(result.stdout).toContain('executed no passing tests');
});
test('focused Node selection retains counted real passing cases', () => {
  writeFileSync(join(root, 'scripts/fixture.test.mjs'), "import { test } from 'node:test'; test('real outcome', () => {});\n");
  expect(cli('--set', 'scripts/fixture.test.mjs').status).toBe(0);
  expect(cli().status).toBe(0);
});

test('unsupported shared Jest selection is rejected before persisting a broken recipe', () => {
  mkdirSync(join(root, 'packages/shared/src'), { recursive: true });
  writeFileSync(join(root, 'packages/shared/src/fixture.test.ts'), "test('shared outcome', () => {});\n");
  const result = cli('--set', 'packages/shared/src/fixture.test.ts');
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('unsupported focused test workspace');
  expect(existsSync(join(root, '.evidence/verify/focused-tests.json'))).toBe(false);
});

test.each(['ts', 'mjs', 'py'].flatMap(extension =>
  ['POSTGRES_PRISMA_URL', 'POSTGRES_URL_NON_POOLING', 'PIPELINE_DATABASE_URL'].map(name => [extension, name])))(
  'direct script focused %s rejects an external %s before loading tests', (extension, name) => {
  const path = `scripts/fixture.test.${extension}`;
  const content = extension === 'py'
    ? "import pathlib, unittest\npathlib.Path('.evidence/script-executed').write_text('unsafe')\nclass Outcome(unittest.TestCase):\n def test_value(self): pass\n"
    : extension === 'mjs'
      ? "import fs from 'node:fs'; import { test } from 'node:test'; fs.writeFileSync('.evidence/script-executed', 'unsafe'); test('outcome', () => {});\n"
      : "require('node:fs').writeFileSync('.evidence/script-executed', 'unsafe'); test('outcome', () => {});\n";
  writeFileSync(join(root, path), content);
  expect(cli('--set', path).status).toBe(0);
  const result = spawnSync(process.execPath, ['scripts/verify/focused-tests.mjs'], { cwd: root, encoding: 'utf8', env: { ...env, FITSY_VERIFY_OWNED_DB: '', [name!]: 'postgresql://external.example/prod' } });
  expect(existsSync(join(root, '.evidence/script-executed'))).toBe(false);
  expect(result.status).toBe(1);
});
