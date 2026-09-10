import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const modulePath = resolve(__dirname, 'product-flow.mjs');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
let dir: string;
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const evaluate = (expression: string) => spawnSync(process.execPath, ['--input-type=module', '-e',
  `import * as gate from ${JSON.stringify(modulePath)}; process.stdout.write(JSON.stringify(${expression}));`], { encoding: 'utf8' });
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fitsy-product-flow-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const flows = ['cold-start-welcome', 'signin-options', 'billing-cancel'].map(name => {
    const source = `apps/mobile/e2e/flows/${name}.yaml`;
    mkdirSync(join(dir, 'apps/mobile/e2e/flows'), { recursive: true });
    const yaml = `appId: com.fitsy.mobile\nname: ${name}\ntags: [billing]\n---\n- assertVisible: Paywall\n- assertVisible: Cancel\n`;
    writeFileSync(join(dir, source), yaml);
    const data = JSON.stringify([
      { command: { applyConfigurationCommand: { config: { appId: 'com.fitsy.mobile', name } } }, metadata: { status: 'COMPLETED' } },
      ...['Paywall', 'Cancel'].map(text => ({ command: { assertConditionCommand: { condition: { visible: { textRegex: text } } } }, metadata: { status: 'COMPLETED' } })),
    ]);
    writeFileSync(join(dir, `${name}.json`), data);
    writeFileSync(join(dir, `${name}.png`), png);
    return { name, source, sourceHash: sha(yaml), commands: `${name}.json`, sha256: sha(data), screenshot: `${name}.png`, screenshotHash: sha(png) };
  });
  const trace = ['mobile_click_on_screen_at_coordinates', 'mobile_list_elements_on_screen'].map(name => JSON.stringify({
    at: new Date().toISOString(), command: { name }, result: { content: [{type: 'text', text: 'Paywall visible'}] },
  })).join('\n');
  writeFileSync(join(dir, 'trace.json'), trace);
  return {
    version: 1, startedAt: new Date(Date.now() - 10_000).toISOString(), inputHash: 'current-inputs', nativeSourceHash: 'current-inputs', result: 'pass', finishedAt: new Date().toISOString(),
    appHash: 'app', bundleHash: 'bundle', backendRevision: 'dev-revision', backend: 'https://dev.fitsy.org', simulator: 'test-device',
    os: 'iOS 26.4', storeMode: 'test-store', fixture: 'run-owned-user', maestroVersion: '2.3.0', flows,
    exploration: [{ category: 'billing', result: 'pass', expected: 'cancel returns to paywall', observed: 'paywall remains usable', branches: ['primary', 'recovery'], trace: 'trace.json', sha256: sha(trace) }],
  };
}
function validate(report: ReturnType<typeof fixture>) {
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
  return evaluate(`gate.validate(JSON.parse((await import('node:fs')).readFileSync(${JSON.stringify(join(dir, 'report.json'))}, 'utf8')), {categories:['billing']}, 'current-inputs', ${JSON.stringify(dir)}, Date.now(), ${JSON.stringify(dir)}, 'current-inputs')`);
}

