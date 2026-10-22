import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { installedFixtureHook, timingHook, installVerificationFixture } from './hook-fixture';

const root = resolve(__dirname, '../..');
const yaml = require('js-yaml') as { load(value: string): unknown };
let directory: string;
// Registry fixtures own their inputs and never acquire the outer CI database.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(GIT_|GITHUB_|FITSY_DIFF_|FITSY_RUNS$|CI$|PR_NUMBER$|NODE_OPTIONS$|NODE_PATH$|POSTGRES_PRISMA_URL$|POSTGRES_URL_NON_POOLING$)/.test(key)));
const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', env }).trim();
const write = (file: string, value: string) => {
  mkdirSync(join(directory, file, '..'), { recursive: true });
  writeFileSync(join(directory, file), value);
};
const commit = () => { git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
const cli = (file: string, args: string[] = [], extra: Record<string, string> = {}) =>
  spawnSync(file.endsWith('.sh') ? 'bash' : process.execPath,
    [`scripts/verify/${file}`, ...args], { cwd: directory, encoding: 'utf8', env: { ...env, ...extra }, timeout: 30000 });
const plan = (extra: Record<string, string> = {}) => JSON.parse(cli('impact-plan.mjs', [], extra).stdout);
const event = (name: string, data: object) => { const path = join(directory, `.evidence/${name}.json`); write(`.evidence/${name}.json`, JSON.stringify(data)); return path; };

function wholeGroupFixture() {
  write('scripts/verify/test.sh', readFileSync(join(root, 'scripts/verify/test.sh'), 'utf8'));
  write('scripts/verify/registry.yml', 'checks:\n  - name: test\n    script: test.sh\n    layer: 2\n    blocking: true\n    cache: true\n    runs: [local, ci]\n');
  const quote = (value: string) => "'" + value.replace(/'/g, "'\"'\"'") + "'";
  // Only external test engines are fixtures; selection and test.sh are real.
  write('bin/node', `#!/bin/sh
if [ "$1" != --test ]; then exec ${quote(process.execPath)} "$@"; fi
echo scripts-node >> .evidence/group-calls
[ "\${FAIL_GROUP:-}" != scripts ]
`);
  write('bin/python3', '#!/bin/sh\necho scripts-python >> .evidence/group-calls\n[ "${FAIL_GROUP:-}" != scripts ]\n');
  write('bin/npm', `#!/bin/sh
case "$*" in
  *--workspace=apps/api*) group=api ;;
  *--workspace=@fitsy/scripts*) group=scripts ;;
  *--workspace=@fitsy/mobile*) group=mobile ;;
  *) echo 'unexpected test engine command' >&2; exit 1 ;;
esac
echo "$group" >> .evidence/group-calls
printf '%s\\n' "$*" >> .evidence/group-argv
[ "\${FAIL_GROUP:-}" != "$group" ]
`);
  for (const name of ['node', 'python3', 'npm']) chmodSync(join(directory, 'bin', name), 0o755);
  const base = commit(); git('update-ref', 'refs/remotes/origin/main', base);
  const calls = () => existsSync(join(directory, '.evidence/group-calls'))
    ? readFileSync(join(directory, '.evidence/group-calls'), 'utf8').trim().split('\n').filter(Boolean) : [];
  const run = (extra: Record<string, string> = {}, args = ['--layer=2', '--runs=ci', '--scope=changed']) => {
    write('.evidence/group-calls', ''); write('.evidence/group-argv', '');
    return cli('run.mjs', args, { PATH: `${join(directory, 'bin')}:${env.PATH}`, ...extra });
  };
  return { base, calls, run };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fitsy-impact-'));
  installVerificationFixture(root, directory);
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

test('scripts-only actual runner executes its whole group without API or mobile', () => {
  const fixture = wholeGroupFixture();
  write('scripts/review/example.py', 'changed = True\n'); const head = commit();
  const result = fixture.run({ CI: 'true', FITSY_DIFF_BASE: fixture.base, FITSY_DIFF_HEAD: head });
  expect({ status: result.status, stderr: result.status === 0 ? '' : result.stderr }).toEqual({ status: 0, stderr: '' });
  expect(fixture.calls()).toContain('scripts-node');
  expect(fixture.calls()).toContain('scripts-python');
  expect(fixture.calls()).toContain('scripts');
  expect(fixture.calls()).not.toContain('api');
  expect(fixture.calls()).not.toContain('mobile');
});

test.each([
  ['apps/api/lib/example.ts', ['api']],
  ['apps/mobile/lib/example.ts', ['mobile']],
  ['scripts/deploy/example.mjs', ['scripts']],
  ['packages/shared/src/example.ts', ['api', 'scripts', 'mobile']],
  ['prisma/schema.prisma', ['api', 'scripts', 'mobile']],
  ['package-lock.json', ['api', 'scripts', 'mobile']],
  ['scripts/package.json', ['api', 'scripts', 'mobile']],
  ['apps/mobile/jest.config.js', ['api', 'scripts', 'mobile']],
  ['apps/mobile/babel.config.js', ['api', 'scripts', 'mobile']],
  ['tsconfig.json', ['api', 'scripts', 'mobile']],
  ['scripts/verify/test.sh', ['api', 'scripts', 'mobile']],
  ['.github/workflows/verify.yml', ['api', 'scripts', 'mobile']],
  ['unknown/component.ts', ['api', 'scripts', 'mobile']],
  ['docs/guide.md', []],
] as [string, string[]][])('whole groups for %s reach the actual runner', (path, groups) => {
  const fixture = wholeGroupFixture();
  // Keep the actual test harness intact while still changing its source identity.
  write(path, path.endsWith('.json') ? '{"fixture":"changed"}\n'
    : (path === 'scripts/verify/test.sh' ? readFileSync(join(directory, path), 'utf8') : '') + '\n# changed fixture input\n');
  const head = commit();
  const extra = { CI: 'true', FITSY_DIFF_BASE: fixture.base, FITSY_DIFF_HEAD: head };
  expect(plan(extra).testGroups).toEqual(groups);
  const result = fixture.run(extra);
  expect({ status: result.status, stderr: result.status === 0 ? '' : result.stderr }).toEqual({ status: 0, stderr: '' });
  const actual = fixture.calls().filter(call => ['api', 'scripts', 'mobile'].includes(call));
  expect(actual).toEqual(groups);
  expect(fixture.calls().includes('scripts-node')).toBe(groups.includes('scripts'));
  expect(fixture.calls().includes('scripts-python')).toBe(groups.includes('scripts'));
  if (groups.includes('api')) expect(readFileSync(join(directory, '.evidence/group-argv'), 'utf8')).toContain('test:coverage');
});

test.each(['api', 'scripts', 'mobile'])('a failed selected whole %s group blocks acceptance', group => {
  const fixture = wholeGroupFixture();
  write('packages/shared/src/changed.ts', 'export const value = true;\n'); const head = commit();
  const result = fixture.run({ CI: 'true', FITSY_DIFF_BASE: fixture.base, FITSY_DIFF_HEAD: head, FAIL_GROUP: group });
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('"name":"test","status":"fail"');
  expect(fixture.calls().filter(call => ['api', 'scripts', 'mobile'].includes(call))).toEqual(['api', 'scripts', 'mobile']);
});

test('whole groups use the integrated main range and the actual pinned PR range', () => {
  const fixture = wholeGroupFixture();
  write('apps/api/lib/first.ts', 'export const first = true;\n'); commit();
  write('apps/mobile/lib/second.ts', 'export const second = true;\n'); const head = commit();
  git('update-ref', 'refs/remotes/origin/main', head);
  const main = { CI: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: event('groups-main', { before: fixture.base, after: head }) };
  expect(fixture.run(main).status).toBe(0);
  expect(fixture.calls()).toEqual(['api', 'mobile']);
  git('checkout', '--detach', fixture.base);
  const pr = { CI: 'true', GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: event('groups-pr', { pull_request: { base: { sha: fixture.base }, head: { sha: head } } }) };
  expect(fixture.run(pr).status).toBe(0);
  expect(fixture.calls()).toEqual(['api', 'mobile']);
});

test('whole groups retain dirty and untracked changes even with an explicit local head', () => {
  const fixture = wholeGroupFixture();
  write('scripts/review/example.py', 'value = True\n'); const head = commit();
  write('apps/mobile/lib/untracked.ts', 'export const dirty = true;\n');
  expect(JSON.parse(cli('impact-plan.mjs', [`--base=${fixture.base}`, `--head=${head}`]).stdout).testGroups).toEqual(['scripts', 'mobile']);
  const result = fixture.run({}, ['--layer=2', '--runs=local', '--scope=changed', `--base=${fixture.base}`]);
  expect(result.status).toBe(0);
  expect(fixture.calls().filter(call => ['api', 'scripts', 'mobile'].includes(call))).toEqual(['scripts', 'mobile']);
});

test('whole groups cover deleted and cross-group renamed paths', () => {
  const fixture = wholeGroupFixture();
  write('apps/api/lib/removed.ts', 'export const value = true;\n'); const base = commit();
  git('update-ref', 'refs/remotes/origin/main', base);
  git('rm', 'apps/api/lib/removed.ts'); const head = commit();
  expect(fixture.run({ CI: 'true', FITSY_DIFF_BASE: base, FITSY_DIFF_HEAD: head }).status).toBe(0);
  expect(fixture.calls()).toEqual(['api']);
  write('apps/api/lib/moved.ts', 'export const value = true;\n'); const renameBase = commit();
  mkdirSync(join(directory, 'scripts/review'), { recursive: true });
  git('mv', 'apps/api/lib/moved.ts', 'scripts/review/moved.ts'); const renamed = commit();
  expect(fixture.run({ CI: 'true', FITSY_DIFF_BASE: renameBase, FITSY_DIFF_HEAD: renamed }).status).toBe(0);
  expect(fixture.calls().filter(call => ['api', 'scripts', 'mobile'].includes(call))).toEqual(['api', 'scripts']);
});

test('whole groups expand unknown history and explicit all scope, and direct invocation defaults to full', () => {
  const fixture = wholeGroupFixture();
  write('scripts/review/example.py', 'value = True\n'); const head = commit();
  expect(fixture.run({ CI: 'true', FITSY_DIFF_BASE: '0'.repeat(40), FITSY_DIFF_HEAD: head }).status).toBe(0);
  expect(fixture.calls().filter(call => ['api', 'scripts', 'mobile'].includes(call))).toEqual(['api', 'scripts', 'mobile']);
  expect(fixture.run({ CI: 'true', FITSY_DIFF_BASE: fixture.base, FITSY_DIFF_HEAD: head },
    ['--layer=2', '--runs=ci', '--scope=all']).status).toBe(0);
  expect(fixture.calls().filter(call => ['api', 'scripts', 'mobile'].includes(call))).toEqual(['api', 'scripts', 'mobile']);
  write('.evidence/group-calls', '');
  const direct = cli('test.sh', [], { PATH: `${join(directory, 'bin')}:${env.PATH}` });
  expect(direct.status).toBe(0);
  expect(fixture.calls().filter(call => ['api', 'scripts', 'mobile'].includes(call))).toEqual(['api', 'scripts', 'mobile']);
});

test.each([
  ['scripts/review/example.py', 'base', ''],
  ['scripts/review/example.py', 'head', ''],
  ['docs/guide.md', 'base', ''],
  ['docs/guide.md', 'head', ''],
  ['docs/guide.md', 'base', 'mobile'],
])('unknown parent %s comparison --%s stays full downstream, failure=%s', (path, invalid, failure) => {
  const fixture = wholeGroupFixture();
  write(path, 'changed fixture input\n'); const head = commit();
  const extra = { CI: 'true', FITSY_DIFF_BASE: fixture.base, FITSY_DIFF_HEAD: head, FAIL_GROUP: failure };
  const invalidArg = `--${invalid}=${'0'.repeat(40)}`;
  expect(JSON.parse(cli('impact-plan.mjs', [invalidArg], extra).stdout).comparison.unknown).toBe(true);
  const result = fixture.run(extra, ['--layer=2', '--runs=ci', '--scope=changed', invalidArg]);
  expect(result.status).toBe(failure ? 1 : 0);
  expect(fixture.calls().filter(call => ['api', 'scripts', 'mobile'].includes(call)))
    .toEqual(['api', 'scripts', 'mobile']);
  expect(fixture.calls()).toContain('scripts-node');
  expect(fixture.calls()).toContain('scripts-python');
  if (failure) {
    expect(result.stdout).toContain('"name":"test","status":"fail"');
    expect(result.stderr).toContain('tests failed in: mobile');
  }
});

test('forged subset selectors cannot hide whole groups and a failed planner cannot pass', () => {
  const fixture = wholeGroupFixture();
  write('packages/shared/src/example.ts', 'export const value = true;\n'); const head = commit();
  expect(fixture.run({ CI: 'true', FITSY_DIFF_BASE: fixture.base, FITSY_DIFF_HEAD: head,
    FITSY_VERIFY_TEST_GROUPS: 'scripts', FITSY_TEST_GROUPS: 'scripts' }).status).toBe(0);
  expect(fixture.calls().filter(call => ['api', 'scripts', 'mobile'].includes(call))).toEqual(['api', 'scripts', 'mobile']);
  const forged = cli('test.sh', ['--scope=changed', '--groups=scripts'], { PATH: `${join(directory, 'bin')}:${env.PATH}` });
  expect(forged.status).toBe(1);
  write('bin/node', '#!/bin/sh\nexit 1\n');
  const broken = cli('test.sh', ['--scope=changed'], { PATH: `${join(directory, 'bin')}:${env.PATH}` });
  expect(broken.status).toBe(1);
  expect(broken.stdout).toContain('test group planning failed');
});

test('whole-group local receipts bind comparison and group definition; CI never reuses them', () => {
  const fixture = wholeGroupFixture();
  write('apps/api/lib/base.ts', 'export const value = 0;\n'); const apiBase = commit();
  write('apps/api/lib/base.ts', 'export const value = 1;\n'); commit();
  write('scripts/review/example.py', 'value = True\n'); commit();
  const local = ['--layer=2', '--runs=local', '--scope=changed', '--reuse'];
  expect(fixture.run({}, [...local, `--base=${apiBase}`]).stdout).not.toContain('"cached":true');
  expect(fixture.run({}, [...local, `--base=${apiBase}`]).stdout).toContain('"cached":true');
  expect(fixture.calls()).toEqual([]);
  // Same candidate/files/groups, a different base still retires the earlier proof.
  expect(fixture.run({}, [...local, `--base=${fixture.base}`]).stdout).not.toContain('"cached":true');
  const full = fixture.run({}, ['--layer=2', '--runs=local', '--scope=all', '--reuse']);
  expect(full.stdout).not.toContain('"cached":true');
  const ci = fixture.run({ CI: 'true', FITSY_DIFF_BASE: fixture.base, FITSY_DIFF_HEAD: git('rev-parse', 'HEAD') },
    ['--layer=2', '--runs=ci', '--scope=changed', '--reuse']);
  expect(ci.status).toBe(0); expect(ci.stdout).not.toContain('"cached":true');
  expect(fixture.calls()).toContain('api');
});

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

test('local caller comparison cannot hide code or dirty files; explicit CI range remains supported', () => {
  const before = git('rev-parse', 'HEAD');
  write('apps/mobile/committed.ts', 'export const committed = true;\n'); const head = commit();
  write('apps/mobile/dirty.ts', 'export const dirty = true;\n');
  const selectors = { FITSY_DIFF_BASE: 'HEAD', FITSY_DIFF_HEAD: 'HEAD' };
  expect(plan(selectors)).toMatchObject({ code: true, native: true,
    files: expect.arrayContaining(['apps/mobile/committed.ts', 'apps/mobile/dirty.ts']) });
  git('update-ref', 'refs/remotes/origin/main', head);
  expect(plan({ CI: 'true', FITSY_DIFF_BASE: before, FITSY_DIFF_HEAD: head })).toMatchObject({
    code: true, native: true, files: ['apps/mobile/committed.ts'] });
});

test('nested Markdown outside low-risk documentation paths keeps code jobs', () => {
  write('apps/api/README.md', 'API operations.\n');
  expect(plan()).toMatchObject({ documentationOnly: false, code: true, tests: true, build: true });
});


const ciBaselineNames = ['structural', 'secrets', 'context-freshness', 'size-check'];
function ciBaselineFixture(code = true) {
  type Step = { name?: string; run?: string };
  const workflow = yaml.load(readFileSync(join(root, '.github/workflows/verify.yml'), 'utf8')) as {
    jobs: Record<'classify' | 'static' | 'test' | 'build', { needs?: string | string[]; steps: Step[] }> };
  const baseline = workflow.jobs.classify.steps.find(step => step.name?.startsWith('Baseline checks'))?.run;
  const staticCommand = workflow.jobs.static.steps.find(step => step.name?.startsWith('Run L0-L1 checks'))?.run;
  expect(baseline).toBeTruthy(); expect(staticCommand).toBeTruthy();
  for (const job of ['static', 'test', 'build'] as const) {
    expect([workflow.jobs[job].needs].flat()).toContain('classify');
  }
  const registryText = readFileSync(join(root, 'scripts/verify/registry.yml'), 'utf8');
  const registry = yaml.load(registryText) as { checks: { name: string; script: string }[] };
  write('scripts/verify/registry.yml', registryText);
  for (const check of registry.checks) write(`scripts/verify/${check.script}`, `#!/bin/bash
printf '%s\n' '${check.name}' >> .evidence/baseline-calls
[ "\${FAIL_BASELINE:-}" != '${check.name}' ] || exit 1
[ '${check.name}' != size-check ] || [ "\${SIZE_NOT_APPLICABLE:-0}" != 1 ] || exit 2
printf '%s\n' '{"summary":"counted ${check.name}"}'
`);
  const before = commit();
  write(code ? 'apps/api/lib/changed.ts' : 'docs/changed.md', code ? 'export const changed = true;\n' : 'Documentation.\n');
  const after = commit();
  git('update-ref', 'refs/remotes/origin/main', after);
  const eventEnv = { CI: 'true', GITHUB_EVENT_NAME: 'push',
    GITHUB_EVENT_PATH: event('baseline-push', { before, after }) };
  expect(plan(eventEnv).code).toBe(code);
  const calls = () => readFileSync(join(directory, '.evidence/baseline-calls'), 'utf8').trim().split('\n');
  const run = (extra: Record<string, string> = {}) => {
    write('.evidence/baseline-calls', '');
    const baselineResult = spawnSync('bash', ['-c', baseline!],
      { cwd: directory, env: { ...env, ...eventEnv, ...extra }, encoding: 'utf8', timeout: 30000 });
    // This is the actual workflow needs/if route, not a fabricated passing status.
    const staticResult = baselineResult.status === 0 && code ? spawnSync('bash', ['-c', staticCommand!],
      { cwd: directory, env: { ...env, ...eventEnv, ...extra }, encoding: 'utf8', timeout: 30000 }) : null;
    return { baselineResult, staticResult };
  };
  return { run, calls };
}

test.each([true, false])('CI baseline checks execute once for code=%s', code => {
  const fixture = ciBaselineFixture(code);
  const { baselineResult, staticResult } = fixture.run();
  expect({ status: baselineResult.status, stderr: baselineResult.stderr }).toEqual({ status: 0, stderr: '' });
  if (code) expect(staticResult?.status).toBe(0);
  else expect(staticResult).toBeNull();
  for (const name of ciBaselineNames) expect(fixture.calls().filter(call => call === name)).toHaveLength(1);
  expect(fixture.calls().includes('lint')).toBe(code);
});

test.each(ciBaselineNames)('CI baseline failure in %s prevents static checks', name => {
  const fixture = ciBaselineFixture();
  const { baselineResult, staticResult } = fixture.run({ FAIL_BASELINE: name });
  expect(baselineResult.status).toBe(1); expect(staticResult).toBeNull();
  expect(fixture.calls().at(-1)).toBe(name);
  expect(fixture.calls()).not.toContain('lint');
});

test('CI ownership preserves size N/A, local safety checks and explicit standalone calls', () => {
  const fixture = ciBaselineFixture();
  const result = fixture.run({ SIZE_NOT_APPLICABLE: '1' });
  expect(result.baselineResult.status).toBe(0); expect(result.staticResult?.status).toBe(0);
  expect(fixture.calls().filter(name => name === 'size-check')).toHaveLength(1);
  write('.evidence/baseline-calls', '');
  const local = cli('run.mjs', ['--stage=cheap', '--layer=0-1', '--runs=local']);
  expect({ status: local.status, stderr: local.status === 0 ? '' : local.stderr }).toEqual({ status: 0, stderr: '' });
  for (const name of ciBaselineNames.filter(name => name !== 'size-check')) {
    expect(fixture.calls().filter(call => call === name)).toHaveLength(1);
  }
  write('.evidence/baseline-calls', '');
  expect(cli('run.mjs', ['--only=size-check', '--runs=ci']).status).toBe(0);
  expect(fixture.calls()).toEqual(['size-check']);
});

test('actual domain gate uses owned temporary storage and preserves routing', () => {
  for (const file of ['scripts/verify/domain-check.sh', 'scripts/verify/domain-allowlist-paths.mjs', 'scripts/route-reviewers.sh']) {
    write(file, readFileSync(join(root, file), 'utf8'));
  }
  const base = commit(); git('update-ref', 'refs/remotes/origin/main', base);
  write('apps/api/lib/example.ts', 'export const changed = true;\n'); commit();
  const result = cli('domain-check.sh');
  expect({ status: result.status, stderr: result.status === 0 ? '' : result.stderr }).toEqual({ status: 0, stderr: '' });
  expect(result.stdout).toContain('"status":"pass"');
  expect(result.stderr).toContain('domains:');
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

function cheapCacheFixture() {
  cacheFixture();
  write('scripts/verify/registry.yml', `checks:
  - name: resource-admission
    script: admission.sh
    layer: 0
    preflight: true
    blocking: true
  - name: focused-tests
    script: fixture.sh
    layer: 1
    cache: true
    blocking: true
`);
  write('scripts/verify/admission.sh', 'echo admission >> .evidence/admission-calls\necho \'{"status":"pass"}\'\n');
  write('.evidence/verify/focused-tests.json', JSON.stringify({ version: 1, tests: ['scripts/example.test.mjs'] }));
  commit(); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
}
const cheapReuse = ['--stage=cheap', '--layer=0-2', '--runs=local', '--scope=changed', '--reuse'];

test('cheap focused checks reuse a pass while resource admission executes every time', () => {
  cheapCacheFixture();
  expect(cli('run.mjs', cheapReuse).status).toBe(0);
  const second = cli('run.mjs', cheapReuse);
  expect(second.status).toBe(0); expect(second.stdout).toContain('"cached":true');
  expect(calls()).toBe(1); expect(calls('admission-calls')).toBe(2);
});

test.each(['missing', 'malformed', 'failed', 'expired', 'future', 'old-version'])(
  'cheap caller reruns a %s receipt instead of accepting stale evidence', state => {
    cheapCacheFixture();
    expect(cli('run.mjs', cheapReuse).status).toBe(0);
    const path = join(directory, '.evidence/verify/check-cache/focused-tests.json');
    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    if (state === 'missing') rmSync(path);
    else if (state === 'malformed') writeFileSync(path, '{');
    else {
      if (state === 'failed') receipt.result.status = 'fail';
      if (state === 'expired') receipt.finishedAt = Date.now() - 7 * 3600_000;
      if (state === 'future') receipt.finishedAt = Date.now() + 3600_000;
      if (state === 'old-version') receipt.version = 1;
      writeFileSync(path, JSON.stringify(receipt));
    }
    const second = cli('run.mjs', cheapReuse);
    expect(second.status).toBe(0); expect(second.stdout).not.toContain('"cached":true'); expect(calls()).toBe(2);
  });

test('cheap reuse binds commit comparison even when the selected file list is unchanged', () => {
  cheapCacheFixture();
  const base = git('rev-parse', 'HEAD');
  git('commit', '--allow-empty', '-qm', 'same files, different comparison');
  const head = git('rev-parse', 'HEAD');
  const first = [...cheapReuse, `--base=${base}`, `--head=${head}`];
  expect(cli('run.mjs', first).status).toBe(0);
  expect(cli('run.mjs', first).stdout).toContain('"cached":true'); expect(calls()).toBe(1);
  const changedBase = cli('run.mjs', [...cheapReuse, `--base=${head}`, `--head=${head}`]);
  expect(changedBase.status).toBe(0); expect(changedBase.stdout).not.toContain('"cached":true'); expect(calls()).toBe(2);
  const changedHead = cli('run.mjs', [...cheapReuse, `--base=${head}`, `--head=${base}`]);
  expect(changedHead.status).toBe(0); expect(changedHead.stdout).not.toContain('"cached":true'); expect(calls()).toBe(3);
  expect(cli('run.mjs', [...cheapReuse, '--base=missing-history']).stdout).not.toContain('"cached":true'); expect(calls()).toBe(4);
});

test('cheap reuse binds scope and the complete focused recipe including the name pattern', () => {
  cheapCacheFixture();
  expect(cli('run.mjs', cheapReuse).status).toBe(0);
  expect(cli('run.mjs', cheapReuse.map(arg => arg === '--scope=changed' ? '--scope=all' : arg)).stdout).not.toContain('"cached":true');
  expect(calls()).toBe(2);
  write('.evidence/verify/focused-tests.json', JSON.stringify({ version: 1, tests: ['scripts/example.test.mjs'], pattern: 'new assertion' }));
  expect(cli('run.mjs', cheapReuse).stdout).not.toContain('"cached":true'); expect(calls()).toBe(3);
});

test('cheap reuse retains installed dependency and genuine environment identity', () => {
  cheapCacheFixture();
  // Own the fixture dependency lock rather than changing the shared installed tree.
  rmSync(join(directory, 'node_modules'));
  mkdirSync(join(directory, 'node_modules'));
  symlinkSync(join(root, 'node_modules/js-yaml'), join(directory, 'node_modules/js-yaml'));
  write('node_modules/.package-lock.json', '{"fixture":1}');
  expect(cli('run.mjs', cheapReuse).status).toBe(0);
  write('node_modules/.package-lock.json', '{"fixture":2}');
  expect(cli('run.mjs', cheapReuse).stdout).not.toContain('"cached":true'); expect(calls()).toBe(2);
  expect(cli('run.mjs', cheapReuse, { FEATURE_FLAG: 'changed' }).stdout).not.toContain('"cached":true'); expect(calls()).toBe(3);
});

test('npm cheap results are reused by the real sanitized push hook and genuine environment changes rerun', () => {
  cheapCacheFixture();
  const hookEnv = timingHook(root, directory, env);
  // The fixture owner supplies the same fixed reuse flag as candidate_checks;
  // production fixed argv and custody are exercised in external-approval tests.
  const sessionFile = join(directory, 'scripts/verify/shipping-session.mjs');
  writeFileSync(sessionFile, readFileSync(sessionFile, 'utf8').replace("'--runs=local']", "'--runs=local','--reuse']"));
  write('.githooks/pre-push', installedFixtureHook(root, directory, true));
  chmodSync(join(directory, '.githooks/pre-push'), 0o755);
  commit(); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const initial = spawnSync('npm', ['run', 'verify', '--', ...cheapReuse],
    { cwd: directory, encoding: 'utf8', env: hookEnv, timeout: 30000 });
  expect({ status: initial.status, output: initial.status === 0 ? '' : initial.stdout + initial.stderr }).toEqual({ status: 0, output: '' });
  const remote = join(directory, '.evidence/remote.git');
  execFileSync('git', ['init', '--bare', '-q', remote], { cwd: directory, env });
  const push = (ref: string, extra = {}) => spawnSync('git', ['-c', 'core.hooksPath=.githooks', 'push', remote, `HEAD:refs/heads/${ref}`],
    { cwd: directory, encoding: 'utf8', env: { ...hookEnv, ...extra }, timeout: 30000 });
  const reused = push('reused');
  expect({ status: reused.status, output: reused.status === 0 ? '' : reused.stdout + reused.stderr }).toEqual({ status: 0, output: '' });
  expect(reused.stdout + reused.stderr).toContain('"cached":true'); expect(calls()).toBe(1);
  expect(calls('admission-calls')).toBe(2); expect(calls('size-calls')).toBe(1); expect(calls('domain-calls')).toBe(1);
  const changed = push('changed', { FEATURE_FLAG: 'different' });
  expect(changed.status).toBe(0); expect(changed.stdout + changed.stderr).not.toContain('"cached":true'); expect(calls()).toBe(2);
  expect(calls('admission-calls')).toBe(3); expect(calls('size-calls')).toBe(2); expect(calls('domain-calls')).toBe(2);
});

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

test('CI-first real push preserves prior unit receipt without rerunning heavy checks', () => {
  cacheFixture();
  const hookEnv = timingHook(root, directory, env);
  write('.githooks/pre-push', installedFixtureHook(root, directory, true));
  chmodSync(join(directory, '.githooks/pre-push'), 0o755);
  commit(); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const local = spawnSync('npm', ['run', 'verify', '--', '--runs=local'],
    { cwd: directory, encoding: 'utf8', env: hookEnv, timeout: 30000 });
  expect({ status: local.status, output: local.status === 0 ? '' : `${local.error?.message}\n${local.stdout}\n${local.stderr}` }).toEqual({ status: 0, output: '' }); expect(calls()).toBe(1);
  const receiptFile = join(directory, '.evidence/verify/check-cache/test.json');
  const receipt = readFileSync(receiptFile, 'utf8');
  const remote = join(directory, '.evidence/remote.git');
  execFileSync('git', ['init', '--bare', '-q', remote], { cwd: directory, env });
  const pushed = spawnSync('git', ['-c', 'core.hooksPath=.githooks', 'push', remote, 'HEAD:refs/heads/candidate'],
    { cwd: directory, encoding: 'utf8', env: { ...hookEnv, FEATURE_FLAG: 'different' }, timeout: 30000 });
  expect(pushed.status).toBe(0); expect(calls()).toBe(1);
  expect(readFileSync(receiptFile, 'utf8')).toBe(receipt);
  expect(pushed.stdout + pushed.stderr).not.toMatch(/"name":"test"/);
  expect(readFileSync(join(directory, '.evidence/gh-calls'), 'utf8')).toContain('POST repos/dgmolla/fitsy/issues/355/comments');
});

test('pre-push refuses an unbound issue before checks or publication', () => {
  cacheFixture();
  const hookEnv = timingHook(root, directory, env);
  write('.githooks/pre-push', installedFixtureHook(root, directory));
  rmSync(join(directory, '.evidence/delivery/binding.json'));
  const hook = spawnSync('bash', ['.githooks/pre-push'], { cwd: directory, encoding: 'utf8', env: hookEnv, timeout: 30000 });
  expect({ status: hook.status, output: hook.status === 1 ? '' : `${hook.error?.message}\n${hook.stdout}\n${hook.stderr}` }).toEqual({ status: 1, output: '' }); expect(hook.stderr).toContain('bind --issue N');
  expect(existsSync(join(directory, '.evidence/gh-calls'))).toBe(false);
});

test('pre-push accepts an inapplicable domain gate but refuses its real failure', () => {
  cacheFixture();
  const hookEnv = timingHook(root, directory, env);
  write('.githooks/pre-push', installedFixtureHook(root, directory));
  write('scripts/verify/domain-check.sh', 'echo \'{"status":"skipped"}\'\nexit 2\n');
  const hook = () => spawnSync('bash', ['.githooks/pre-push'], { cwd: directory, encoding: 'utf8', env: hookEnv, timeout: 30000 });
  const initial = hook();
  expect({ status: initial.status, output: initial.status === 0 ? '' : `${initial.error?.message}\n${initial.stdout}\n${initial.stderr}` }).toEqual({ status: 0, output: '' });
  const before = readFileSync(join(directory, '.evidence/gh-calls'), 'utf8').split('\n').filter(line => line.startsWith('POST ')).length;
  write('scripts/verify/domain-check.sh', 'echo \'{"status":"fail"}\'\nexit 1\n');
  expect(hook().status).toBe(1);
  expect(readFileSync(join(directory, '.evidence/gh-calls'), 'utf8').split('\n').filter(line => line.startsWith('POST '))).toHaveLength(before);
});

test('real Git push hook preserves outer refs, isolates Git and reruns cheap size/domain gates', () => {
  cacheFixture();
  const hookEnv = timingHook(root, directory, env);
  write('scripts/verify/fixture.sh', `mkdir -p .evidence/inner\ngit -C .evidence/inner init -q\ngit -C .evidence/inner config user.name fixture\ngit -C .evidence/inner config user.email fixture@example.test\necho nested > .evidence/inner/file\ngit -C .evidence/inner add file\ngit -C .evidence/inner commit -qm nested\ngit -C .evidence/inner checkout -qb nested\ntest "$(git -C .evidence/inner branch --show-current)" = nested\necho run >> .evidence/calls\necho '{"summary":"actual check"}'\n`);
  write('.githooks/pre-push', installedFixtureHook(root, directory));
  chmodSync(join(directory, '.githooks/pre-push'), 0o755);
  git('add', '.'); git('commit', '-qm', 'hook fixture'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('config', 'core.hooksPath', '.githooks');
  const before = git('rev-parse', 'HEAD'), branch = git('branch', '--show-current'), status = git('status', '--porcelain');
  const remote = join(directory, '.evidence/remote.git');
  execFileSync('git', ['init', '--bare', '-q', remote], { cwd: directory, env });
  const push = (ref: string) => spawnSync('git', ['push', remote, `HEAD:refs/heads/${ref}`],
    { cwd: directory, env: hookEnv, encoding: 'utf8', timeout: 30000 });
  const first = push('first'); expect(first.status).toBe(0); expect(existsSync(join(directory, '.evidence/calls'))).toBe(false);
  const second = push('second'); expect(second.status).toBe(0);
  expect(second.stdout + second.stderr).not.toMatch(/"name":"test"/); expect(existsSync(join(directory, '.evidence/calls'))).toBe(false);
  expect(calls('size-calls')).toBe(2); expect(calls('domain-calls')).toBe(2);
  expect(git('rev-parse', 'HEAD')).toBe(before);
  expect(git('branch', '--show-current')).toBe(branch);
  expect(git('status', '--porcelain')).toBe(status);
});
