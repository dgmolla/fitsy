import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const modulePath = resolve(__dirname, 'product-flow.mjs');
// Local media integration runs decoder cases; hosted L2 retains non-video contracts.
const mediaTest = process.env.FITSY_MEDIA_INTEGRATION === '1' ? test : test.skip;
const deterministicTest = process.env.FITSY_MEDIA_INTEGRATION === '1' ? test.skip : test;
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
      screenCheck: { version: 1, screenshotHash: sha(png), expired: false, expectedExpired: false },
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
function validate(report: ReturnType<typeof fixture>, mode = 'final-candidate', fixtureConfigurations: Record<string, string> = {}) {
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
  return evaluate(`gate.validate(JSON.parse((await import('node:fs')).readFileSync(${JSON.stringify(join(dir, 'report.json'))}, 'utf8')), {required:true, categories:['billing'], flows:['cold-start-welcome','signin-options','billing-cancel']}, 'current-inputs', ${JSON.stringify(dir)}, Date.now(), ${JSON.stringify(dir)}, 'current-inputs', ${JSON.stringify(mode)}, [], ${JSON.stringify(fixtureConfigurations)})`);
}

deterministicTest('walkthrough fixture transitions retain original proof and reject altered, incomplete or stale bindings', () => {
  const original = fixture();
  const start = Date.parse(original.startedAt);
  const at = (offset: number) => new Date(start + offset).toISOString();
  const report = { ...original, configHash: sha('free'), jsHash: sha('js'), backendDeployment: 'dev-deployment',
    bundleHash: sha('free-bundle'), walkthroughProtocol: 1,
    metro: { pid: 101, processIdentity: 'original-process', root: dir, port: 8099, route: '/bundle',
      jsHash: sha('js'), configHash: sha('free'), bundleHash: sha('free-bundle') },
    walkthroughSessions: [] as { category: string; receipt: string; sha256: string; artifacts: string[] }[] };
  const trace = ['tap_on', 'inspect_view_hierarchy'].map(name => JSON.stringify({ at: at(4000),
    command: { name }, result: { content: [{ type: 'text', text: 'Paywall visible' }] } })).join('\n');
  writeFileSync(join(dir, 'trace.json'), trace);
  report.exploration[0]!.sha256 = sha(trace);
  const snapshot = JSON.stringify({ udid: report.simulator, files: 0, bytes: 0, videos: 0 });
  writeFileSync(join(dir, 'before.json'), snapshot); writeFileSync(join(dir, 'after.json'), snapshot);
  const session = { version: 1, state: 'complete', category: 'billing', flow: null as string | null, fixture: 'default',
    ...Object.fromEntries(['inputHash', 'jsHash', 'appHash', 'simulator', 'os', 'backendRevision', 'backendDeployment', 'storeMode']
      .map(key => [key, report[key as keyof typeof report]])),
    nativeHash: report.nativeSourceHash, configHash: report.configHash,
    callerBefore: report.metro, metro: report.metro, bundleHash: report.bundleHash,
    restoredMetro: { ...report.metro, pid: 202, processIdentity: 'restored-process' },
    startedAt: at(1000), readyAt: at(2000), completedAt: at(5000), restoredAt: at(6000),
    entitlement: { fixture: 'empty-store', sandbox: true, storeMode: 'test-store', accountHash: sha('free-account'), verifiedAt: at(1500) },
    trace: 'trace.json', traceHash: sha(trace),
    attachmentBefore: 'before.json', attachmentBeforeHash: sha(snapshot), attachmentAfter: 'after.json', attachmentAfterHash: sha(snapshot),
    captureReceipt: original.flows[0]!.captureReceipt, captureReceiptHash: original.flows[0]!.captureReceiptHash,
    attachmentCloseout: original.flows[0]!.attachmentCloseout, attachmentCloseoutHash: original.flows[0]!.attachmentCloseoutHash };
  const artifacts = [session.attachmentBefore, session.attachmentAfter, session.captureReceipt, session.attachmentCloseout];
  const saveSession = (value: unknown = session) => {
    const bytes = JSON.stringify(value); writeFileSync(join(dir, 'session.json'), bytes);
    report.walkthroughSessions = [{ category: 'billing', receipt: 'session.json', sha256: sha(bytes), artifacts }];
  };
  saveSession();
  expect(validate(report).status).toBe(0);
  expect(report.metro.pid).toBe(101);
  const restored = evaluate(`gate.walkthroughState(${JSON.stringify(report)}, ${JSON.stringify(dir)}).metro`);
  expect(JSON.parse(restored.stdout).pid).toBe(202);
  const attacks: Array<[object, RegExp]> = [
    [{ inputHash: 'stale' }, /walkthrough inputHash/],
    [{ appHash: 'another-app' }, /walkthrough appHash/],
    [{ nativeHash: 'another-native' }, /walkthrough native identity/],
    [{ backendDeployment: 'another-deployment' }, /walkthrough backendDeployment/],
    [{ configHash: sha('entitled') }, /fixture configuration/],
    [{ callerBefore: { ...report.metro, pid: 999 } }, /transition chain/],
    [{ restoredMetro: { ...session.restoredMetro, configHash: sha('entitled') } }, /Metro\/configuration\/bundle/],
    [{ restoredMetro: { ...session.restoredMetro, bundleHash: sha('other') } }, /Metro\/configuration\/bundle/],
    [{ restoredMetro: { ...session.restoredMetro, processIdentity: '' } }, /Metro\/configuration\/bundle/],
    [{ readyAt: at(4500) }, /outside their fixture session/],
    [{ traceHash: sha('altered') }, /session trace/],
    [{ attachmentBeforeHash: sha('invented') }, /attachmentBefore/],
    [{ entitlement: null }, /verified empty store/],
  ];
  for (const [change, failure] of attacks) {
    saveSession({ ...session, ...change });
    const result = validate(report); expect(result.status).toBe(1); expect(result.stderr).toMatch(failure);
  }
  saveSession();
  report.walkthroughSessions[0]!.artifacts = [];
  expect(validate(report).stderr).toContain('publication omits fixture evidence');
  saveSession();
  expect(validate({ ...report, walkthroughPending: { state: 'ready' } } as typeof report).stderr).toContain('transition is unfinished');
  report.walkthroughSessions = [];
  expect(validate(report).stderr).toContain('missing or mismatched walkthrough fixture session');

  // A different fixture is accepted only when the executed journey proves it,
  // and its entitlement must remain active through the actual observation.
  const flow = report.flows[2]!;
  const identity = JSON.stringify({ fixture: 'entitled-dev', configHash: sha('entitled') });
  writeFileSync(join(dir, 'fixture-identity.json'), identity);
  Object.assign(flow, { identity: 'fixture-identity.json', identityHash: sha(identity) });
  const entitled = { ...session, flow: flow.name, fixture: 'entitled-dev', configHash: sha('entitled'),
    metro: { ...report.metro, pid: 303, processIdentity: 'entitled-process', configHash: sha('entitled'), bundleHash: sha('entitled-bundle') },
    bundleHash: sha('entitled-bundle'), entitlement: { sandbox: true, storeMode: 'test-store', accountHash: sha('account'), verifiedAt: at(1500), expiresAt: at(9000) } };
  saveSession(entitled);
  const check = () => evaluate(`gate.walkthroughState(${JSON.stringify(report)}, ${JSON.stringify(dir)}).metro`);
  expect(check().status).toBe(0);
  saveSession({ ...entitled, entitlement: { ...entitled.entitlement, expiresAt: at(3000) } });
  expect(check().stderr).toContain('not active throughout');
});

