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
    for (const name of ['receipt-cache.mjs', 'review-admission.sh']) copyFileSync(join(f.source, 'scripts/verify', name), join(root, 'scripts/verify', name));
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
  const order = () => readFileSync(join(f.root(), '.evidence/order'), 'utf8');
  const callCount = () => existsSync(f.calls()) ? readFileSync(f.calls(), 'utf8').trim().split('\n').length : 0;

  test('persistently exported Claude profile admits normal full verification without another reviewer', () => {
    setup();
    f.setEnv({ ...f.env(), FITSY_REVIEW_PROVIDER: 'claude', FITSY_REVIEW_MODEL: 'fixture-model' });
    expect(f.run().status).toBe(0);
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
  test('focused selection changes invalidate review before full acceptance', () => {
    setup();
    const recipe = join(f.root(), '.evidence/verify/focused-tests.json');
    mkdirSync(join(f.root(), '.evidence/verify'), { recursive: true });
    writeFileSync(recipe, JSON.stringify({ version: 1, tests: ['relevant.test.ts'] }));
    expect(f.run().status).toBe(0); expect(verify().status).toBe(0);
    const before = order().split('full').length;
    writeFileSync(recipe, JSON.stringify({ version: 1, tests: ['unrelated.test.ts'] }));
    expect(verify().status).toBe(1); expect(order().split('full').length).toBe(before);
    expect(callCount()).toBe(1);
    expect(f.run().status).toBe(0); expect(callCount()).toBe(2);
    expect(verify().status).toBe(0);
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
    expect(full().status).toBe(1); expect(order()).not.toContain('build');
    expect(f.run().status).toBe(0);
    writeFileSync(join(root, '.evidence/build-fail'), 'fail');
    const broken = full(); expect(broken.status).toBe(1); expect(order()).toContain('build');
    expect(broken.stdout.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ name: "build", status: "fail" }));
    expect(verify([], true).status).toBe(1);
    rmSync(join(root, '.evidence/build-fail')); expect(full().status).toBe(0); expect(verify([], true).status).toBe(0);
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
    const failed = f.run();
    expect(failed.status).toBe(1);
    if (!existsSync(join(f.root(), 'budgets/issue-355.jsonl'))) throw new Error(String(failed.stderr));
    expect(verify().status).toBe(1); expect(order()).not.toContain('full');
    const ledger = join(f.root(), 'budgets/issue-355.jsonl'); const failedHistory = readFileSync(ledger, 'utf8');
    writeFileSync(join(f.root(), 'app.ts'), 'export const value = 3;\n');
    f.git('add', 'app.ts'); f.git('commit', '-qm', 'repair');
    writeFileSync(join(f.root(), 'verdict'), JSON.stringify({ lens: 'correctness', verdict: 'pass', findings: [] }));
    expect(f.run().status).toBe(0); expect(verify().status).toBe(0);
    expect(order()).toContain('full'); expect(callCount()).toBe(2);
    expect(readFileSync(ledger, 'utf8').startsWith(failedHistory)).toBe(true);
    expect(readFileSync(ledger, 'utf8').trim().split('\n').map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ verdict: 'fail' }));
    expect(readdirSync(join(f.root(), '.evidence/verify/attempts')).length).toBeGreaterThan(2);
    const repeated = verify(['--reuse']); expect(repeated.status).toBe(0); expect(repeated.stdout).toContain('"cached":true');
    expect(order().split('\n').filter(line => line === 'full')).toHaveLength(1);
    expect(callCount()).toBe(2);
    expect(verify([], true).status).toBe(0);
  });
  test('source drift and changed heads reject review reuse before full acceptance', () => {
    setup(); const review = f.run();
    if (review.status !== 0) throw new Error(String(review.stderr));
    writeFileSync(join(f.root(), '.evidence/drift'), 'drift');
    const drift = verify(); expect(drift.status).toBe(1); expect(drift.stdout).toContain('candidate changed during cheap checks');
    expect(order()).not.toContain('full');
    f.git('add', 'app.ts'); f.git('commit', '-qm', 'new candidate');
    // Stop the intentional edit but keep its raw failed attempt.
    writeFileSync(join(f.root(), 'scripts/verify/cheap.sh'), `echo cheap >> .evidence/order\necho '{"summary":"cheap"}'\n`);
    f.git('add', '-A'); f.git('commit', '-qm', 'stable candidate');
    expect(verify().status).toBe(1); expect(order()).not.toContain('full'); expect(callCount()).toBe(1);
  });
  test('failed full acceptance blocks the actual pre-push entry point', () => {
    setup(); const review = f.run();
    if (review.status !== 0) throw new Error(String(review.stderr));
    writeFileSync(join(f.root(), '.evidence/full-fail'), 'fail');
    const result = verify([], true); expect(result.status).toBe(1); expect(order()).toContain('full');
    expect(result.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ name: 'test', status: 'fail' })); expect(callCount()).toBe(1);
  });
}
