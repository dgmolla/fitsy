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

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fitsy-impact-'));
  for (const file of ['impact-plan.mjs', 'run.mjs', 'secrets.sh', 'migration-safety.sh']) {
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