deterministicTest('an affected journey passes without unrelated baselines but cannot substitute another tagged journey', () => {
  const report = fixture();
  report.videoRequested = false;
  report.flows = report.flows.filter(flow => flow.name === 'billing-cancel');
  for (const flow of report.flows) { delete (flow as { video?: string }).video; delete (flow as { videoHash?: string }).videoHash; }
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
  const check = (flows: string[]) => evaluate(`gate.validate(JSON.parse((await import('node:fs')).readFileSync(${JSON.stringify(join(dir, 'report.json'))}, 'utf8')), {required:true, categories:['billing'], flows:${JSON.stringify(flows)}}, 'current-inputs', ${JSON.stringify(dir)}, Date.now(), ${JSON.stringify(dir)}, 'current-inputs')`);
  expect(check(['billing-cancel']).status).toBe(0);
  const missing = check(['billing-cancel', 'billing-recovery']);
  expect(missing.status).toBe(1);
  expect(missing.stderr).toContain('missing affected flow: billing-recovery');
});

deterministicTest('retained exception metadata cannot omit a journey without fresh authority', () => {
  const report = { ...fixture(), releaseExceptionId: '6716597294',
    exceptions: [{ flow: 'billing-cancel', status: 'EXCEPTED' }] };
  report.flows = report.flows.filter(flow => flow.name !== 'billing-cancel');
  const result = validate(report);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('release exceptions do not match current owner/source admission');
});

