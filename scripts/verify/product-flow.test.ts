import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const modulePath = resolve(__dirname, 'product-flow.mjs');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
let dir: string;
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
// Never inherit Git-hook repository pointers into fixture subprocesses.
const fixtureEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const fixtureGit = (args: string[]) => execFileSync('git', args, { env: fixtureEnv() });
const evaluate = (expression: string) => spawnSync(process.execPath, ['--input-type=module', '-e',
  `import * as gate from ${JSON.stringify(modulePath)}; process.stdout.write(JSON.stringify(${expression}));`], { encoding: 'utf8', env: fixtureEnv() });
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
test.each(['failed', 'skipped', 'empty', 'one'])("rejects %s required assertions even if the summary says pass", kind => {
  const report = fixture(), flow = report.flows[2]!;
  const commands = JSON.parse(readFileSync(join(dir, flow.commands), 'utf8'));
  const changed = kind === 'one' ? commands.slice(0, 2) : kind === 'empty' ? [commands[0]] : commands.map((c: { metadata: {status: string} }, i: number) => i ? { ...c, metadata: {status: kind.toUpperCase()} } : c);
  const raw = JSON.stringify(changed); writeFileSync(join(dir, flow.commands), raw); flow.sha256 = sha(raw);
  const result = validate(report); expect(result.status).toBe(1);
  expect(result.stderr).toContain(kind === 'one' ? 'no deterministic coverage for billing' : 'missing/skipped/failed assertions');
});
test.each(['source', 'commands', 'screenshot', 'trace'])('rejects changed %s artifacts', field => {
  const report = fixture();
  const file = field === 'trace' ? 'trace.json' : report.flows[2]![field as 'source' | 'commands' | 'screenshot'];
  const original = readFileSync(join(dir, file));
  // Preserve valid content so parsing or coverage cannot mask a missing digest check.
  const changed = field === 'source' ? original + '\n# changed source\n'
    : field === 'commands' ? JSON.stringify(JSON.parse(original.toString()), null, 2)
    : field === 'screenshot' ? Buffer.concat([original, Buffer.from([1])])
    : original.toString().replaceAll('Paywall visible', 'Paywall and cancel visible');
  writeFileSync(join(dir, file), changed);
  const result = validate(report); expect(result.status).toBe(1);
  const message = { source: 'changed flow source', commands: 'changed command artifact', screenshot: 'missing/changed/non-PNG screenshot', trace: 'changed walkthrough trace' };
  expect(result.stderr).toContain(message[field as keyof typeof message]);
});
test.each(['stale', 'future', 'expired', 'wrong-native', 'unknown-backend', 'prod', 'unconfigured', 'missing-flow', 'missing-walkthrough', 'missing-recovery'])('rejects %s proof', condition => {
  const report = fixture();
  if (condition === 'stale') report.inputHash = 'previous-inputs';
  if (condition === 'future') report.finishedAt = new Date(Date.now() + 3600_000).toISOString();
  if (condition === 'expired') report.finishedAt = new Date(Date.now() - 25 * 3600_000).toISOString();
  if (condition === 'wrong-native') report.nativeSourceHash = 'old-native-source';
  if (condition === 'unknown-backend') report.backendRevision = 'unknown';
  if (condition === 'prod') report.backend = 'https://fitsy.org';
  if (condition === 'unconfigured') report.storeMode = 'unconfigured';
  if (condition === 'missing-flow') report.flows.shift();
  if (condition === 'missing-walkthrough') report.exploration = [];
  if (condition === 'missing-recovery') report.exploration[0]!.branches = ['primary'];
  const result = validate(report); expect(result.status).toBe(1);
  if (condition === 'missing-flow') expect(result.stderr).toContain('missing baseline flow');
  if (condition === 'expired') expect(result.stderr).toContain('evidence expired');
});
test('baseline flows cannot cover billing even when their YAML tags include billing', () => {
  const report = fixture(); report.flows.pop();
  expect(validate(report).status).toBe(1);
});
test.each(['appId', 'name'])('rejects wrong command-report %s even with a matching artifact digest', field => {
  const report = fixture(), flow = report.flows[2]!;
  const commands = JSON.parse(readFileSync(join(dir, flow.commands), 'utf8'));
  commands[0].command.applyConfigurationCommand.config[field] = 'wrong';
  const raw = JSON.stringify(commands); writeFileSync(join(dir, flow.commands), raw); flow.sha256 = sha(raw);
  expect(validate(report).status).toBe(1);
});
test('rejects a non-image screenshot even when its digest matches', () => {
  const report = fixture(), flow = report.flows[2]!;
  writeFileSync(join(dir, flow.screenshot), 'not a PNG'); flow.screenshotHash = sha('not a PNG');
  expect(validate(report).status).toBe(1);
});
test.each(['no-actions', 'no-observations', 'old', 'late', 'tool-error'])('rejects %s walkthrough evidence with a matching digest', problem => {
  const report = fixture(), o = report.exploration[0]!;
  let events = readFileSync(join(dir, o.trace), 'utf8').split('\n').map(line => JSON.parse(line));
  if (problem === 'no-actions') events = events.slice(1);
  if (problem === 'no-observations') events = events.slice(0, 1);
  if (problem === 'old') events[0].at = '2000-01-01T00:00:00Z';
  if (problem === 'late') events[0].at = new Date(Date.parse(report.finishedAt) + 1_000).toISOString();
  if (problem === 'tool-error') events[0].result.isError = true;
  const raw = events.map(e => JSON.stringify(e)).join('\n');
  writeFileSync(join(dir, o.trace), raw); o.sha256 = sha(raw);
  expect(validate(report).status).toBe(1);
});
test('an artifact symlink cannot read outside the evidence directory', () => {
  const report = fixture(); symlinkSync(modulePath, join(dir, 'escape')); report.flows[0]!.commands = 'escape';
  report.flows[0]!.sha256 = sha(readFileSync(modulePath));
  const result = validate(report); expect(result.status).toBe(1);
  expect(result.stderr).toContain('artifact escapes evidence directory');
});
test.each([
  [['docs/product/paywall.md'], []],
  [['apps/mobile/app/welcome/payment.tsx'], ['billing', 'onboarding']],
  ...['apps/mobile/lib/teaserGate.ts', 'apps/mobile/components/LockedUnlockCard.tsx'].map(path => [[path], ['billing']]),
  [['apps/api/app/api/revenuecat/webhook/route.ts'], ['billing']],
  [['apps/api/services/revenuecatService.ts'], ['billing']],
  [['apps/api/app/api/subscriptions/status/route.ts'], ['billing']],
  [['apps/api/app/api/subscriptions/sync/route.ts'], ['billing']],
  ...['apps/mobile/app/index.tsx', 'apps/mobile/app/_layout.tsx', 'apps/mobile/lib/reviewAccess.ts', 'apps/mobile/lib/useEntitlement.ts'].map(path => [[path], ['billing']]),
  ...['apps/mobile/app/(tabs)/_layout.tsx', 'apps/mobile/app/(tabs)/search.tsx', 'apps/mobile/app/(tabs)/profile.tsx', 'apps/mobile/app/restaurant/[id].tsx', 'apps/api/app/api/restaurants/route.ts', 'apps/api/app/api/restaurants/[id]/menu/route.ts'].map(path => [[path], ['billing', 'discovery']]),
  ...['apps/mobile/app/auth/reviewer.tsx', 'apps/mobile/lib/authClient.ts'].map(path => [[path], ['auth', 'billing']]),
  [['apps/mobile/app/auth/signin.tsx'], ['auth']],
  [['apps/api/app/api/push-token/route.ts'], ['notifications']],
  [['packages/shared/src/search.ts'], ['discovery']],
  [['apps/mobile/components/UnknownButton.tsx'], ['changed-journey']],
  [['apps/api/next.config.ts'], ['changed-journey']],
])('routes %j through product impact selection', (paths, categories) => {
  const result = evaluate(`gate.impact(${JSON.stringify(paths)})`);
  expect(JSON.parse(result.stdout).categories).toEqual(categories);
});
test('working changes and deletions invalidate the source identity', () => {
  fixtureGit(['init', '-q', dir]); writeFileSync(join(dir, 'app.ts'), 'original');
  fixtureGit(['-C', dir, 'add', 'app.ts']);
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
  fixtureGit(['init', '-q', dir]);
  fixtureGit(['-C', dir, 'add', '.']);
  fixtureGit(['-C', dir, '-c', 'user.name=Gate Test', '-c', 'user.email=gate@example.invalid', 'commit', '-qm', 'baseline']);
  fixtureGit(['-C', dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const check = () => spawnSync(process.execPath, [join(verify, 'run.mjs'), '--only=product-flow', '--runs=local'], {
    cwd: dir, encoding: 'utf8', env: { ...fixtureEnv(), CI: '', FITSY_DIFF_BASE: '' },
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

test('temporary repositories stay isolated when invoked from a Git hook', () => {
  const sentinel = join(dir, 'sentinel'), target = join(dir, 'fixture');
  fixtureGit(['init', '-q', sentinel]);
  const head = readFileSync(join(sentinel, '.git/HEAD'), 'utf8');
  const config = readFileSync(join(sentinel, '.git/config'), 'utf8');
  const variables = { GIT_DIR: join(sentinel, '.git'), GIT_WORK_TREE: sentinel, GIT_INDEX_FILE: join(sentinel, '.git/index') };
  const previous = Object.fromEntries(Object.keys(variables).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, variables);
    fixtureGit(['init', '-q', target]);
    writeFileSync(join(target, 'fixture.txt'), 'fixture data');
    fixtureGit(['-C', target, 'add', '.']);
    expect(fixtureGit(['-C', target, 'ls-files']).toString().trim()).toBe('fixture.txt');
    expect(readFileSync(join(sentinel, '.git/HEAD'), 'utf8')).toBe(head);
    expect(readFileSync(join(sentinel, '.git/config'), 'utf8')).toBe(config);
    expect(fixtureGit(['-C', sentinel, 'ls-files']).toString()).toBe('');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
