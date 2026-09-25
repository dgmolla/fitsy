import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, copyFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const modulePath = resolve(__dirname, 'product-flow.mjs');
// Local media integration runs decoder cases; hosted L2 retains non-video contracts.
const mediaTest = process.env.FITSY_MEDIA_INTEGRATION === '1' ? test : test.skip;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
let dir: string;
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
// Never inherit Git-hook repository pointers into fixture subprocesses.
const fixtureEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const fixtureGit = (args: string[]) => execFileSync('git', args, { env: fixtureEnv() });
const evaluate = (expression: string, env = fixtureEnv()) => spawnSync(process.execPath, ['--input-type=module', '-e',
  `import * as gate from ${JSON.stringify(modulePath)}; process.stdout.write(JSON.stringify(${expression}));`], { encoding: 'utf8', env });
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
    const video = readFileSync(resolve(__dirname, 'fixtures/valid.mp4'));
    writeFileSync(join(dir, `${name}.mp4`), video);
    const capture = JSON.stringify({ udid: 'test-device', preferredScreenCaptureFormat: 'screenshots' }) + '\n';
    writeFileSync(join(dir, `${name}-capture.jsonl`), capture);
    const closeout = JSON.stringify({ udid: 'test-device', generated: { videos: 0 }, deleted: [] }) + '\n';
    writeFileSync(join(dir, `${name}-closeout.json`), closeout);
    return { name, source, sourceHash: sha(yaml), commands: `${name}.json`, sha256: sha(data), screenshot: `${name}.png`, screenshotHash: sha(png),
      captureReceipt: `${name}-capture.jsonl`, captureReceiptHash: sha(capture),
      attachmentCloseout: `${name}-closeout.json`, attachmentCloseoutHash: sha(closeout), video: `${name}.mp4`, videoHash: sha(video) };
  });
  const trace = ['mobile_click_on_screen_at_coordinates', 'mobile_list_elements_on_screen'].map(name => JSON.stringify({
    at: new Date().toISOString(), command: { name }, result: { content: [{type: 'text', text: 'Paywall visible'}] },
  })).join('\n');
  writeFileSync(join(dir, 'trace.json'), trace);
  return {
    version: 1, evidenceMode: 'final-candidate', videoRequested: true, startedAt: new Date(Date.now() - 10_000).toISOString(), inputHash: 'current-inputs', nativeSourceHash: 'current-inputs', result: 'pass', finishedAt: new Date().toISOString(),
    appHash: 'app', bundleHash: 'bundle', backendRevision: 'dev-revision', backend: 'https://dev.fitsy.org', simulator: 'test-device',
    os: 'iOS 26.4', storeMode: 'test-store', fixture: 'run-owned-user', maestroVersion: '2.3.0', flows,
    exploration: [{ category: 'billing', result: 'pass', expected: 'cancel returns to paywall', observed: 'paywall remains usable', branches: ['primary', 'recovery'], trace: 'trace.json', sha256: sha(trace) }],
  };
}
function validate(report: ReturnType<typeof fixture>, mode = 'final-candidate') {
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
  return evaluate(`gate.validate(JSON.parse((await import('node:fs')).readFileSync(${JSON.stringify(join(dir, 'report.json'))}, 'utf8')), {categories:['billing']}, 'current-inputs', ${JSON.stringify(dir)}, Date.now(), ${JSON.stringify(dir)}, 'current-inputs', ${JSON.stringify(mode)})`);
}