deterministicTest('an independently admitted Apple exception cannot pass itself or hide another required flow', () => {
  const exception = { flow: 'subscription-restore-expired', status: 'EXCEPTED', fixture: 'apple-history', store: 'apple-simulator' };
  const report = { ...fixture(), exceptions: [exception] };
  report.videoRequested = false;
  for (const flow of report.flows) { delete (flow as { video?: string }).video; delete (flow as { videoHash?: string }).videoHash; }
  const check = () => {
    writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
    return evaluate(`gate.validate(JSON.parse((await import('node:fs')).readFileSync(${JSON.stringify(join(dir, 'report.json'))}, 'utf8')),
      {required:true,categories:['billing'],flows:['cold-start-welcome','signin-options','billing-cancel','subscription-restore-expired']},
      'current-inputs',${JSON.stringify(dir)},Date.now(),${JSON.stringify(dir)},'current-inputs','final-candidate',${JSON.stringify([exception])})`);
  };
  expect(check().stdout).toContain('1 explicitly excepted, not passed');
  const removed = report.flows.pop()!;
  expect(check().stderr).toContain('missing affected flow: billing-cancel');
  report.flows.push(removed, { ...removed, name: exception.flow });
  expect(check().stderr).toContain('an excepted journey cannot also be reported passed');
});

