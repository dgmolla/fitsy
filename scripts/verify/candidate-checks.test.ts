import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const source = resolve(__dirname, '../..');
let root: string;
let env: NodeJS.ProcessEnv;
function git(...args: string[]) {
  return execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function freeze() { git('add', '.'); git('commit', '-qm', 'candidate checks fixture'); }
function run(check = 'cheap') {
  return spawnSync(process.execPath, [join(source, 'scripts/verify/shipping-session.mjs'), '--candidate-checks', check],
    { cwd: root, env, encoding: 'utf8', timeout: 15000 });
}
function outcome(body: string) {
  writeFileSync(join(root, 'scripts/outcome.test.mjs'),
    `import {test} from 'node:test'; import assert from 'node:assert/strict'; import {writeFileSync} from 'node:fs'; test('candidate outcome', () => { ${body} });\n`);
  freeze();
}
beforeEach(() => {
  env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(GIT_|GITHUB_|CI$|POSTGRES_|FITSY_)/.test(key)));
  root = mkdtempSync(join(tmpdir(), 'fitsy-candidate-checks-'));
  mkdirSync(join(root, 'scripts/verify'), { recursive: true });
  for (const name of ['run.mjs', 'impact-plan.mjs', 'receipt-cache.mjs', 'focused-tests.mjs', 'focused-tests.sh', 'node-focused-reporter.mjs']) {
    copyFileSync(join(source, 'scripts/verify', name), join(root, 'scripts/verify', name));
  }
  chmodSync(join(root, 'scripts/verify/run.mjs'), 0o755);
  symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'), 'dir');
  writeFileSync(join(root, '.gitignore'), '.evidence/\nnode_modules\n');
  writeFileSync(join(root, 'package.json'), '{"name":"candidate-checks-fixture","private":true}\n');
  writeFileSync(join(root, 'value.txt'), 'frozen\n');
  writeFileSync(join(root, 'scripts/verify/registry.yml'), `checks:
  - name: focused-tests
    script: focused-tests.sh
    layer: 1
    blocking: true
    runs: [local]
`);
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test');
  freeze(); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  outcome("writeFileSync('.evidence/executed', 'yes'); assert.equal(2 + 2, 4);");
  const selected = spawnSync(process.execPath, ['scripts/verify/focused-tests.mjs', '--set', 'scripts/outcome.test.mjs'],
    { cwd: root, env, encoding: 'utf8' });
  expect(selected.status).toBe(0);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('local candidate entrypoint executes real focused checks without an App installation', () => {
  const result = run();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('selected reproduction/regression tests pass');
  expect(readFileSync(join(root, '.evidence/executed'), 'utf8')).toBe('yes');
});
test('failed focused assertion prevents candidate acceptance', () => {
  outcome('assert.equal(2 + 2, 5);');
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('focused tests failed');
});
test('dirty candidate is rejected before tests execute', () => {
  writeFileSync(join(root, 'value.txt'), 'uncommitted\n');
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('frozen and committed');
  expect(existsSync(join(root, '.evidence/executed'))).toBe(false);
});
test.each(['value.txt', '.evidence/verify/focused-tests.json'])('checks reject changes to %s during execution', path => {
  outcome(`writeFileSync(${JSON.stringify(path)}, 'changed');`);
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/frozen and committed|candidate or focused selection changed/);
});
test.each([0, 2])('push gates execute both checks and accept exit %i', code => {
  for (const check of ['size-check', 'domain-check']) {
    writeFileSync(join(root, `scripts/verify/${check}.sh`), `echo ${check} >> .evidence/order\nexit ${code}\n`);
  }
  freeze();
  expect(run('push-gates').status).toBe(0);
  expect(readFileSync(join(root, '.evidence/order'), 'utf8')).toBe('size-check\ndomain-check\n');
});
test.each(['size-check', 'domain-check'])('push gates preserve %s failures', failing => {
  for (const check of ['size-check', 'domain-check']) {
    writeFileSync(join(root, `scripts/verify/${check}.sh`), `exit ${check === failing ? 1 : 2}\n`);
  }
  freeze();
  expect(run('push-gates').status).toBe(1);
});
test('unsupported check cannot execute arbitrary commands', () => {
  expect(run('native').status).toBe(1);
  expect(existsSync(join(root, '.evidence/executed'))).toBe(false);
});
