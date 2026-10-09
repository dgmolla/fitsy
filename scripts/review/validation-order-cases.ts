import { shippingSessionCases } from './shipping-session-cases';
import { runPrFixture } from './round-runner-cases';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Fixture {
  root(): string;
  env(): NodeJS.ProcessEnv;
  setEnv(value: NodeJS.ProcessEnv): void;
  source: string;
  run(): ReturnType<typeof spawnSync>;
  git(...args: string[]): string;
  calls(): string;
}
export function validationOrderCases(f: Fixture) {
  function setup() {
    const root = f.root();
    for (const name of ['receipt-cache.mjs', 'review-admission.sh', 'shipping-session.mjs']) copyFileSync(join(f.source, 'scripts/verify', name), join(root, 'scripts/verify', name));
    writeFileSync(join(root, '.claude/lenses/workflow-security.md'), 'Review shipping controls.\n');
    writeFileSync(join(root, 'scripts/verify/registry.yml'), `checks:
  - name: structural
    script: cheap.sh
    layer: 0
    blocking: true
  - name: focused-tests
    script: focused.sh
    layer: 1
    blocking: true
  - name: review-admission
    script: review-admission.sh
    layer: 0
    stage: acceptance
    preflight: true
    blocking: true
  - name: test
    script: full.sh
    layer: 2
    cache: true
    blocking: true
`);
    writeFileSync(join(root, 'scripts/verify/cheap.sh'), `echo cheap >> .evidence/order\nif [ -f .evidence/cheap-fail ]; then exit 1; fi\nif [ -f .evidence/drift ]; then echo '// drift' >> app.ts; fi\necho '{"summary":"cheap checks"}'\n`);
    writeFileSync(join(root, 'scripts/verify/focused.sh'), `echo focused >> .evidence/order\necho '{"summary":"focused tests"}'\n`);
    writeFileSync(join(root, 'scripts/verify/full.sh'), `echo full >> .evidence/order\nif [ -f .evidence/full-fail ]; then exit 1; fi\necho '{"summary":"full tests"}'\n`);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { verify: 'node scripts/verify/run.mjs --layer=0-2 --scope=changed', 'verify:all': 'node scripts/verify/run.mjs --layer=all --scope=all' } }));
    copyFileSync(join(f.source, '.githooks/pre-push'), join(root, '.evidence/pre-push'));
    // The actual hook keeps its issue binding and timing publication contracts.
    mkdirSync(join(root, 'scripts/delivery'), { recursive: true });
    copyFileSync(join(f.source, 'scripts/delivery/phase-events.mjs'), join(root, 'scripts/delivery/phase-events.mjs'));
    for (const name of ['size-check', 'domain-check']) writeFileSync(join(root, `scripts/verify/${name}.sh`), 'exit 2\n');
    f.git('add', '-A'); f.git('commit', '-qm', 'validation fixture');
    rmSync(join(root, '.evidence/delivery/binding.json'));
    const bind = spawnSync(process.execPath, ['scripts/delivery/phase-events.mjs', 'bind', '--issue', '355'], { cwd: root, env: f.env(), encoding: 'utf8' });
    expect(bind.status).toBe(0);
  }
  function verify(args: string[] = [], hook = false) {
    return spawnSync(hook ? 'bash' : 'npm', hook ? ['.evidence/pre-push'] : ['run', 'verify', '--', ...args], {
      cwd: f.root(), encoding: 'utf8', timeout: 15000,
      env: { ...f.env(), FITSY_REVIEW_PROVIDER: 'claude', FITSY_REVIEW_MODEL: 'fixture-model' },
    });
  }
  const passingVerdict = JSON.stringify({ lens: 'correctness', verdict: 'pass', findings: [] });
  const failingVerdict = JSON.stringify({ lens: 'correctness', verdict: 'fail', findings: [{ severity: 'CONFIRMED', priority: 'P1', impact: 'shipping skips acceptance', file: 'app.ts', line: 1, summary: 'regression', scenario: 'bad candidate', fix: 'repair' }] });
  const order = () => readFileSync(join(f.root(), '.evidence/order'), 'utf8');
  const callCount = () => existsSync(f.calls()) ? readFileSync(f.calls(), 'utf8').trim().split('\n').length : 0;

  shippingSessionCases(f, setup, verify, order, callCount, passingVerdict, failingVerdict);
  test('persistently exported Claude profile runs fresh review before normal full verification', () => {
    setup();
    f.setEnv({ ...f.env(), FITSY_REVIEW_PROVIDER: 'claude', FITSY_REVIEW_MODEL: 'fixture-model' });
    const result = spawnSync('npm', ['run', 'verify'], { cwd: f.root(), env: f.env(), encoding: 'utf8', timeout: 15000 });
    expect(result.status).toBe(0); expect(order()).toContain('full'); expect(callCount()).toBe(1);
  });
  test('missing workflow lint tools block independent review and full acceptance', () => {
    setup();
    const root = f.root();
    mkdirSync(join(root, '.evidence/missing-tools'), { recursive: true });
    symlinkSync('/usr/bin/dirname', join(root, '.evidence/missing-tools/dirname'));
    copyFileSync(join(f.source, 'scripts/verify/actionlint.sh'), join(root, 'scripts/verify/actionlint.sh'));
    writeFileSync(join(root, 'scripts/verify/cheap.sh'), 'PATH="$PWD/.evidence/missing-tools" /bin/bash scripts/verify/actionlint.sh\n');
    f.git('add', '-A'); f.git('commit', '-qm', 'required workflow tool fixture');
    expect(f.run().status).toBe(1);
    expect(callCount()).toBe(0);
    const result = verify();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('required before verification');
    expect(existsSync(join(root, '.evidence/order'))).toBe(false);
  });
  test.each([['local', 'tracked edit'], ['local', 'committed head change'], ['PR', 'tracked edit']])('reviewer-window source drift blocks caching and full acceptance: %s %s', (mode, drift) => {
    setup();
    const root = f.root();
    const provider = join(root, 'bin/claude');
    const mutation = drift === 'focused selection change'
      ? `pathlib.Path(${JSON.stringify(join(root, '.evidence/verify'))}).mkdir(parents=True,exist_ok=True)\npathlib.Path(${JSON.stringify(join(root, '.evidence/verify/focused-tests.json'))}).write_text('{"version":1,"tests":["changed.test.ts"]}')`
      : `pathlib.Path(${JSON.stringify(join(root, 'app.ts'))}).write_text('export const value = 99;\\n')`;
    const commit = drift === 'committed head change'
      ? `\nimport subprocess\nsubprocess.run(['git','add','app.ts'],cwd=${JSON.stringify(root)},check=True)\nsubprocess.run(['git','commit','-qm','reviewer-window edit'],cwd=${JSON.stringify(root)},check=True)` : '';
    writeFileSync(provider, readFileSync(provider, 'utf8').replace('prompt=sys.stdin.read()', 'prompt=sys.stdin.read()\n' + mutation + commit));
    f.git('add', '-A'); f.git('commit', '-qm', 'reviewer-window mutation fixture');
    const result = mode === 'local' ? f.run() : runPrFixture(root, f.env());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('candidate changed during independent review');
    expect(callCount()).toBe(1);
    expect(readdirSync(join(root, 'cache')).filter(name => name.endsWith('.json'))).toHaveLength(0);
    const history = readFileSync(join(root, 'budgets/issue-355.jsonl'), 'utf8');
    expect(history).toContain('"event": "finish"');
    expect(verify().status).toBe(1);
    expect(order()).not.toContain('full');
  });
  test('uncommitted candidate stops local review before cheap checks or budget admission', () => {
    setup(); writeFileSync(join(f.root(), 'app.ts'), 'export const value = 9;\n');
    const result = f.run(); expect(result.status).toBe(1); expect(result.stderr).toContain('not frozen and committed');
    expect(callCount()).toBe(0); expect(existsSync(join(f.root(), '.evidence/order'))).toBe(false);
    expect(existsSync(join(f.root(), 'budgets/issue-355.jsonl'))).toBe(false);
  });
  test('verify:all admits the local production build only after review and fails on a broken build', () => {
    setup();
    const root = f.root();
    writeFileSync(join(root, 'scripts/verify/registry.yml'), readFileSync(join(root, 'scripts/verify/registry.yml'), 'utf8') + '  - name: build\n    script: build.sh\n    layer: 3\n    blocking: true\n    runs: [local, ci]\n');
    writeFileSync(join(root, 'scripts/verify/build.sh'), "echo build >> .evidence/order\n[ ! -f .evidence/build-fail ]\n");
    f.git('add', '-A'); f.git('commit', '-qm', 'local build acceptance fixture');
    const full = () => spawnSync('npm', ['run', 'verify:all'], { cwd: root, env: { ...f.env(), FITSY_REVIEW_PROVIDER: 'claude', FITSY_REVIEW_MODEL: 'fixture-model' }, encoding: 'utf8', timeout: 15000 });
    writeFileSync(join(root, 'verdict'), failingVerdict);
    expect(full().status).toBe(1); expect(order()).not.toContain('build');
    writeFileSync(join(root, 'verdict'), passingVerdict);
    writeFileSync(join(root, '.evidence/build-fail'), 'fail');
    const broken = full(); expect(broken.status).toBe(1); expect(order()).toContain('build');
    expect(broken.stdout.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ name: "build", status: "fail" }));
    expect(callCount()).toBe(2);
    expect(order()).not.toContain('full');
  });
  test('broken production build blocks pre-push and one repair permits full acceptance', () => {
    setup();
    const root = f.root();
    writeFileSync(join(root, 'scripts/verify/registry.yml'), readFileSync(join(root, 'scripts/verify/registry.yml'), 'utf8') + '  - name: build\n    script: build.sh\n    layer: 3\n    blocking: true\n    runs: [local, ci]\n');
    writeFileSync(join(root, 'scripts/verify/build.sh'), "echo build >> .evidence/order\n[ ! -f .evidence/build-fail ]\n");
    f.git('add', '-A'); f.git('commit', '-qm', 'pre-push build fixture');
    writeFileSync(join(root, '.evidence/build-fail'), 'fail');
    const broken = verify([], true);
    expect(broken.status).toBe(1); expect(order()).toContain('build'); expect(order()).not.toContain('full');
    expect(callCount()).toBe(1);
    rmSync(join(root, '.evidence/build-fail'));
    expect(verify([], true).status).toBe(0);
    expect(order().split('\n').filter(line => line === 'full')).toHaveLength(1);
    expect(callCount()).toBe(2);
  });
  test('cheap failure prevents actual reviewer, full suites and pre-push', () => {
    setup(); writeFileSync(join(f.root(), '.evidence/cheap-fail'), 'fail');
    expect(f.run().status).toBe(1); expect(callCount()).toBe(0);
    expect(verify().status).toBe(1); expect(verify([], true).status).toBe(1);
    expect(order()).not.toContain('full');
    expect(existsSync(join(f.root(), 'budgets/issue-355.jsonl'))).toBe(false);
  });
  test('failed review then repair defers full acceptance and retains all attempts and budget', () => {
    setup();
    writeFileSync(join(f.root(), 'verdict'), JSON.stringify({ lens: 'correctness', verdict: 'fail', findings: [{ severity: 'CONFIRMED', priority: 'P1', impact: 'shipping skips acceptance', file: 'app.ts', line: 1, summary: 'regression', scenario: 'bad candidate', fix: 'repair' }] }));
    const failed = verify();
    expect(failed.status).toBe(1);
    expect(order()).not.toContain('full'); expect(callCount()).toBe(1);
    const ledger = join(f.root(), 'budgets/issue-355.jsonl');
    if (!existsSync(ledger)) throw new Error(String(failed.stderr));
    const failedHistory = readFileSync(ledger, 'utf8');
    writeFileSync(join(f.root(), 'app.ts'), 'export const value = 3;\n');
    f.git('add', 'app.ts'); f.git('commit', '-qm', 'repair');
    writeFileSync(join(f.root(), 'verdict'), passingVerdict);
    // The repaired shipping entry point performs review and full acceptance once.
    expect(verify([], true).status).toBe(0);
    expect(order()).toContain('full'); expect(callCount()).toBe(2);
    expect(readFileSync(ledger, 'utf8').startsWith(failedHistory)).toBe(true);
    expect(readFileSync(ledger, 'utf8').trim().split('\n').map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ verdict: 'fail' }));
    expect(readdirSync(join(f.root(), '.evidence/verify/attempts')).length).toBeGreaterThanOrEqual(2);
    const retained = readFileSync(ledger, 'utf8');
    // Neither acceptance reuse nor another hook invocation grants a third review.
    expect(verify(['--reuse']).status).toBe(1);
    expect(callCount()).toBe(2);
    expect(readFileSync(ledger, 'utf8')).toBe(retained);
    expect(order().split('\n').filter(line => line === 'full')).toHaveLength(1);
  });
  test('source drift and changed heads require fresh review before full acceptance', () => {
    setup(); const review = f.run();
    if (review.status !== 0) throw new Error(String(review.stderr));
    writeFileSync(join(f.root(), '.evidence/drift'), 'drift');
    const drift = verify(); expect(drift.status).toBe(1); expect(drift.stdout).toContain('candidate changed during cheap checks');
    expect(order()).not.toContain('full');
    f.git('add', 'app.ts'); f.git('commit', '-qm', 'new candidate');
    // Stop the intentional edit but keep its raw failed attempt.
    writeFileSync(join(f.root(), 'scripts/verify/cheap.sh'), `echo cheap >> .evidence/order\necho '{"summary":"cheap"}'\n`);
    f.git('add', '-A'); f.git('commit', '-qm', 'stable candidate');
    writeFileSync(join(f.root(), 'verdict'), failingVerdict);
    expect(verify().status).toBe(1); expect(order()).not.toContain('full'); expect(callCount()).toBe(2);
  });
  test('failed full acceptance blocks the actual pre-push entry point', () => {
    setup();
    writeFileSync(join(f.root(), '.evidence/full-fail'), 'fail');
    const result = verify([], true); expect(result.status).toBe(1); expect(order()).toContain('full');
    expect(result.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ name: 'test', status: 'fail' })); expect(callCount()).toBe(1);
  });

  test('PR source stability never imports candidate-owned modules in authenticated controls', () => {
    const root = f.root();
    writeFileSync(join(root, 'scripts/verify/receipt-cache.mjs'), "import fs from 'node:fs'; fs.writeFileSync('candidate-import-marker', 'executed'); throw Error('candidate module executed');\n");
    f.git('add', 'scripts/verify/receipt-cache.mjs'); f.git('commit', '-qm', 'hostile source helper fixture');
    const result = runPrFixture(root, f.env());
    expect(result.status).toBe(0);
    expect(existsSync(join(root, 'candidate-import-marker'))).toBe(false);
  });
  test('explicit review-admission runs the real gate and fails until review passes', () => {
    setup();
    writeFileSync(join(f.root(), 'verdict'), failingVerdict);
    const absent = verify(['--only=review-admission']);
    expect(absent.status).toBe(1); expect(order()).not.toContain('full'); expect(callCount()).toBe(1);
    writeFileSync(join(f.root(), 'verdict'), passingVerdict);
    const reviewed = verify(['--only=review-admission']);
    expect(reviewed.status).toBe(0); expect(reviewed.stdout).toContain('review-admission'); expect(order()).not.toContain('full'); expect(callCount()).toBe(2);
  });
  test('candidate-generated cached pass cannot satisfy fresh shipping review admission', () => {
    setup();
    const root = f.root();
    const identity = spawnSync('bash', ['scripts/review/run-review.sh', '--local', '--identity'], { cwd: root,
      env: { ...f.env(), FITSY_REVIEW_PROVIDER: 'claude', FITSY_REVIEW_MODEL: 'fixture-model' }, encoding: 'utf8' });
    expect(identity.status).toBe(0);
    const key = JSON.parse(identity.stdout).cache_key;
    mkdirSync(String(f.env().FITSY_REVIEW_CACHE), { recursive: true });
    writeFileSync(join(String(f.env().FITSY_REVIEW_CACHE), key + '.json'), JSON.stringify({ verdict: 'pass',
      domains: { correctness: 'pass', 'workflow-security': 'pass' }, findings: [] }));
    writeFileSync(join(root, 'verdict'), JSON.stringify({ lens: 'correctness', verdict: 'fail', findings: [{ severity: 'CONFIRMED',
      priority: 'P1', impact: 'shipping skips review', file: 'app.ts', line: 1, summary: 'regression', scenario: 'bad candidate', fix: 'repair' }] }));
    const rejected = verify();
    expect(rejected.status).toBe(1); expect(callCount()).toBe(1); expect(order()).not.toContain('full');
  });
  test('fresh shipping source drift retains raw review and blocks full acceptance', () => {
    setup();
    const root = f.root(), provider = join(root, 'bin/claude');
    writeFileSync(provider, readFileSync(provider, 'utf8').replace('prompt=sys.stdin.read()',
      'prompt=sys.stdin.read()\npathlib.Path(' + JSON.stringify(join(root, 'app.ts')) + ").write_text('export const value = 99;\\n')"));
    f.git('add', 'bin/claude'); f.git('commit', '-qm', 'shipping-window mutation fixture');
    const result = verify();
    expect(result.status).toBe(1); expect(order()).not.toContain('full'); expect(callCount()).toBe(1);
    const attempts = readdirSync(join(root, '.evidence/review-admission'));
    expect(attempts).toHaveLength(1);
    expect(existsSync(join(root, '.evidence/review-admission', attempts[0]!, 'result.json'))).toBe(true);
    expect(readFileSync(join(root, 'budgets/issue-355.jsonl'), 'utf8')).toContain('"event": "finish"');
  });
  test('candidate reviewer controls cannot authorize fresh shipping admission', () => {
    setup();
    const root = f.root();
    writeFileSync(join(root, 'scripts/review/run-review.sh'), "#!/bin/sh\necho candidate-forged-pass\nexit 0\n");
    f.git('add', 'scripts/review/run-review.sh'); f.git('commit', '-qm', 'forged reviewer control fixture');
    writeFileSync(join(root, 'verdict'), failingVerdict);
    const rejected = verify();
    expect(rejected.status).toBe(1); expect(callCount()).toBe(1); expect(order()).not.toContain('full');
  });
  test('fresh execution refuses candidate controls outside the immutable main overlay', () => {
    writeFileSync(join(f.root(), 'REVIEW.md'), 'Candidate bypass rules\n');
    f.git('add', 'REVIEW.md'); f.git('commit', '-qm', 'candidate rules fixture');
    const rejected = spawnSync('bash', ['scripts/review/run-review.sh', '--local'], { cwd: f.root(),
      env: { ...f.env(), FITSY_REVIEW_FRESH_EXECUTION: '1', FITSY_REVIEW_PROVIDER: 'claude', FITSY_REVIEW_MODEL: 'fixture-model' }, encoding: 'utf8' });
    expect(rejected.status).toBe(1); expect(rejected.stderr).toContain('immutable main reviewer controls'); expect(callCount()).toBe(0);
  });
  test('candidate main refs cannot replace managed trusted reviewer controls', () => {
    setup();
    const root = f.root();
    writeFileSync(join(root, 'scripts/review/run-review.sh'), "#!/bin/sh\necho forged-main-pass\nexit 0\n");
    f.git('add', 'scripts/review/run-review.sh'); f.git('commit', '-qm', 'candidate main impersonation fixture');
    const changed = spawnSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: root, env: f.env(), encoding: 'utf8' });
    expect(changed.status).toBe(0);
    const rejected = verify();
    expect(rejected.status).toBe(1); expect(order()).not.toContain('full'); expect(callCount()).toBe(0);
  });
  test('fresh shipping preserves canonical GitHub repository context for the bound issue', () => {
    setup();
    const root = f.root(), gh = join(root, 'bin/gh');
    writeFileSync(gh, readFileSync(gh, 'utf8').replace('then\n  if', 'then\n  [ "$(git remote get-url origin 2>/dev/null)" = "https://github.com/dgmolla/fitsy.git" ] || exit 1\n  if'));
    f.git('add', 'bin/gh'); f.git('commit', '-qm', 'repository-context transport fixture');
    const accepted = verify();
    expect(accepted.status).toBe(0); expect(order()).toContain('full'); expect(callCount()).toBe(1);
  });
}