deterministicTest('fixture-tagged journeys require their own unchanged source, store and served-bundle identity', () => {
  const report = { ...fixture(), jsHash: sha('javascript'), backendDeployment: 'dev-deployment' };
  report.videoRequested = false;
  for (const flow of report.flows) { delete (flow as { video?: string }).video; delete (flow as { videoHash?: string }).videoHash; }
  const flow = report.flows[2]!;
  const source = readFileSync(join(dir, flow.source), 'utf8').replace('tags: [billing]', 'tags: [billing, "fixture:empty-store", "store:test-store"]');
  writeFileSync(join(dir, flow.source), source); flow.sourceHash = sha(source);
  expect(validate(report).stderr).toContain('missing journey fixture identity');
  const identity = { version: 1, inputHash: report.inputHash, jsHash: report.jsHash, appHash: report.appHash,
    simulator: report.simulator, os: report.os, backendRevision: report.backendRevision, backendDeployment: report.backendDeployment,
    nativeHash: report.nativeSourceHash, fixture: 'empty-store', storeMode: 'test-store', configHash: sha('fixture'),
    bundleHash: sha('served-bundle'), initialBundleHash: sha('served-bundle') };
  const check = () => validate(report, 'final-candidate', { 'billing-cancel': sha('fixture') });
  const writeIdentity = () => {
    const text = JSON.stringify(identity); writeFileSync(join(dir, 'identity.json'), text);
    Object.assign(flow, { identity: 'identity.json', identityHash: sha(text) });
  };
  writeIdentity();
  expect(check().status).toBe(0);
  identity.fixture = 'expired-subscription'; writeIdentity();
  expect(check().stderr).toContain('wrong fixture or store');
  identity.fixture = 'empty-store'; identity.storeMode = 'apple-simulator'; writeIdentity();
  expect(check().stderr).toContain('wrong fixture or store');
  identity.storeMode = 'test-store'; identity.jsHash = sha('other-source'); writeIdentity();
  expect(check().stderr).toContain('journey jsHash differs');
  identity.jsHash = report.jsHash; identity.configHash = sha('different-fixture'); writeIdentity();
  expect(check().stderr).toContain('wrong fixture configuration');
  identity.configHash = sha('fixture'); identity.bundleHash = sha('different-bundle'); writeIdentity();
  expect(check().stderr).toContain('missing native/configuration/bundle fixture proof');

  const envFile = join(dir, 'empty.env'), manifest = join(dir, 'fixtures.json');
  writeFileSync(envFile, 'EXPO_PUBLIC_DEV_LOGIN_EMAIL=empty@example.test\nEXPO_PUBLIC_DEV_LOGIN_PASSWORD=fixture-only\n');
  writeFileSync(manifest, JSON.stringify({ version: 1, fixtures: { 'empty-store': { envFile, prepare: ['/usr/bin/true'] } } }));
  const env = { ...fixtureEnv(), FITSY_E2E_FIXTURES: manifest };
  const captured = evaluate(`await (async () => {
    const fixtures = await import(${JSON.stringify(resolve(__dirname, '../sim/journey-fixtures.mjs'))});
    return fixtures.withFixtureEnvironment(fixtures.journeyFixture({tags:['fixture:empty-store','store:test-store']}),
      () => gate.publicConfigIdentity(${JSON.stringify(dir)}).configHash);
  })()`, env);
  expect(captured.status).toBe(0);
  identity.configHash = JSON.parse(captured.stdout); identity.bundleHash = identity.initialBundleHash; writeIdentity();
  const actualCheck = () => {
    writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
    return evaluate(`await gate.validateAcceptance(JSON.parse((await import('node:fs')).readFileSync(${JSON.stringify(join(dir, 'report.json'))}, 'utf8')),
      {required:true,categories:['billing'],flows:['cold-start-welcome','signin-options','billing-cancel']},
      'current-inputs',${JSON.stringify(dir)},Date.now(),${JSON.stringify(dir)},'current-inputs')`, env);
  };
  expect(actualCheck().status).toBe(0);
  writeFileSync(envFile, 'EXPO_PUBLIC_DEV_LOGIN_EMAIL=empty@example.test\nEXPO_PUBLIC_DEV_LOGIN_PASSWORD=changed-fixture\n');
  expect(actualCheck().stderr).toContain('wrong fixture configuration');
});

deterministicTest.each(['truncated', 'skipped', 'optional-required', 'warned', 'warned-optional-required'])('mandatory source assertions reject a %s successful receipt', kind => {
  const report = fixture(), flow = report.flows[2]!;
  report.videoRequested = false;
  for (const entry of report.flows) { delete (entry as { video?: string }).video; delete (entry as { videoHash?: string }).videoHash; }
  const commands = JSON.parse(readFileSync(join(dir, flow.commands), 'utf8'));
  if (kind === 'truncated') commands.pop();
  if (kind === 'skipped') commands[2].metadata.status = 'SKIPPED';
  if (kind === 'optional-required') { commands[2].metadata.status = 'SKIPPED'; commands[2].command.assertConditionCommand.optional = true; }
  if (kind.startsWith('warned')) commands[2].metadata.status = 'WARNED';
  if (kind === 'warned-optional-required') commands[2].command.assertConditionCommand.optional = true;
  const raw = JSON.stringify(commands); writeFileSync(join(dir, flow.commands), raw); flow.sha256 = sha(raw);
  const result = validate(report);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('missing/skipped/failed assertions');
});

