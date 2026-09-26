import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const root = resolve(__dirname, '../..');
const yaml = require('js-yaml') as { load(value: string): unknown };
let directory: string;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(GIT_|GITHUB_|FITSY_DIFF_|FITSY_RUNS$|CI$|PR_NUMBER$)/.test(key)));
const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', env }).trim();
const write = (file: string, value: string) => {
  mkdirSync(join(directory, file, '..'), { recursive: true });
  writeFileSync(join(directory, file), value);
};
const commit = () => { git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
const cli = (file: string, args: string[] = [], extra: Record<string, string> = {}) =>
  spawnSync(file.endsWith('.sh') ? 'bash' : process.execPath,
    [`scripts/verify/${file}`, ...args], { cwd: directory, encoding: 'utf8', env: { ...env, ...extra }, timeout: 15000 });
const plan = (extra: Record<string, string> = {}) => JSON.parse(cli('impact-plan.mjs', [], extra).stdout);
const event = (name: string, data: object) => { const path = join(directory, `.evidence/${name}.json`); write(`.evidence/${name}.json`, JSON.stringify(data)); return path; };
function timingHook() {
  write('scripts/delivery/phase-events.mjs', readFileSync(join(root, 'scripts/delivery/phase-events.mjs'), 'utf8'));
  write('package.json', JSON.stringify({ private: true, scripts: { verify: 'node scripts/verify/run.mjs --layer=0-2 --scope=changed' } }));
  const bound = spawnSync(process.execPath, ['scripts/delivery/phase-events.mjs', 'bind', '--issue', '355'],
    { cwd: directory, env, encoding: 'utf8' });
  expect(bound.status).toBe(0);
  write('bin/gh', '#!/bin/sh\necho "$3 $4" >> .evidence/gh-calls\ncase "$4" in user) echo \'{"login":"fixture"}\' ;; *"/comments?"*) echo \'[]\' ;; */comments) cat >/dev/null; echo \'{"id":1}\' ;; *) exit 1 ;; esac\n');
  chmodSync(join(directory, 'bin/gh'), 0o755);
  return { ...env, PATH: `${join(directory, 'bin')}:${env.PATH}` };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fitsy-impact-'));
  for (const file of ['impact-plan.mjs', 'local-db.mjs', 'db-lock.py', 'receipt-cache.mjs', 'run.mjs', 'run.sh', 'secrets.sh', 'migration-safety.sh']) {
    write(`scripts/verify/${file}`, readFileSync(join(root, 'scripts/verify', file), 'utf8'));
  }
  write('.gitignore', 'node_modules\n.evidence/\n');
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'));
  git('init', '-q');
  git('config', 'user.name', 'CLI test');
  git('config', 'user.email', 'test@example.test');
  git('config', 'core.hooksPath', '/dev/null');
  commit();
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

test('actual main push selects a matching advisory check after origin/main advances', () => {
  write('scripts/verify/registry.yml', 'checks:\n  - name: test\n    script: fixture.sh\n    layer: 2\n    blocking: shadow\n    runs: [ci]\n    paths: ["apps/api/**"]\n');
  write('scripts/verify/fixture.sh', 'echo \'{"summary":"L2 ran"}\'\n');
  const before = commit();
  git('update-ref', 'refs/remotes/origin/main', before);
  write('apps/api/lib/example.ts', 'export const changed = true;\n');
  commit();
  write('docs/guide.md', 'Documentation.\n');
  const after = commit();
  git('update-ref', 'refs/remotes/origin/main', after);
  const extra = { CI: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: event('push', { before, after }) };
  expect(plan(extra)).toMatchObject({ tests: true, build: true, files: ['apps/api/lib/example.ts', 'docs/guide.md'] });
  const result = cli('run.mjs', ['--layer=2', '--runs=ci', '--scope=changed'], extra);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('L2 ran');
});

test('nested Markdown outside low-risk documentation paths keeps code jobs', () => {
  write('apps/api/README.md', 'API operations.\n');
  expect(plan()).toMatchObject({ documentationOnly: false, code: true, tests: true, build: true });
});

test('the actual workflow baseline stops when its secret check fails', () => {
  const workflow = yaml.load(readFileSync(join(root, '.github/workflows/verify.yml'), 'utf8')) as {
    jobs: { classify: { steps: { name?: string; run?: string }[] } } };
  const baseline = workflow.jobs.classify.steps.find(step => step.name?.startsWith('Baseline checks'))?.run;
  expect(baseline).toBeTruthy();
  write('scripts/verify/structural.sh', 'exit 0\n');
  write('scripts/verify/secrets.sh', 'exit 1\n');
  mkdirSync(join(directory, '.evidence'), { recursive: true });
  write('scripts/verify/context-freshness.sh', 'echo later > .evidence/later\n');
  write('scripts/verify/size-check.sh', 'exit 0\n');
  const result = spawnSync('bash', ['-c', baseline!], { cwd: directory, env, encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(existsSync(join(directory, '.evidence/later'))).toBe(false);
});

test('actual main documentation push selects no code jobs after origin/main advances', () => {
  const before = git('rev-parse', 'HEAD');
  write('docs/guide.md', 'Documentation.\n');
  const after = commit();
  git('update-ref', 'refs/remotes/origin/main', after);
  const output = join(directory, '.evidence/github-output');
  const extra = { CI: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: event('push', { before, after }), GITHUB_OUTPUT: output };
  const result = cli('impact-plan.mjs', ['--github-output'], extra);
  expect(result.status).toBe(0);
  expect(plan(extra)).toMatchObject({ documentationOnly: true, code: false, tests: false, build: false, files: ['docs/guide.md'] });
  expect(readFileSync(output, 'utf8')).toContain('tests=false');
});

test('PR selection uses pinned head, not the current checkout', () => {
  const base = git('rev-parse', 'HEAD');
  write('apps/mobile/example.ts', 'export const changed = true;\n');
  const head = commit();
  git('checkout', '--detach', base);
  write('docs/local.md', 'Local.\n');
  commit();
  const extra = { CI: 'true', GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: event('pr', { pull_request: { base: { sha: base }, head: { sha: head } } }) };
  expect(plan(extra)).toMatchObject({ tests: true, native: true, files: ['apps/mobile/example.ts'] });
});

test('local dirty and untracked code remain visible, and only health is native-exempt', () => {
  write('docs/guide.md', 'Documentation.\n');
  expect(plan().documentationOnly).toBe(true);
  write('apps/api/app/api/health/route.ts', 'export const GET = true;\n');
  expect(plan()).toMatchObject({ code: true, native: false });
  write('apps/api/app/api/unknown/route.ts', 'export const GET = true;\n');
  expect(plan().native).toBe(true);
});

test('unavailable event history fails closed for code selection', () => {
  const after = git('rev-parse', 'HEAD');
  const extra = { CI: 'true', GITHUB_EVENT_NAME: 'push',
    GITHUB_EVENT_PATH: event('push', { before: '0'.repeat(40), after }) };
  expect(plan(extra)).toMatchObject({ code: true, tests: true, build: true, comparison: { unknown: true } });
  expect(cli('impact-plan.mjs', ['--files'], extra).status).toBe(1);
});

test('mandatory migration and secret checks use the exact main push range', () => {
  const before = git('rev-parse', 'HEAD');
  write('prisma/migrations/20260926_unsafe/migration.sql', 'DROP TABLE Example;\n');
  write('apps/api/.env.private', 'A=placeholder\n');
  const after = commit();
  git('update-ref', 'refs/remotes/origin/main', after);
  const extra = { CI: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: event('push', { before, after }) };
  expect(cli('migration-safety.sh', [], extra).status).toBe(1);
  expect(cli('secrets.sh', [], extra).status).toBe(1);
});

test('the actual secrets CLI passes the entire pushed history to gitleaks', () => {
  const before = git('rev-parse', 'HEAD');
  write('docs/first.md', 'First commit.\n'); commit();
  write('docs/second.md', 'Second commit.\n'); const after = commit();
  git('update-ref', 'refs/remotes/origin/main', after);
  write('bin/gitleaks', '#!/bin/sh\nprintf "%s\\n" "$@" > .evidence/gitleaks-args\n');
  chmodSync(join(directory, 'bin/gitleaks'), 0o755);
  const extra = { CI: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: event('push', { before, after }),
    PATH: join(directory, 'bin') + ':' + env.PATH };
  expect(cli('secrets.sh', [], extra).status).toBe(0);
  expect(readFileSync(join(directory, '.evidence/gitleaks-args'), 'utf8')).toContain(`--log-opts=${before}..${after}`);
});

test('the local runner cannot hide an untracked private env file from secrets', () => {
  write('scripts/verify/registry.yml', 'checks:\n  - name: secrets\n    script: secrets.sh\n    layer: 0\n    blocking: true\n    runs: [local]\n');
  commit(); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  write('apps/api/.env.private', 'PLACEHOLDER=value\n');
  expect(cli('run.mjs', ['--only=secrets', '--runs=local']).status).toBe(1);
});

function cacheFixture() {
  write('scripts/verify/registry.yml', 'checks:\n  - name: test\n    script: fixture.sh\n    layer: 2\n    blocking: true\n    cache: true\n');
  write('scripts/verify/fixture.sh', `mkdir -p .evidence\necho run >> .evidence/calls\necho '{"summary":"actual check"}'\nexit "\${FIXTURE_EXIT:-0}"\n`);
  write('scripts/verify/size-check.sh', 'echo size >> .evidence/size-calls\necho \'{"status":"pass"}\'\n');
  write('scripts/verify/domain-check.sh', 'echo domain >> .evidence/domain-calls\necho \'{"status":"pass"}\'\n');
  commit(); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  write('scripts/example.mjs', 'export const x = 1;\n'); commit();
}
const calls = (file = 'calls') => readFileSync(join(directory, `.evidence/${file}`), 'utf8').trim().split('\n').length;

test('unchanged successful L2 is reused; source, environment, and definition changes rerun it', () => {
  cacheFixture();
  expect(cli('run.mjs', ['--layer=2']).status).toBe(0); expect(calls()).toBe(1);
  expect(cli('run.mjs', ['--layer=2', '--reuse']).stdout).toContain('"cached":true'); expect(calls()).toBe(1);
  write('scripts/example.mjs', 'export const x = 2;\n');
  expect(cli('run.mjs', ['--layer=2', '--reuse']).status).toBe(0); expect(calls()).toBe(2);
  expect(cli('run.mjs', ['--layer=2', '--reuse'], { FEATURE_FLAG: 'changed' }).status).toBe(0); expect(calls()).toBe(3);
  write('scripts/verify/fixture.sh', readFileSync(join(directory, 'scripts/verify/fixture.sh'), 'utf8') + '# new assertion\n');
  expect(cli('run.mjs', ['--layer=2', '--reuse']).status).toBe(0); expect(calls()).toBe(4);
});

test('failed and expired receipts never become a reusable pass', () => {
  cacheFixture();
  expect(cli('run.mjs', ['--layer=2'], { FIXTURE_EXIT: '1' }).status).toBe(1);
  expect(cli('run.mjs', ['--layer=2', '--reuse'], { FIXTURE_EXIT: '1' }).status).toBe(1); expect(calls()).toBe(2);
  expect(cli('run.mjs', ['--layer=2']).status).toBe(0);
  const receiptFile = join(directory, '.evidence/verify/check-cache/test.json');
  const receipt = JSON.parse(readFileSync(receiptFile, 'utf8')); receipt.finishedAt = 0;
  writeFileSync(receiptFile, JSON.stringify(receipt));
  expect(cli('run.mjs', ['--layer=2', '--reuse']).stdout).not.toContain('"cached":true'); expect(calls()).toBe(4);
  write('apps/api/.env.local', 'FEATURE_FLAG=changed\n');
  expect(cli('run.mjs', ['--layer=2', '--reuse']).stdout).not.toContain('"cached":true'); expect(calls()).toBe(5);
});

test('a fresh failed run invalidates an older successful receipt with the same inputs', () => {
  cacheFixture();
  write('scripts/verify/fixture.sh', `mkdir -p .evidence\necho run >> .evidence/calls\necho '{"summary":"actual check"}'\ntest ! -e .evidence/force-fail\n`);
  expect(cli('run.mjs', ['--layer=2']).status).toBe(0);
  write('.evidence/force-fail', '1');
  expect(cli('run.mjs', ['--layer=2']).status).toBe(1);
  rmSync(join(directory, '.evidence/force-fail'));
  const retry = cli('run.mjs', ['--layer=2', '--reuse']);
  expect(retry.status).toBe(0); expect(retry.stdout).not.toContain('"cached":true'); expect(calls()).toBe(3);
});

test('source mutation during a cached run retires the prior receipt', () => {
  cacheFixture();
  write('scripts/verify/registry.yml', readFileSync(join(directory, 'scripts/verify/registry.yml'), 'utf8') +
    '  - name: mutator\n    script: mutator.sh\n    layer: 2\n    blocking: true\n');
  write('scripts/verify/mutator.sh', `if [ -e .evidence/mutate ]; then echo 'export const x = 2;' > scripts/example.mjs; fi\necho '{"summary":"mutation check"}'\n`);
  const original = readFileSync(join(directory, 'scripts/example.mjs'), 'utf8');
  expect(cli('run.mjs', ['--layer=2']).status).toBe(0);
  write('.evidence/mutate', '1');
  const changed = cli('run.mjs', ['--layer=2', '--reuse']);
  expect(changed.status).toBe(1); expect(changed.stdout).toContain('"name":"source-stability"');
  write('scripts/example.mjs', original); rmSync(join(directory, '.evidence/mutate'));
  const retry = cli('run.mjs', ['--layer=2', '--reuse']);
  expect(retry.status).toBe(0); expect(retry.stdout).not.toContain('"cached":true'); expect(calls()).toBe(2);
});

test('npm verify evidence is reused by the unchanged-source hook invocation', () => {
  cacheFixture();
  const hookEnv = timingHook();
  write('.githooks/pre-push', readFileSync(join(root, '.githooks/pre-push'), 'utf8'));
  const npm = spawnSync('npm', ['run', 'verify'], { cwd: directory, encoding: 'utf8', env: hookEnv, timeout: 15000 });
  expect(npm.status).toBe(0); expect(calls()).toBe(1);
  const hook = spawnSync('bash', ['.githooks/pre-push'], { cwd: directory, encoding: 'utf8', env: hookEnv, timeout: 15000 });
  expect(hook.status).toBe(0); expect(hook.stdout).toContain('"cached":true'); expect(calls()).toBe(1);
  expect(readFileSync(join(directory, '.evidence/gh-calls'), 'utf8')).toContain('POST repos/dgmolla/fitsy/issues/355/comments');
  const changed = spawnSync('bash', ['.githooks/pre-push'],
    { cwd: directory, encoding: 'utf8', env: { ...hookEnv, FITSY_TEST_CHANGED: '1' }, timeout: 15000 });
  expect(changed.status).toBe(0); expect(changed.stdout).not.toContain('"cached":true'); expect(calls()).toBe(2);
});

test('pre-push refuses an unbound issue before checks or publication', () => {
  cacheFixture();
  const hookEnv = timingHook();
  write('.githooks/pre-push', readFileSync(join(root, '.githooks/pre-push'), 'utf8'));
  rmSync(join(directory, '.evidence/delivery/binding.json'));
  const hook = spawnSync('bash', ['.githooks/pre-push'], { cwd: directory, encoding: 'utf8', env: hookEnv, timeout: 15000 });
  expect(hook.status).toBe(1); expect(hook.stderr).toContain('bind --issue N');
  expect(existsSync(join(directory, '.evidence/gh-calls'))).toBe(false);
});

test('pre-push accepts an inapplicable domain gate but refuses its real failure', () => {
  cacheFixture();
  const hookEnv = timingHook();
  write('.githooks/pre-push', readFileSync(join(root, '.githooks/pre-push'), 'utf8'));
  write('scripts/verify/domain-check.sh', 'echo \'{"status":"skipped"}\'\nexit 2\n');
  const hook = () => spawnSync('bash', ['.githooks/pre-push'], { cwd: directory, encoding: 'utf8', env: hookEnv, timeout: 15000 });
  expect(hook().status).toBe(0);
  const before = readFileSync(join(directory, '.evidence/gh-calls'), 'utf8').split('\n').filter(line => line.startsWith('POST ')).length;
  write('scripts/verify/domain-check.sh', 'echo \'{"status":"fail"}\'\nexit 1\n');
  expect(hook().status).toBe(1);
  expect(readFileSync(join(directory, '.evidence/gh-calls'), 'utf8').split('\n').filter(line => line.startsWith('POST '))).toHaveLength(before);
});

test('real Git push hook preserves outer refs, isolates nested Git, reuses L2, and reruns size/domain gates', () => {
  cacheFixture();
  const hookEnv = timingHook();
  write('scripts/verify/fixture.sh', `mkdir -p .evidence/inner\ngit -C .evidence/inner init -q\ngit -C .evidence/inner config user.name fixture\ngit -C .evidence/inner config user.email fixture@example.test\necho nested > .evidence/inner/file\ngit -C .evidence/inner add file\ngit -C .evidence/inner commit -qm nested\ngit -C .evidence/inner checkout -qb nested\ntest "$(git -C .evidence/inner branch --show-current)" = nested\necho run >> .evidence/calls\necho '{"summary":"actual check"}'\n`);
  write('.githooks/pre-push', readFileSync(join(root, '.githooks/pre-push'), 'utf8'));
  chmodSync(join(directory, '.githooks/pre-push'), 0o755);
  git('add', '.'); git('commit', '-qm', 'hook fixture'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('config', 'core.hooksPath', '.githooks');
  const before = git('rev-parse', 'HEAD'), branch = git('branch', '--show-current'), status = git('status', '--porcelain');
  const remote = join(directory, '.evidence/remote.git');
  execFileSync('git', ['init', '--bare', '-q', remote], { cwd: directory, env });
  const push = (ref: string) => spawnSync('git', ['push', remote, `HEAD:refs/heads/${ref}`],
    { cwd: directory, env: hookEnv, encoding: 'utf8', timeout: 15000 });
  const first = push('first'); expect(first.status).toBe(0); expect(calls()).toBe(1);
  const second = push('second'); expect(second.status).toBe(0);
  expect(second.stdout + second.stderr).toContain('"cached":true'); expect(calls()).toBe(1);
  expect(calls('size-calls')).toBe(2); expect(calls('domain-calls')).toBe(2);
  expect(git('rev-parse', 'HEAD')).toBe(before);
  expect(git('branch', '--show-current')).toBe(branch);
  expect(git('status', '--porcelain')).toBe(status);
});