test('accepts identified baseline and billing outcomes with matching artifacts', () => {
  const result = validate(fixture()); expect(result.status).toBe(0); expect(JSON.parse(result.stdout).status).toBe('pass');
});
test.each(['failed', 'skipped', 'empty'])("rejects %s required assertions even if the summary says pass", kind => {
  const report = fixture(), flow = report.flows[2]!;
  const commands = JSON.parse(readFileSync(join(dir, flow.commands), 'utf8'));
  const changed = kind === 'empty' ? [commands[0]] : commands.map((c: { metadata: {status: string} }, i: number) => i ? { ...c, metadata: {status: kind.toUpperCase()} } : c);
  const raw = JSON.stringify(changed); writeFileSync(join(dir, flow.commands), raw); flow.sha256 = sha(raw);
  expect(validate(report).status).toBe(1);
});
test.each(['source', 'commands', 'screenshot', 'trace'])('rejects changed %s artifacts', field => {
  const report = fixture();
  const file = field === 'trace' ? 'trace.json' : report.flows[2]![field as 'source' | 'commands' | 'screenshot'];
  writeFileSync(join(dir, file), 'changed'); expect(validate(report).status).toBe(1);
});
test.each(['stale', 'future', 'expired', 'wrong-native', 'unknown-backend', 'prod', 'missing-flow', 'missing-walkthrough', 'missing-recovery'])('rejects %s proof', condition => {
  const report = fixture();
  if (condition === 'stale') report.inputHash = 'previous-inputs';
  if (condition === 'future') report.finishedAt = new Date(Date.now() + 3600_000).toISOString();
  if (condition === 'expired') report.finishedAt = new Date(Date.now() - 25 * 3600_000).toISOString();
  if (condition === 'wrong-native') report.nativeSourceHash = 'old-native-source';
  if (condition === 'unknown-backend') report.backendRevision = 'unknown';
  if (condition === 'prod') report.backend = 'https://fitsy.org';
  if (condition === 'missing-flow') report.flows.pop();
  if (condition === 'missing-walkthrough') report.exploration = [];
  if (condition === 'missing-recovery') report.exploration[0]!.branches = ['primary'];
  expect(validate(report).status).toBe(1);
});
test('baseline-only evidence cannot claim billing coverage by adding report tags', () => {
  const report = fixture(); report.flows.pop();
  const claimed = JSON.parse(JSON.stringify(report));
  for (const flow of claimed.flows) flow.categories = ['billing'];
  expect(validate(claimed).status).toBe(1);
});
test('an artifact symlink cannot read outside the evidence directory', () => {
  const report = fixture(); symlinkSync(modulePath, join(dir, 'escape')); report.flows[0]!.commands = 'escape';
  expect(validate(report).status).toBe(1);
});
test.each([
  [['docs/product/paywall.md'], []],
  [['apps/mobile/app/welcome/payment.tsx'], ['billing', 'onboarding']],
  [['apps/api/app/api/revenuecat/webhook/route.ts'], ['billing']],
  [['packages/shared/src/search.ts'], ['discovery']],
  [['apps/mobile/components/UnknownButton.tsx'], ['changed-journey']],
])('routes %j through product impact selection', (paths, categories) => {
  const result = evaluate(`gate.impact(${JSON.stringify(paths)})`);
  expect(JSON.parse(result.stdout).categories).toEqual(categories);
});
test('working changes and deletions invalidate the source identity', () => {
  execFileSync('git', ['init', '-q', dir]); writeFileSync(join(dir, 'app.ts'), 'original');
  execFileSync('git', ['-C', dir, 'add', 'app.ts']);
  const hash = () => evaluate(`gate.inputHash(${JSON.stringify(dir)})`).stdout;
  const first = hash(); writeFileSync(join(dir, 'app.ts'), 'changed'); expect(hash()).not.toBe(first);
  const second = hash(); rmSync(join(dir, 'app.ts')); expect(hash()).not.toBe(second);
});

test('the real local registry blocks missing evidence but permits explicit non-product applicability', () => {
  const verify = join(dir, 'scripts/verify'); mkdirSync(verify, { recursive: true });
  for (const name of ['run.mjs', 'product-flow.mjs', 'product-flow.sh', 'registry.yml']) {
    copyFileSync(join(__dirname, name), join(verify, name));
  }
  symlinkSync(resolve(__dirname, '../../node_modules'), join(dir, 'node_modules'));
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n.evidence/\n');
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, '-c', 'user.name=Gate Test', '-c', 'user.email=gate@example.invalid', 'commit', '-qm', 'baseline']);
  execFileSync('git', ['-C', dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const check = () => spawnSync(process.execPath, [join(verify, 'run.mjs'), '--only=product-flow', '--runs=local'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, CI: '', FITSY_DIFF_BASE: '', FITSY_PRODUCT_EVIDENCE: '' },
  });
  writeFileSync(join(dir, 'notes.md'), 'Documentation change');
  let result = check();
  expect(result.status).toBe(0); expect(result.stdout).toContain('"applicability":"not_applicable"');
  mkdirSync(join(dir, 'apps/mobile/app/welcome'), { recursive: true });
  writeFileSync(join(dir, 'apps/mobile/app/welcome/payment.tsx'), 'changed paywall');
  result = check();
  expect(result.status).toBe(1); expect(result.stdout).toContain('"status":"fail"');
  expect(result.stdout).toContain('"blocking":true'); expect(result.stdout).not.toContain('"status":"skipped"');
});