deterministicTest('optional and conditional omissions agree across runner and final acceptance without accepting incomplete commands', () => {
  const source = 'appId: com.fitsy.mobile\n---\n- runFlow:\n    when:\n      visible: Development Build\n    commands:\n      - tapOn: localhost\n- assertVisible: Saved targets\n';
  const required = [
    { command: { applyConfigurationCommand: { config: { appId: 'com.fitsy.mobile' } } }, metadata: { status: 'COMPLETED' } },
    { command: { assertConditionCommand: { condition: { visible: { textRegex: 'Saved targets' } } } }, metadata: { status: 'COMPLETED' } },
  ];
  // Captured from #443's successful Maestro run in the Debug build without a launcher.
  const conditional = { runFlowCommand: { commands: [{ tapOnElement: { selector: { textRegex: 'localhost', optional: false } } }],
    condition: { visible: { textRegex: 'Development Build', optional: false } }, optional: false } };
  const cases = [
    { command: conditional, status: 'SKIPPED', accepted: true },
    { command: { runFlowCommand: { ...conditional.runFlowCommand, condition: { notVisible: { textRegex: 'Saved targets' } } } }, status: 'SKIPPED', accepted: true },
    { command: { runFlowCommand: { condition: { scriptCondition: 'false' } } }, status: 'SKIPPED', accepted: true },
    { command: { runFlowCommand: { condition: { platform: 'ANDROID' } } }, status: 'SKIPPED', accepted: true },
    { command: conditional, status: 'FAILED', accepted: false },
    { command: conditional, status: 'WARNED', accepted: false },
    { command: conditional, status: 'UNKNOWN', accepted: false },
    { command: conditional, status: undefined, accepted: false },
    { command: { runFlowCommand: { commands: conditional.runFlowCommand.commands } }, status: 'SKIPPED', accepted: false },
    { command: { runFlowCommand: { condition: {} } }, status: 'SKIPPED', accepted: false },
    { command: { runFlowCommand: { condition: { label: 'startup' } } }, status: 'SKIPPED', accepted: false },
    { command: { runFlowCommand: { condition: { unknown: true } } }, status: 'SKIPPED', accepted: false },
    { command: { runFlowCommand: { condition: { visible: null } } }, status: 'SKIPPED', accepted: false },
    { command: required[1]!.command, status: 'SKIPPED', accepted: false },
    { command: required[1]!.command, status: 'WARNED', accepted: false },
    { command: { tapOnElement: { optional: true } }, status: 'SKIPPED', accepted: true },
    // Maestro 2.3 warns when iOS omits the optional deep-link Open prompt.
    { command: { tapOnElement: { selector: { textRegex: '^Open$', optional: true }, optional: true } }, status: 'WARNED', accepted: true },
    { command: { tapOnElement: { optional: false } }, status: 'WARNED', accepted: false },
    { command: { tapOnElement: {} }, status: 'WARNED', accepted: false },
    { command: { tapOnElement: { optional: true } }, status: 'FAILED', accepted: false },
    { command: { tapOnElement: { optional: true } }, status: 'UNKNOWN', accepted: false },
  ];
  for (const sample of cases) {
    const commands = [...required, { command: sample.command, metadata: { status: sample.status } }];
    const result = evaluate(`await (async () => {
      const runner = await import(${JSON.stringify(resolve(__dirname, '../sim/runner-controls.mjs'))});
      const commands = ${JSON.stringify(commands)};
      let finalAccepted = true;
      try { gate.assertFlowCommands(${JSON.stringify(source)}, commands, 'nutrition'); }
      catch { finalAccepted = false; }
      return { finalAccepted, runnerAccepted: runner.flowFailureReason({code: 0}, commands, {state: 'skipped'}, 'nutrition') === null };
    })()`);
    expect({ status: result.status, ...JSON.parse(result.stdout) }).toEqual({ status: 0,
      finalAccepted: sample.accepted, runnerAccepted: sample.accepted });
  }
});

