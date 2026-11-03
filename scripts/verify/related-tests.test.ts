import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(GIT_|GITHUB_|FITSY_|CI$|NODE_OPTIONS$|NODE_PATH$|POSTGRES_|PIPELINE_DATABASE_URL$)/.test(key)));
let directory: string;
let base: string;
const write = (path: string, value: string) => {
  mkdirSync(join(directory, path, '..'), { recursive: true });
  writeFileSync(join(directory, path), value);
};
const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, env, encoding: 'utf8' }).trim();
const commit = () => { git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
const context = (extra: Record<string, string> = {}) => ({ ...env, CI: 'true', GITHUB_EVENT_NAME: 'pull_request',
  FITSY_DIFF_BASE: base, FITSY_DIFF_HEAD: git('rev-parse', 'HEAD'), ...extra });
const plan = (extra: Record<string, string> = {}) => JSON.parse(execFileSync(process.execPath,
  ['scripts/verify/related-tests.mjs'], { cwd: directory, env: context(extra), encoding: 'utf8' }));

beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'fitsy-related-')));
  write('.gitignore', 'node_modules\n.evidence/\n');
  write('package.json', JSON.stringify({ private: true, workspaces: ['apps/mobile', 'packages/shared', 'scripts'] }));
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'));
  for (const [workspace, name] of [['apps/mobile', 'mobile'], ['packages/shared', 'shared'], ['scripts', 'scripts']]) {
    write(`${workspace}/package.json`, JSON.stringify({ name: `@fitsy/${name}`, scripts: { test: 'jest' } }));
    write(`${workspace}/jest.config.cjs`, 'module.exports = { testEnvironment: "node", testMatch: ["**/*.test.ts"], transform: {} };\n');
  }
  for (const file of ['test.sh', 'test-results.mjs', 'related-tests.mjs', 'impact-plan.mjs']) {
    mkdirSync(join(directory, 'scripts/verify'), { recursive: true });
    copyFileSync(join(root, 'scripts/verify', file), join(directory, 'scripts/verify', file));
  }
  write('packages/shared/contract.test.ts', 'test("shared contract", () => expect(1).toBe(1));\n');
  write('apps/mobile/lib/value.ts', 'module.exports = 1;\n');
  write('apps/mobile/lib/consumer.ts', 'module.exports = require("./value");\n');
  write('apps/mobile/lib/consumer.test.ts', 'test("transitive value", () => expect(require("./consumer")).toBe(2));\n');
  write('apps/mobile/lib/unrelated.test.ts', 'test("unrelated failure", () => { throw new Error("must not run for value"); });\n');
  git('init', '-q'); git('config', 'user.name', 'Related test fixture'); git('config', 'user.email', 'test@example.test');
  git('config', 'core.hooksPath', '/dev/null');
  base = commit(); git('update-ref', 'refs/remotes/origin/main', base);
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

test('the real PR entrypoint runs transitive Jest consumers and propagates their failures', () => {
  write('apps/mobile/lib/value.ts', 'module.exports = 2;\n'); commit();
  expect(plan()).toMatchObject({ mode: 'related', tests: { mobile: [join(directory, 'apps/mobile/lib/consumer.test.ts')] } });
  const run = () => spawnSync('bash', ['scripts/verify/test.sh', '--scope=changed'],
    { cwd: directory, env: context(), encoding: 'utf8', timeout: 30000 });
  const passing = run();
  expect({ status: passing.status, stderr: passing.status === 0 ? '' : passing.stderr }).toEqual({ status: 0, stderr: '' });
  expect(passing.stdout).toContain('related test groups passed: mobile');
  write('apps/mobile/lib/value.ts', 'module.exports = 3;\n'); commit();
  const failing = run();
  expect(failing.status).toBe(1);
  expect(failing.stdout).toContain('tests failed in: mobile');
  write('apps/mobile/lib/consumer.test.ts', 'test.skip("skipped consumer", () => expect(require("./consumer")).toBe(3));\n'); commit();
  const empty = run();
  expect(empty.status).toBe(1);
  expect(empty.stderr).toContain('executed no passing tests');
}, 60000);

test('changed tests and separate scripts inputs retain every related suite', () => {
  write('apps/mobile/lib/consumer.test.ts', 'test("changed test", () => expect(1).toBe(1));\n');
  write('scripts/value.ts', 'module.exports = 2;\n');
  write('scripts/value.test.ts', 'test("script", () => expect(require("./value")).toBe(2));\n'); commit();
  expect(plan()).toMatchObject({ mode: 'related', tests: {
    mobile: [join(directory, 'apps/mobile/lib/consumer.test.ts')], scripts: [join(directory, 'scripts/value.test.ts')],
  } });
});

test.each([
  ['packages/shared/src/value.ts', 'module.exports = 2;'],
  ['package-lock.json', '{}'],
  ['apps/mobile/jest.config.cjs', 'module.exports = {};'],
  ['scripts/jest.config.ts', 'module.exports = {};'],
  ['apps/mobile/lib/auth.ts', 'module.exports = 2;'],
  ['apps/api/lib/value.ts', 'module.exports = 2;'],
  ['scripts/verify/new-control.ts', 'module.exports = 2;'],
  ['scripts/unknown.py', 'value = 2'],
  ['unknown.ts', 'module.exports = 2;'],
  ['docs/runtime.ts', 'module.exports = 2;'],
])('uncertain or shared input %s expands to full tests', (path, content) => {
  write(path, content); commit();
  expect(plan()).toMatchObject({ mode: 'full', tests: {} });
});

test('one mapped file cannot hide an unmapped file, deleted source, or discovery error', () => {
  write('apps/mobile/lib/value.ts', 'module.exports = 2;\n');
  write('apps/mobile/lib/unmapped.ts', 'module.exports = 2;\n'); commit();
  expect(plan()).toMatchObject({ mode: 'full', reason: expect.stringContaining('No trustworthy related tests') });
  git('rm', 'apps/mobile/lib/unmapped.ts'); git('rm', 'apps/mobile/lib/value.ts'); commit();
  expect(plan().mode).toBe('full');
  write('apps/mobile/lib/value.ts', 'module.exports = 2;\n'); commit();
  write('apps/mobile/jest.config.cjs', 'throw new Error("broken graph");\n');
  expect(plan()).toMatchObject({ mode: 'full', reason: expect.stringContaining('discovery failed') });
});

test('push, missing comparison, and empty comparison never use a subset', () => {
  expect(plan().mode).toBe('full');
  write('apps/mobile/lib/value.ts', 'module.exports = 2;\n'); commit();
  expect(plan({ GITHUB_EVENT_NAME: 'push' }).mode).toBe('full');
  expect(plan({ FITSY_DIFF_BASE: 'unavailable' }).mode).toBe('full');
});