mediaTest('accepts identified baseline and billing outcomes with matching artifacts', () => {
  const result = validate(fixture()); expect(result.status).toBe(0); expect(JSON.parse(result.stdout).status).toBe('pass');
});
test('development proof retains assertions but never satisfies final publication', () => {
  const report = fixture();
  report.evidenceMode = 'development';
  report.videoRequested = false;
  for (const flow of report.flows) {
    delete (flow as { video?: string }).video;
    delete (flow as { videoHash?: string }).videoHash;
  }
  expect(validate(report, 'development').status).toBe(0);
  const publication = validate(report);
  expect(publication.status).toBe(1);
  expect(publication.stderr).toContain('Expected final-candidate evidence');
});
test('final candidate accepts complete native proof without video when recording was not requested', () => {
  const report = fixture();
  report.videoRequested = false;
  for (const flow of report.flows) {
    delete (flow as { video?: string }).video;
    delete (flow as { videoHash?: string }).videoHash;
  }
  const result = validate(report);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).status).toBe('pass');
});
test('non-video proof does not invoke video tooling', () => {
  const report = fixture();
  report.videoRequested = false;
  for (const flow of report.flows) {
    delete (flow as { video?: string }).video;
    delete (flow as { videoHash?: string }).videoHash;
  }
  const marker = join(dir, 'video-tool-invoked');
  for (const tool of ['ffprobe', 'ffmpeg']) {
    const file = join(dir, tool);
    writeFileSync(file, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 1\n`);
    chmodSync(file, 0o755);
  }
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
  const result = evaluate(`gate.validate(JSON.parse((await import('node:fs')).readFileSync(${JSON.stringify(join(dir, 'report.json'))}, 'utf8')), {categories:['billing']}, 'current-inputs', ${JSON.stringify(dir)}, Date.now(), ${JSON.stringify(dir)}, 'current-inputs')`,
    { ...fixtureEnv(), PATH: `${dir}:${process.env.PATH}` });
  expect(result.status).toBe(0);
  expect(existsSync(marker)).toBe(false);
});
mediaTest('recording selection and video claims must agree on every flow', () => {
  const report = fixture();
  delete (report.flows[0] as { video?: string }).video;
  expect(validate(report).stderr).toContain('missing/changed/empty video');
  report.videoRequested = false;
  expect(validate(report).stderr).toContain('Unrequested video claim');
  report.evidenceMode = 'requested-video';
  expect(validate(report, 'requested-video').stderr).toContain('requested-video proof requires a complete recording');
});
mediaTest('legacy final candidate with complete recordings remains valid', () => {
  const report = fixture();
  delete (report as { videoRequested?: boolean }).videoRequested;
  expect(validate(report).status).toBe(0);
});
mediaTest('explicit requested-video proof remains separate from final candidate publication', () => {
  const report = fixture(); report.evidenceMode = 'requested-video';
  expect(validate(report, 'requested-video').status).toBe(0);
  expect(validate(report).stderr).toContain('Expected final-candidate evidence');
});
mediaTest('capture receipt must prove screenshots-only XCTest for the selected simulator', () => {
  const report = fixture(), flow = report.flows[0]!;
  const changed = JSON.stringify({ udid: report.simulator, preferredScreenCaptureFormat: 'screenRecording' }) + '\n';
  writeFileSync(join(dir, flow.captureReceipt), changed);
  flow.captureReceiptHash = sha(changed);
  const result = validate(report);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('missing screenshots-only XCTest launch proof');
});
mediaTest('final candidate requires an unchanged zero-video XCTest closeout for every flow', () => {
  const missing = fixture();
  delete (missing.flows[0] as { attachmentCloseout?: string }).attachmentCloseout;
  delete (missing.flows[0] as { attachmentCloseoutHash?: string }).attachmentCloseoutHash;
  expect(validate(missing).stderr).toContain('missing XCTest attachment closeout');
  const changed = fixture();
  writeFileSync(join(dir, changed.flows[0]!.attachmentCloseout), JSON.stringify({ udid: 'test-device', generated: { videos: 1 }, deleted: [] }));
  expect(validate(changed).stderr).toContain('changed XCTest attachment closeout');
  changed.flows[0]!.attachmentCloseoutHash = sha(readFileSync(join(dir, changed.flows[0]!.attachmentCloseout)));
  expect(validate(changed).stderr).toContain('unexpected XCTest recording');
});
mediaTest.each(['failed', 'skipped', 'empty', 'one'])("rejects %s required assertions even if the summary says pass", kind => {
  const report = fixture(), flow = report.flows[2]!;
  const commands = JSON.parse(readFileSync(join(dir, flow.commands), 'utf8'));
  const changed = kind === 'one' ? commands.slice(0, 2) : kind === 'empty' ? [commands[0]] : commands.map((c: { metadata: {status: string} }, i: number) => i ? { ...c, metadata: {status: kind.toUpperCase()} } : c);
  const raw = JSON.stringify(changed); writeFileSync(join(dir, flow.commands), raw); flow.sha256 = sha(raw);
  const result = validate(report); expect(result.status).toBe(1);
  expect(result.stderr).toContain(kind === 'one' ? 'no deterministic coverage for billing' : 'missing/skipped/failed assertions');
});
mediaTest.each(['source', 'commands', 'screenshot', 'video', 'trace'])('rejects changed %s artifacts', field => {
  const report = fixture();
  const file = field === 'trace' ? 'trace.json' : report.flows[2]![field as 'source' | 'commands' | 'screenshot' | 'video'];
  const original = readFileSync(join(dir, file));
  // Preserve valid content so parsing or coverage cannot mask a missing digest check.
  const changed = field === 'source' ? original + '\n# changed source\n'
    : field === 'commands' ? JSON.stringify(JSON.parse(original.toString()), null, 2)
    : field === 'screenshot' || field === 'video' ? Buffer.concat([original, Buffer.from([1])])
    : original.toString().replaceAll('Paywall visible', 'Paywall and cancel visible');
  writeFileSync(join(dir, file), changed);
  const result = validate(report); expect(result.status).toBe(1);
  const message = { source: 'changed flow source', commands: 'changed command artifact', screenshot: 'missing/changed/non-PNG screenshot', video: 'missing/changed/empty video', trace: 'changed walkthrough trace' };
  expect(result.stderr).toContain(message[field as keyof typeof message]);
});
mediaTest('rejects a missing recording even when its report claims a matching digest', () => {
  const report = fixture();
  rmSync(join(dir, report.flows[2]!.video));
  const result = validate(report);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('missing/changed/empty video');
});
mediaTest.each(['corrupt bytes', 'truncated MP4'])('rejects %s even when its digest matches', kind => {
  const report = fixture(), flow = report.flows[2]!;
  const valid = readFileSync(join(dir, flow.video));
  const invalid = kind === 'corrupt bytes' ? Buffer.from('recorded native video proof') : valid.subarray(0, 200);
  writeFileSync(join(dir, flow.video), invalid); flow.videoHash = sha(invalid);
  const result = validate(report);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('unplayable video');
});
mediaTest('rejects metadata-only MP4 when its digest matches', () => {
  const report = fixture(), flow = report.flows[2]!;
  const valid = readFileSync(join(dir, flow.video));
  const atoms: Buffer[] = [];
  for (let offset = 0; offset < valid.length;) {
    const size = valid.readUInt32BE(offset);
    expect(size).toBeGreaterThanOrEqual(8);
    if (valid.toString('ascii', offset + 4, offset + 8) !== 'mdat') atoms.push(valid.subarray(offset, offset + size));
    offset += size;
  }
  const metadataOnly = Buffer.concat(atoms);
  expect(metadataOnly.length).toBeLessThan(valid.length);
  writeFileSync(join(dir, flow.video), metadataOnly); flow.videoHash = sha(metadataOnly);
  const result = validate(report);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('unplayable video');
});
mediaTest.each([
  ['decoder failure', '#!/bin/sh\nexit 1\n'],
  ['decoder timeout', '#!/bin/sh\nexec sleep 20\n'],
])('rejects %s while preserving video', (_kind, script) => {
  const file = join(dir, 'ffmpeg'), video = resolve(__dirname, 'fixtures/valid.mp4');
  writeFileSync(file, script); chmodSync(file, 0o755);
  const result = evaluate(`gate.isPlayableVideo(${JSON.stringify(video)})`,
    { ...fixtureEnv(), PATH: `${dir}:${process.env.PATH}` });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toBe(false);
  expect(readFileSync(video).length).toBeGreaterThan(0);
}, 25000);
mediaTest.each(['stale', 'future', 'expired', 'wrong-native', 'unknown-backend', 'prod', 'unconfigured', 'missing-flow', 'missing-walkthrough', 'missing-recovery'])('rejects %s proof', condition => {
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
mediaTest('baseline flows cannot cover billing even when their YAML tags include billing', () => {
  const report = fixture(); report.flows.pop();
  expect(validate(report).status).toBe(1);
});
mediaTest.each(['appId', 'name'])('rejects wrong command-report %s even with a matching artifact digest', field => {
  const report = fixture(), flow = report.flows[2]!;
  const commands = JSON.parse(readFileSync(join(dir, flow.commands), 'utf8'));
  commands[0].command.applyConfigurationCommand.config[field] = 'wrong';
  const raw = JSON.stringify(commands); writeFileSync(join(dir, flow.commands), raw); flow.sha256 = sha(raw);
  expect(validate(report).status).toBe(1);
});
mediaTest('rejects a non-image screenshot even when its digest matches', () => {
  const report = fixture(), flow = report.flows[2]!;
  writeFileSync(join(dir, flow.screenshot), 'not a PNG'); flow.screenshotHash = sha('not a PNG');
  expect(validate(report).status).toBe(1);
});
mediaTest.each(['no-actions', 'no-observations', 'old', 'late', 'tool-error'])('rejects %s walkthrough evidence with a matching digest', problem => {
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
mediaTest('an artifact symlink cannot read outside the evidence directory', () => {
  const report = fixture(); symlinkSync(modulePath, join(dir, 'escape')); report.flows[0]!.commands = 'escape';
  report.flows[0]!.sha256 = sha(readFileSync(modulePath));
  const result = validate(report); expect(result.status).toBe(1);
  expect(result.stderr).toContain('artifact escapes evidence directory');
});
mediaTest.each([
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