mediaTest('accepts identified baseline and billing outcomes with matching artifacts', () => {
  const result = validate(fixture()); expect(result.status).toBe(0); expect(JSON.parse(result.stdout).status).toBe('pass');
});
mediaTest('final walkthrough validation decodes genuine JPEG and PNG while rejecting corrupt or expired pixels', () => {
  const report = fixture(), observation = report.exploration[0]!;
  const events = readFileSync(join(dir, observation.trace), 'utf8').split('\n').map(line => JSON.parse(line));
  const pngBytes = readFileSync(resolve(__dirname, '../sim/fixtures/active-saved-meal.png'));
  const jpeg = (name: string) => {
    const output = join(dir, `${name}.jpg`);
    execFileSync('ffmpeg', ['-v', 'error', '-i', resolve(__dirname, `../sim/fixtures/${name}.png`),
      '-frames:v', '1', '-q:v', '2', output], { timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] });
    return readFileSync(output);
  };
  const activeJpeg = jpeg('active-saved-meal'), expiredJpeg = jpeg('subscription-expired');
  const check = (mimeType: string, pixels: Buffer) => {
    const trace = [...events, { at: new Date().toISOString(), command: { name: 'take_screenshot' },
      result: { content: [{ type: 'image', mimeType, data: pixels.toString('base64') }] } }]
      .map(event => JSON.stringify(event)).join('\n');
    writeFileSync(join(dir, observation.trace), trace); observation.sha256 = sha(trace);
    report.finishedAt = new Date().toISOString();
    return validate(report);
  };
  for (const [mime, pixels] of [['image/jpeg', activeJpeg], ['image/png', pngBytes]] as const) {
    const result = check(mime, pixels);
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  }
  expect(check('image/png', activeJpeg).stderr).toContain('matching complete PNG or JPEG');
  expect(check('image/jpeg', activeJpeg.subarray(0, -2)).stderr).toContain('matching complete PNG or JPEG');
  expect(check('image/jpeg', Buffer.from('ffd8ff0000ffd9', 'hex')).stderr).toContain('Screenshot OCR command failed');
  expect(check('image/jpeg', expiredJpeg).stderr).toContain('Unexpected subscription-expired screenshot');
}, 30_000);
deterministicTest('development proof retains assertions but never satisfies final publication', () => {
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
deterministicTest('final candidate accepts complete native proof without video when recording was not requested', () => {
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

deterministicTest.each(['missing', 'expired', 'wrong-hash'])('publication rejects %s screenshot content proof', kind => {
  const report = fixture(), flow = report.flows[2]!;
  // Hosted L2 exercises screenshot proof without the local video decoders.
  report.videoRequested = false;
  for (const entry of report.flows) { delete (entry as { video?: string }).video; delete (entry as { videoHash?: string }).videoHash; }
  if (kind === 'missing') delete (flow as { screenCheck?: unknown }).screenCheck;
  if (kind === 'expired') flow.screenCheck.expired = true;
  if (kind === 'wrong-hash') flow.screenCheck.screenshotHash = 'unrelated';
  const result = validate(report);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('screenshot content check');
});

deterministicTest('walkthrough cannot claim success after observing an unrelated expired subscription screen', () => {
  const report = fixture(), observation = report.exploration[0]!;
  report.videoRequested = false;
  for (const flow of report.flows) { delete (flow as { video?: string }).video; delete (flow as { videoHash?: string }).videoHash; }
  const trace = ['tap_on', 'inspect_view_hierarchy'].map(name => JSON.stringify({
    at: new Date().toISOString(), command: { name }, result: { content: [{ type: 'text', text: 'resubscribe-restore' }] },
  })).join('\n');
  writeFileSync(join(dir, observation.trace), trace); observation.sha256 = sha(trace);
  const result = validate(report);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Unexpected subscription-expired screen');
});

deterministicTest.each([
  ['https://fitsy-api-git-codex-issue-583-dawits-projects-74b6e00f.vercel.app', true],
  ['https://fitsy-immutable123-dawits-projects-74b6e00f.vercel.app', true],
  ['https://api.fitsy.org', false], ['https://unrelated.vercel.app', false],
] as const)('final publication validates backend origin %s', (backend, accepted) => {
  const report = fixture();
  report.backend = backend;
  report.videoRequested = false;
  for (const flow of report.flows) { delete (flow as { video?: string }).video; delete (flow as { videoHash?: string }).videoHash; }
  expect(validate(report).status).toBe(accepted ? 0 : 1);
  if (accepted) {
    const commands = JSON.parse(readFileSync(join(dir, report.flows[2]!.commands), 'utf8'));
    commands.pop();
    const raw = JSON.stringify(commands);
    writeFileSync(join(dir, report.flows[2]!.commands), raw);
    report.flows[2]!.sha256 = sha(raw);
    const incomplete = validate(report);
    expect(incomplete.status).toBe(1);
    expect(incomplete.stderr).toContain('missing/skipped/failed assertions');
  }
});
deterministicTest('non-video proof does not invoke video tooling', () => {
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
  const result = evaluate(`gate.validate(JSON.parse((await import('node:fs')).readFileSync(${JSON.stringify(join(dir, 'report.json'))}, 'utf8')), {required:true, categories:['billing'], flows:['cold-start-welcome','signin-options','billing-cancel']}, 'current-inputs', ${JSON.stringify(dir)}, Date.now(), ${JSON.stringify(dir)}, 'current-inputs')`,
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
  expect(result.stderr).toContain('missing/skipped/failed assertions');
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
  if (condition === 'missing-flow') expect(result.stderr).toContain('missing affected flow');
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
deterministicTest.each([
  [['docs/product/paywall.md'], []],
  [['apps/mobile/app/welcome/payment.tsx'], ['billing', 'onboarding']],
  ...['apps/mobile/lib/teaserGate.ts', 'apps/mobile/components/LockedUnlockCard.tsx'].map(path => [[path], ['billing']]),
  [['apps/api/app/api/revenuecat/webhook/route.ts'], ['billing']],
  [['apps/api/services/revenuecatService.ts'], ['billing']],
  [['apps/api/app/api/subscriptions/status/route.ts'], ['billing']],
  [['apps/api/app/api/subscriptions/sync/route.ts'], ['billing']],
  ...['apps/mobile/app/index.tsx', 'apps/mobile/app/_layout.tsx', 'apps/mobile/lib/reviewAccess.ts', 'apps/mobile/lib/useEntitlement.ts'].map(path => [[path], ['billing']]),
  ...['apps/mobile/app/(tabs)/_layout.tsx', 'apps/mobile/app/(tabs)/profile.tsx', 'apps/api/app/api/restaurants/route.ts', 'apps/api/app/api/restaurants/[id]/menu/route.ts'].map(path => [[path], ['billing', 'discovery']]),
  [['apps/mobile/app/(tabs)/search.tsx'], ['discovery', 'onboarding']],
  [['apps/mobile/app/restaurant/[id].tsx'], ['billing', 'changed-journey', 'discovery']],
  ...['apps/mobile/app/auth/reviewer.tsx', 'apps/mobile/lib/authClient.ts'].map(path => [[path], ['auth', 'billing']]),
  [['apps/mobile/app/auth/signin.tsx'], ['auth']],
  [['apps/api/app/api/push-token/route.ts'], ['notifications']],
  [['packages/shared/src/contracts/trialPolicy.ts'], ['billing', 'discovery', 'notifications', 'onboarding']],
  [['packages/shared/src/search.ts'], ['discovery']],
  [['apps/mobile/components/UnknownButton.tsx'], ['changed-journey']],
  [['apps/api/next.config.ts'], ['changed-journey']],
  [['apps/api/jest.config.js'], []],
  [['apps/api/jest.config.js', 'apps/api/app/api/search/route.ts'], ['discovery']],
  [['apps/api/app/api/health/route.ts', 'apps/api/app/api/health/route.test.ts'], []],
  [['apps/api/app/api/health/route.ts', 'apps/api/app/api/search/route.ts'], ['discovery']],
  [['apps/mobile/eas.json'], ['changed-journey']],
])('routes %j through product impact selection', (paths, categories) => {
  const result = evaluate(`gate.impact(${JSON.stringify(paths)})`);
  expect(JSON.parse(result.stdout).categories).toEqual(categories);
});

deterministicTest('submission-only EAS changes preserve JavaScript and acceptance identities', () => {
  mkdirSync(join(dir, 'apps/mobile'), { recursive: true });
  fixtureGit(['init', '-q', dir]);
  writeFileSync(join(dir, 'apps/mobile/eas.json'), '{"submit":{"production":{"ios":{"ascApiKeyId":"old"}}}}');
  writeFileSync(join(dir, 'apps/mobile/app.tsx'), 'export default null');
  fixtureGit(['-C', dir, 'add', 'apps/mobile']);
  const before = JSON.parse(evaluate(`({js:gate.inputHash(${JSON.stringify(dir)},'js'), acceptance:gate.inputHash(${JSON.stringify(dir)})})`).stdout);
  writeFileSync(join(dir, 'apps/mobile/eas.json'), '{"submit":{"production":{"ios":{"ascApiKeyId":"new"}}}}');
  const after = JSON.parse(evaluate(`({js:gate.inputHash(${JSON.stringify(dir)},'js'), acceptance:gate.inputHash(${JSON.stringify(dir)})})`).stdout);
  expect(after).toEqual(before);
});

deterministicTest.each([
  { actions: ['tap_on', 'inspect_view_hierarchy'], pass: true },
  { actions: ['input_text', 'inspect_view_hierarchy'], pass: true },
  { actions: ['back', 'inspect_view_hierarchy'], pass: true },
  { actions: ['launch_app', 'inspect_view_hierarchy'], pass: true },
  { actions: ['run_flow', 'inspect_view_hierarchy'], pass: false },
  { actions: ['check_flow_syntax', 'inspect_view_hierarchy'], pass: false },
  { actions: ['tap_on', 'take_screenshot'], pass: false },
  { actions: ['tap_on', 'inspect_view_hierarchy'], pass: false, toolError: true },
])('Maestro MCP walkthrough requires interactions and hierarchy observations: $actions (pass=$pass)', ({ actions, pass, toolError }) => {
  const report = fixture();
  report.videoRequested = false;
  for (const flow of report.flows) {
    delete (flow as { video?: string }).video;
    delete (flow as { videoHash?: string }).videoHash;
  }
  const trace = actions.map(name => JSON.stringify({ at: report.finishedAt, command: { name },
    result: { ...(toolError ? { isError: true } : {}), content: [{ type: 'text', text: 'Paywall visible' }] } })).join('\n');
  writeFileSync(join(dir, 'trace.json'), trace); report.exploration[0]!.sha256 = sha(trace);
  const result = validate(report);
  expect({ status: result.status, error: result.status === 0 ? '' : result.stderr }).toEqual({
    status: pass ? 0 : 1, error: pass ? '' : expect.stringMatching(/walkthrough needs actual interactions|invalid\/failed\/stale walkthrough/),
  });
});

test('repoEnv keeps the isolated scratch git config selection but drops repository pointers', () => {
  const env = { ...fixtureEnv(), GIT_CONFIG_GLOBAL: '/scratch/gitconfig', GIT_CONFIG_NOSYSTEM: '1', GIT_DIR: '/hook/repo', GIT_INDEX_FILE: '/hook/index' };
  const result = evaluate('Object.fromEntries(Object.entries(gate.repoEnv()).filter(([key]) => key.startsWith("GIT_")))', env);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ GIT_CONFIG_GLOBAL: '/scratch/gitconfig', GIT_CONFIG_NOSYSTEM: '1' });
});
