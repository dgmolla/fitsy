#!/usr/bin/env node
// Local-only runner. Build and command receipts are generated, never hand-stamped.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, openSync, closeSync, renameSync, realpathSync, copyFileSync, cpSync } from 'node:fs';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { resolve, relative, join, dirname, delimiter } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isMain } from '../verify/impact-plan.mjs';
import { root, inputHash, candidatePlan, selectedFlows, acceptanceExceptions, digest, validateAcceptance, repoEnv, publicConfigIdentity, requiredPublicConfigKeys, buildPublicConfigAcceptance, assertFlowCommands, artifact, artifactPath, walkthroughState } from '../verify/product-flow.mjs';
import { journeyFixture, withFixtureEnvironment, prepareJourney, assertJourneyStore } from './journey-fixtures.mjs';
import { backendOrigin, backendRevision, maestroApiArgs } from './backend-identity.mjs';
import { buildProfile, bundleDelegate, embeddedBundleCompatibility, embeddedArtifactPlan, fixtureLabel, metroRoute } from './build-profile.mjs';
import { nativeIdentity, buildInputDrift, profileIdentity, nativeBuildDecision, reusableNativeReceipt, sealReceipt, identityHash } from './native-identity.mjs';
import { appTreeHash as treeHash, sharedNativeCacheDirectory, importNativeArtifact, importedArtifactIntact, publishNativeArtifact } from './shared-native-cache.mjs';
import { admitDisk, appendRecordedFlowFailure, applyCapturePolicy, archiveFailureEvidence, clock, completeMaestroRun, event, latestMaestroLog, nearestFailure, needsDiagnosis, recordFlowOutcome, recordRunFailure, requireMetro, runRecordedFlow, runOwnedMaestro } from './runner-controls.mjs';
import { classifySimulatorFailure, maestroFailure, withEnvironmentRetry } from './failure-policy.mjs';
import { prepareActiveEntitlement, verifyInactiveEntitlement } from './active-entitlement.mjs';
import { inspectScreenshot, inspectScreenshotDirectory, inspectWalkthrough, requireScreenRecognition } from './screen-guard.mjs';
import { matchesFinalCandidate, readPreviousReportForReuse, runSelection } from './evidence-mode.mjs';
export { readPreviousReportForReuse } from './evidence-mode.mjs';
import { closeoutXCTestAttachments, snapshotXCTestAttachments } from './xctest-attachments.mjs';
const yaml = createRequire(import.meta.url)('js-yaml');
const controlDirectory = fileURLToPath(new URL('.', import.meta.url));
const out = resolve(root, '.evidence/product-flow');
const buildDir = resolve(root, '.evidence/product-build');
const mobile = resolve(root, 'apps/mobile');
const resumeDir = resolve(root, '.evidence/resume');
const failuresFile = join(resumeDir, 'native-failures.json');
export const recipeIdentity = () => {
  const inputs = { prepareNative: digest(prepareNative.toString()), compileNative: digest(compileNative.toString()),
    bundleDelegate: digest(bundleDelegate.toString()), metroRoute };
  return { hash: identityHash(inputs), inputs };
};
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const assert = (ok, why) => { if (!ok) throw new Error(why); };
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', env: repoEnv(), maxBuffer: 32 * 1024 * 1024, ...opts })?.trim() || '';

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]).sort();
}
export function environment() {
  const origin = backendOrigin(process.env.EXPO_PUBLIC_API_URL);
  assert(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, 'Dev Supabase configuration is required');
  assert(!process.env.EXPO_PUBLIC_SUPABASE_URL.includes('zaxkmjqozvmbifiwbxps'), 'Production Supabase is forbidden');
  return { backend: origin, ...publicConfigIdentity(root) };
}
export function backend(value = process.env.EXPO_PUBLIC_API_URL) {
  const origin = backendOrigin(value);
  const d = JSON.parse(run('vercel', ['api', `/v13/deployments/${new URL(origin).hostname}`, '--raw']));
  const revision = backendRevision(d, origin);
  // A different backend revision is safe only if its API/shared/schema contents match.
  const diff = run('git', ['diff', '--no-ext-diff', '--no-textconv', '--name-only', revision, '--', 'apps/api', 'packages/shared', 'prisma', 'package.json', 'package-lock.json']);
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard', '--', 'apps/api', 'packages/shared', 'prisma']);
  if (diff || untracked) throw Object.assign(new Error('Deploy candidate backend/shared/schema changes to the configured preview before running product flows; keep dev.fitsy.org pinned to dev'),
    { code: 'FITSY_BACKEND_SOURCE_MISMATCH' });
  return { backendRevision: revision, backendDeployment: d.id };
}
function device(udid) {
  assert(/^[A-F0-9-]{36}$/i.test(udid || ''), 'Pass an explicit simulator UDID');
  const devices = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'booted', '--json'])).devices;
  const found = Object.entries(devices).find(([, list]) => list.some(d => d.udid === udid && d.state === 'Booted'));
  assert(found, 'The selected simulator is not booted');
  return { simulator: udid, os: found[0] };
}
export function claimDevice() {
  assert(process.env.FITSY_SIM_OWNER, 'Set FITSY_SIM_OWNER for simulator coordination');
  const workerSeconds = Number(process.env.FITSY_DISPATCH_WORKER_TIMEOUT_SECONDS || 90 * 60);
  assert(Number.isFinite(workerSeconds) && workerSeconds > 0, 'Native phase requires a positive worker time budget');
  // One bounded lease covers the permitted worker run plus completion and release.
  const minutes = String(Math.ceil(workerSeconds / 60) + 5);
  run('bash', [join(controlDirectory, 'sim'), 'claim', '--minutes', minutes], { stdio: 'inherit' });
}
export const releaseDevice = () => run('bash', [join(controlDirectory, 'sim'), 'release'], { stdio: 'inherit' });
export async function prepareEntitledEvidence(built, udid, directory, { signIn = false } = {}) {
  mkdirSync(directory, { recursive: true });
  const setup = async allowPurchase => {
    const dir = join(directory, allowPurchase ? 'renew' : 'signin'); mkdirSync(dir, { recursive: true });
    const flow = join(mobile, 'e2e/helpers/active-entitlement.yaml');
    const result = await runOwnedMaestro(process.env.MAESTRO_BIN || 'maestro', ['--device', udid, 'test',
      ...maestroApiArgs(), '-e', `ALLOW_TEST_PURCHASE=${allowPurchase ? '1' : '0'}`,
      '--test-output-dir', dir, '--debug-output', dir, flow], {
      cwd: root, dir, timeline: join(dir, 'timeline.jsonl'), flow: readFileSync(flow, 'utf8'), wallMs: 300_000,
      env: { ...repoEnv(), PATH: `${controlDirectory}${delimiter}${process.env.PATH || ''}`,
        FITSY_XCTEST_SIM_UDID: udid, FITSY_XCTEST_CAPTURE_RECEIPT: join(dir, 'capture.jsonl') },
      diagnostic: () => run('xcrun', ['simctl', 'io', udid, 'screenshot', join(dir, 'failure.png')]),
    });
    if (result.code !== 0 || result.reason) {
      const reports = files(dir).filter(file => /commands-.*\.json$/.test(file));
      const parsed = reports.length === 1 ? read(reports[0]) : null;
      throw maestroFailure('Active Test Store fixture preparation failed; inspect its raw evidence', result,
        Array.isArray(parsed) ? nearestFailure(parsed) : null);
    }
  };
  const proof = await prepareActiveEntitlement({ built, renew: () => setup(true) });
  // A preceding expired/history journey can leave another account in keychain.
  // The walkthrough must enter the active account even when no renewal is due.
  // Renewal already signs in and asserts Search with these exact credentials.
  // Do not immediately clear and relaunch that verified session a second time.
  if (signIn && !proof.renewed && built.storeMode === 'test-store') await setup(false);
  save(join(directory, 'entitlement.json'), proof);
  return proof;
}
export async function prepareBillingEvidence(built, udid, directory, fixture, { signal } = {}) {
  assert(built.storeMode === 'test-store', 'Automatic billing sign-in requires the Debug Test Store fixture');
  const proof = await verifyInactiveEntitlement({ fixture, built });
  mkdirSync(directory, { recursive: true });
  save(join(directory, 'entitlement.json'), proof);
  const flow = join(mobile, 'e2e/helpers/ci-signin.yaml');
  const result = await runOwnedMaestro(process.env.MAESTRO_BIN || 'maestro', ['--device', udid, 'test',
    // The app reads credentials from owned Metro; this UI-only helper does not.
    ...maestroApiArgs(process.env, { includeLogin: false }), '-e', `DESTINATION=${fixture === 'empty-store' ? 'paywall-restore' : 'resubscribe-restore'}`,
    '--test-output-dir', directory, '--debug-output', directory, flow], {
    cwd: root, dir: directory, timeline: join(directory, 'timeline.jsonl'), flow: readFileSync(flow, 'utf8'), signal,
    env: { ...repoEnv(), PATH: `${controlDirectory}${delimiter}${process.env.PATH || ''}`,
      FITSY_XCTEST_SIM_UDID: udid, FITSY_XCTEST_CAPTURE_RECEIPT: join(directory, 'capture.jsonl') },
    diagnostic: () => run('xcrun', ['simctl', 'io', udid, 'screenshot', join(directory, 'failure.png')]),
  });
  const reports = files(directory).filter(file => /commands-.*\.json$/.test(file));
  const parsed = reports.length === 1 ? read(reports[0]) : null;
  if (result.code !== 0 || result.reason)
    throw maestroFailure('Billing fixture native sign-in failed; inspect its raw evidence', result,
      Array.isArray(parsed) ? nearestFailure(parsed) : null);
  assert(reports.length === 1, 'Billing fixture requires exactly one native sign-in command receipt');
  assertFlowCommands(readFileSync(flow), parsed, `${fixture}-signin`);
  return proof;
}
function walkthroughCaller(udid) {
  const report = read(join(out, 'report.json'));
  const built = receipt(udid);
  assert(report.walkthroughProtocol === 1 && report.result === 'awaiting-walkthrough' && report.simulator === udid,
    'A current deterministic run with fixture-bound walkthroughs is required');
  assert(built.storeMode === 'test-store' && built.buildMode === 'owned-metro-test-store', 'Walkthrough fixtures require the Debug Test Store build');
  assert(report.inputHash === inputHash() && report.appHash === built.appHash && report.configHash === environment().configHash &&
    report.jsHash === inputHash(root, 'js'), 'Walkthrough source, artifact or original caller configuration changed');
  assert(report.backendDeployment === backend().backendDeployment, 'Walkthrough backend changed');
  device(udid); installedApp(udid, built.appHash);
  return { report, built };
}
function walkthroughFixture(report, flowName) {
  if (!flowName) return { name: 'default', env: {}, stores: ['test-store'] };
  const flow = report.flows.find(item => item.name === flowName);
  assert(flow, 'Walkthrough fixture must come from an executed journey');
  const source = readFileSync(join(root, flow.source), 'utf8');
  assert(digest(source) === flow.sourceHash, 'Walkthrough journey source changed');
  return journeyFixture(yaml.loadAll(source)[0]);
}
async function prepareWalkthrough(udid, category, flowName) {
  const { report, built } = walkthroughCaller(udid);
  assert(candidatePlan(requiredPublicConfigKeys(report, built, environment())).categories.includes(category), 'Select a required walkthrough category');
  const current = walkthroughState(report, out);
  assert(!current.sessions.has(category), 'This walkthrough category already has an immutable receipt');
  const journey = walkthroughFixture(report, flowName);
  assertJourneyStore(journey, built);
  await checkBundle(report);
  claimDevice();
  const dir = join(out, 'walkthrough', category);
  mkdirSync(dir, { recursive: true });
  const before = join(dir, 'xctest-before.json');
  save(before, snapshotXCTestAttachments(udid));
  const pending = { version: 1, category, flow: flowName || null, fixture: journey.name,
    ...Object.fromEntries(['inputHash', 'jsHash', 'appHash', 'simulator', 'os', 'backendRevision', 'backendDeployment', 'storeMode'].map(key => [key, report[key]])),
    nativeHash: built.nativeIdentity.hash, callerBefore: current.metro, startedAt: new Date().toISOString(),
    attachmentBefore: relative(out, before), attachmentBeforeHash: digest(readFileSync(before)),
    captureReceipt: relative(out, join(dir, 'mcp-capture.jsonl')), state: 'preparing' };
  // Persist the original live caller before stopping it. An interrupted switch
  // remains explicitly pending and cannot pass finish/check/publication.
  report.walkthroughPending = pending;
  save(join(out, 'report.json'), report);
  await withFixtureEnvironment(journey, async () => {
    const session = simulatorSession(udid);
    assert(session.built.appHash === report.appHash && session.backendDeployment === report.backendDeployment,
      'Walkthrough fixture changed the native artifact or backend');
    pending.configHash = session.configHash;
    pending.metro = await startMetro(built);
    save(join(out, 'report.json'), report);
    if (journey.name === 'entitled-dev')
      pending.entitlement = await prepareEntitledEvidence(built, udid, join(dir, 'active-setup'), { signIn: true });
    else if (category === 'billing' && journey.name === 'default')
      pending.entitlement = await verifyInactiveEntitlement({ fixture: 'empty-store', built });
    assert(pending.metro.bundleHash === await metroBundle(pending.metro), 'Walkthrough setup changed the served bundle');
    pending.readyAt = new Date().toISOString(); pending.state = 'ready';
    save(join(out, 'report.json'), report);
  });
  console.log(JSON.stringify({ status: 'ready', category, fixture: journey.name,
    captureReceipt: join(out, pending.captureReceipt), configHash: pending.configHash, bundleHash: pending.metro.bundleHash }));
}
async function finishWalkthrough(trace) {
  const original = read(join(out, 'report.json'));
  const { report, built } = walkthroughCaller(original.simulator);
  const pending = report.walkthroughPending;
  assert(pending?.state === 'ready', 'A ready walkthrough fixture is required');
  const journey = walkthroughFixture(report, pending.flow);
  const dir = join(out, 'walkthrough', pending.category);
  const traceFile = artifactPath(trace, out), traceBytes = readFileSync(traceFile);
  const events = traceBytes.toString().trim().split('\n').map(line => JSON.parse(line));
  assert(events.length && events.every(item => Date.parse(item.at) >= Date.parse(pending.readyAt) &&
    Date.parse(item.at) <= Date.now() && !item.result?.isError && item.result?.content?.length), 'Invalid walkthrough fixture trace');
  assert(events.some(item => ['tap_on', 'input_text', 'back', 'launch_app'].includes(item.command?.name)) &&
    events.some(item => item.command?.name === 'inspect_view_hierarchy'), 'Walkthrough requires real MCP interaction and observation');
  const flow = pending.flow && report.flows.find(item => item.name === pending.flow);
  inspectWalkthrough(events, flow ? readFileSync(join(root, flow.source)) : '');
  claimDevice();
  await withFixtureEnvironment(journey, async () => {
    assert(journey.name === pending.fixture && environment().configHash === pending.configHash, 'Walkthrough fixture changed');
    pending.bundleHash = await metroBundle(pending.metro);
    assert(pending.bundleHash === pending.metro.bundleHash, 'Walkthrough served a different bundle');
  });
  const beforeBytes = artifact(pending.attachmentBefore, out);
  assert(digest(beforeBytes) === pending.attachmentBeforeHash, 'Walkthrough before snapshot changed');
  const before = JSON.parse(beforeBytes), after = snapshotXCTestAttachments(report.simulator);
  const afterFile = join(dir, 'xctest-after.json'); save(afterFile, after);
  assert(!after.entries.some(item => item.video && !before.entries.some(old =>
    old.path === item.path && old.device === item.device && old.inode === item.inode)), 'Unexpected walkthrough video; preserve and diagnose before continuing');
  const closeout = join(dir, 'xctest-attachment-closeout.json');
  save(closeout, closeoutXCTestAttachments(before, after));
  const captureBytes = artifact(pending.captureReceipt, out);
  const captures = captureBytes.toString().trim().split('\n').filter(Boolean).map(JSON.parse);
  assert(captures.length && captures.every(item => item.udid === report.simulator && item.preferredScreenCaptureFormat === 'screenshots'),
    'Missing or invalid walkthrough screenshots-only XCTest capture');
  const completed = { ...pending, state: 'complete', completedAt: new Date().toISOString(),
    trace: relative(out, traceFile), traceHash: digest(traceBytes),
    captureReceiptHash: digest(captureBytes),
    attachmentAfter: relative(out, afterFile), attachmentAfterHash: digest(readFileSync(afterFile)),
    attachmentCloseout: relative(out, closeout), attachmentCloseoutHash: digest(readFileSync(closeout)) };
  if (pending.fixture === 'entitled-dev')
    assert(Date.parse(pending.entitlement?.expiresAt) > Date.parse(completed.completedAt), 'Walkthrough entitlement expired during observation');
  // withFixtureEnvironment restored the exact original caller environment.
  // Keep its original observation and append the actual replacement identity.
  assert(environment().configHash === report.configHash, 'Original walkthrough caller was not restored');
  completed.restoredMetro = await startMetro(built);
  completed.restoredAt = new Date().toISOString();
  assert(completed.restoredMetro.bundleHash === report.bundleHash, 'Restored caller serves a different bundle');
  const file = join(dir, 'identity.json'); save(file, completed);
  delete report.walkthroughPending;
  report.walkthroughSessions.push({ category: pending.category, receipt: relative(out, file), sha256: digest(readFileSync(file)),
    artifacts: [completed.attachmentBefore, completed.attachmentAfter, completed.captureReceipt, completed.attachmentCloseout] });
  walkthroughState(report, out);
  await checkBundle(report);
  save(join(out, 'report.json'), report);
  console.log(JSON.stringify({ status: 'complete', category: pending.category, fixture: pending.fixture,
    restoredPid: completed.restoredMetro.pid, bundleHash: completed.restoredMetro.bundleHash }));
}
const metroFile = join(buildDir, 'metro.json');
const processIdentity = pid => run('ps', ['-p', String(pid), '-o', 'lstart=,command=']);
export function runSelectedRecordedFlow(mode, options) {
  return runRecordedFlow({ ...options, recordVideo: mode?.recordVideo });
}
function verifyRecordedFlow({ recorded, captureVerified, captureError = null, ...outcome }) {
  applyCapturePolicy(recorded.result, { verified: captureVerified, error: captureError });
  return recordFlowOutcome({ recorded, ...outcome });
}
function writeAttachmentCloseout({ before, after, udid, dir, timeline, flow }) {
  const file = join(dir, 'xctest-attachment-closeout.json');
  try {
    const receipt = closeoutXCTestAttachments(before, typeof after === 'function' ? after() : after);
    save(file, receipt);
    event(timeline, { type: 'xctest-attachment-closeout', flow,
      generatedVideos: receipt.generated.videos, deletedVideos: receipt.deleted.length,
      remainingHistoricalVideos: receipt.remainingVideos.length,
      outcome: receipt.generated.videos ? 'unexpected-video-retired' : 'no-new-video' });
    return { receipt, file, error: null };
  } catch (error) {
    save(file, { at: new Date().toISOString(), udid, error: error.message,
      action: 'Inspect exact attachment ownership and writer state before another native phase' });
    event(timeline, { type: 'xctest-attachment-closeout', flow, outcome: 'fail', error: error.message });
    return { receipt: null, file, error: error.message };
  }
}
export async function stopMetro() {
  if (!existsSync(metroFile)) return;
  const m = read(metroFile);
  let current;
  try { current = processIdentity(m.pid); } catch { current = ''; }
  if (current === m.processIdentity) {
    process.kill(m.pid, 'SIGTERM');
    for (let attempt = 0; attempt < 100; attempt++) {
      await new Promise(done => setTimeout(done, 50));
      try { current = processIdentity(m.pid); } catch { current = ''; }
      if (!current) break;
    }
    assert(!current, 'Owned Metro did not stop; retaining its receipt for cleanup');
  }
  else assert(!current, 'Owned Metro PID was reused; inspect before stopping it');
  rmSync(metroFile);
}
async function metroBundle(m) {
  const verify = () => {
    assert(processIdentity(m.pid) === m.processIdentity, 'The identified Metro process is no longer running');
    assert(m.jsHash === inputHash(root, 'js') && m.configHash === environment().configHash, 'Metro JavaScript/configuration changed; start a fresh owned server');
  };
  verify();
  const response = await fetch(`http://localhost:${m.port}${metroRoute}`, { signal: AbortSignal.timeout(120_000) });
  assert(response.ok, `Metro bundle failed: HTTP ${response.status}`);
  const hash = digest(Buffer.from(await response.arrayBuffer()));
  verify();
  return hash;
}
export async function startMetro(r, { maxWorkers } = {}) {
  const dispatched = clock(), timeline = join(buildDir, 'metro-timeline.jsonl');
  event(timeline, { type: 'metro-prepare-start', port: r.metroPort });
  const complete = (m, action) => {
    const returnPrepared = clock();
    const startup = { action, dispatched, returnPrepared,
      elapsedMs: Number(BigInt(returnPrepared.monotonicNs) - BigInt(dispatched.monotonicNs)) / 1e6,
      observation: 'owned Metro readiness and bundle response before receipt write; app UI readiness and outer tool return are unobserved' };
    event(timeline, { type: 'metro-prepare-end', pid: m.pid, jsHash: m.jsHash, configHash: m.configHash, bundleHash: m.bundleHash, ...startup });
    return { ...m, startup };
  };
  try {
    if (existsSync(metroFile)) {
      const m = read(metroFile);
      assert(!m.root || m.root === root, 'Metro receipt belongs to another checkout; refusing to reuse or stop it');
      let alive = true;
      try { process.kill(m.pid, 0); }
      catch (error) { if (error.code !== 'ESRCH') throw error; alive = false; }
      // A local receipt is ownership, not proof of compatible or healthy serving.
      // Never attach to a foreign port or relabel a server after source changes.
      if (alive && m.root === root && m.port === r.metroPort && m.route === metroRoute &&
          m.maxWorkers === (maxWorkers ?? null) && m.jsHash === inputHash(root, 'js') && m.configHash === environment().configHash) {
        await requireMetro(m, { processIdentity, sourceHash: m.jsHash, configHash: m.configHash });
        return complete({ ...m, bundleHash: await metroBundle(m) }, 'reuse');
      }
    }
    return complete(await startMetroProcess(r, maxWorkers), 'start');
  } catch (error) {
    event(timeline, { type: 'metro-prepare-failed', code: error.code || null,
      elapsedMs: Number(process.hrtime.bigint() - BigInt(dispatched.monotonicNs)) / 1e6 });
    throw error;
  }
}
async function startMetroProcess(r, maxWorkers) {
  await stopMetro();
  // Refuse a busy port; never attach to or terminate another task's server.
  await new Promise((resolvePort, reject) => {
    const server = createServer(); server.once('error', reject);
    server.listen(r.metroPort, '127.0.0.1', () => server.close(resolvePort));
  });
  const fd = openSync(join(buildDir, 'metro.log'), 'w');
  const child = spawn(process.execPath, [join(root, 'node_modules/expo/bin/cli'), 'start', '--dev-client', '--localhost', '--port', String(r.metroPort),
    ...(maxWorkers ? ['--max-workers', String(maxWorkers)] : [])], {
    cwd: mobile, detached: true, stdio: ['ignore', fd, fd],
    env: { ...repoEnv(), CI: '1', EXPO_NO_DOTENV: '1', NODE_ENV: 'development', EXPO_OFFLINE: '1' },
  });
  closeSync(fd);
  await new Promise((ready, reject) => { child.once('spawn', ready); child.once('error', reject); });
  child.unref();
  const m = { pid: child.pid, root, maxWorkers: maxWorkers ?? null, port: r.metroPort, route: metroRoute, processIdentity: processIdentity(child.pid),
    jsHash: inputHash(root, 'js'), configHash: environment().configHash };
  save(metroFile, m);
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      let ready = false;
      try {
        const response = await fetch(`http://localhost:${m.port}/status`, { signal: AbortSignal.timeout(1000) });
        ready = await response.text() === 'packager-status:running';
      } catch { /* startup only; failure below remains blocking */ }
      if (ready) return { ...m, bundleHash: await metroBundle(m) };
      assert(processIdentity(m.pid) === m.processIdentity, 'Owned Metro exited during startup; inspect metro.log');
      await new Promise(done => setTimeout(done, 500));
    }
    throw new Error('Owned Metro did not become ready; inspect metro.log');
  } catch (error) {
    try { await stopMetro(); } catch { /* leave the ownership receipt for explicit cleanup */ }
    throw error;
  }
}
async function checkBundle(report) {
  if (report.buildMode === 'owned-metro-test-store') {
    const built = receipt(report.simulator);
    const { metro } = walkthroughState(report, out);
    assert(metro?.route === built.metroRoute && metro?.port === built.metroPort,
      'Owned Metro route or port differs from the URL embedded in the native artifact');
    assert(report.bundleHash === await metroBundle(metro), 'Metro served a different bundle after testing');
  }
  else {
    const built = receipt(report.simulator);
    assert(embeddedBundleCompatibility(built, inputHash(root, 'js'), environment().configHash).compatible &&
      report.bundleHash === built.bundleHash,
      'Embedded Release bundle is stale or changed; fresh JavaScript evidence requires a compatible owned Metro binary');
  }
}
function installedApp(udid, appHash) {
  const installed = run('xcrun', ['simctl', 'get_app_container', udid, 'com.fitsy.mobile', 'app']);
  assert(installed && existsSync(installed) && treeHash(installed) === appHash,
    'Installed simulator app differs from the verified native artifact; reinstall the intact artifact');
}
// The local scope runner shares native, backend and installed-artifact checks.
export function simulatorSession(udid) {
  const config = environment(), built = receipt(udid), identity = device(udid), server = backend();
  const embedded = embeddedBundleCompatibility(built, inputHash(root, 'js'), config.configHash);
  assert(embedded.compatible, `${embedded.reason}; build the current candidate before running simulator scope`);
  installedApp(udid, built.appHash);
  return { built, ...identity, ...server, configHash: config.configHash, inputHash: inputHash() };
}
function existingReceipt() {
  try { return read(join(buildDir, 'receipt.json')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return { invalidReceipt: error.message };
    throw error;
  }
}
function retainedReceipts() {
  if (!existsSync(resumeDir)) return [];
  return readdirSync(resumeDir).filter(name => /^native-receipt-superseded-[0-9]+(?:-[0-9a-f-]{36})?\.json$/.test(name))
    .sort().reverse().flatMap(name => {
      try { return [read(join(resumeDir, name))]; }
      catch { return []; } // Preserve unreadable raw receipts without trusting them.
    });
}
export function archiveActiveReceipt(overwritingApp = null, buildDirectory = buildDir, archiveDirectory = resumeDir) {
  const file = join(buildDirectory, 'receipt.json');
  if (!existsSync(file)) return;
  const archive = join(archiveDirectory, `native-receipt-superseded-${Date.now()}-${randomUUID()}.json`);
  let active;
  try { active = read(file); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    copyFileSync(file, archive);
    return;
  }
  const verified = active?.nativeIdentity && active?.profileIdentity && !nativeBuildDecision({ receipt: active,
    native: active.nativeIdentity, profile: active.profileIdentity, recipe: active.recipeIdentity,
    appIntact: intact(active, buildDirectory) }).rebuild;
  copyFileSync(file, archive);
  if (overwritingApp && verified && resolve(active.app) === resolve(overwritingApp)) {
    const preserved = join(buildDirectory, 'native-artifacts', randomUUID(), 'Fitsy.app');
    mkdirSync(dirname(preserved), { recursive: true });
    cpSync(active.app, preserved, { recursive: true });
    assert(treeHash(preserved) === active.appHash, 'Preserved native artifact differs from verified source');
    const { receiptHash, ...artifact } = active;
    save(join(archiveDirectory, `native-receipt-superseded-${Date.now()}-${randomUUID()}.json`),
      sealReceipt({ ...artifact, app: preserved }));
  }
}
export function preserveRetainedArtifacts(overwritingApp, buildDirectory = buildDir, archiveDirectory = resumeDir) {
  if (!existsSync(archiveDirectory)) return;
  for (const name of readdirSync(archiveDirectory).filter(name => /^native-receipt-superseded-[0-9]+(?:-[0-9a-f-]{36})?\.json$/.test(name))) {
    const source = join(archiveDirectory, name);
    let retained;
    try { retained = read(source); }
    catch { continue; } // Keep unreadable raw evidence untouched.
    if (typeof retained?.app !== 'string' || resolve(retained.app) !== resolve(overwritingApp) ||
      !intact(retained, buildDirectory)) continue;
    const verified = retained.nativeIdentity && retained.profileIdentity && !nativeBuildDecision({
      receipt: retained, native: retained.nativeIdentity, profile: retained.profileIdentity,
      recipe: retained.recipeIdentity, appIntact: true,
    }).rebuild;
    if (!verified) continue; // Keep stale or tampered receipts as evidence.
    const preserved = join(buildDirectory, 'native-artifacts', randomUUID(), 'Fitsy.app');
    mkdirSync(dirname(preserved), { recursive: true });
    cpSync(retained.app, preserved, { recursive: true });
    assert(treeHash(preserved) === retained.appHash, 'Preserved retained artifact differs from verified source');
    const { receiptHash, ...artifact } = retained;
    save(join(archiveDirectory, `native-receipt-superseded-${Date.now()}-${randomUUID()}.json`),
      sealReceipt({ ...artifact, app: preserved }));
  }
}
function intact(r, buildDirectory = buildDir) {
  try { return r?.app && realpathSync(r.app).startsWith(realpathSync(buildDirectory) + '/') &&
    r.appHash === treeHash(r.app) && (!r.sharedNativeArtifact || importedArtifactIntact(r, buildDirectory)); }
  catch { return false; }
}
function buildDecision(udid, profile) {
  const active = existingReceipt();
  const identity = device(udid);
  const native = nativeIdentity(root, { ...process.env, NODE_ENV: profile.configuration === 'Debug' ? 'development' : 'production' });
  const compatibility = profileIdentity(profile, identity);
  const recipe = recipeIdentity();
  const selected = reusableNativeReceipt([active, ...retainedReceipts()], native, compatibility, recipe, intact);
  const r = selected || active;
  return { r, active, identity, native, compatibility,
    decision: selected ? { rebuild: false, reasons: [] } :
      nativeBuildDecision({ receipt: r, native, profile: compatibility, recipe, appIntact: intact(r) }) };
}
function receipt(udid) {
  const active = existingReceipt();
  assert(active, 'Native artifact missing: run build with the required profile');
  const profile = buildProfile(active.storeMode === 'test-store', process.env);
  const { r, active: checkedActive, decision } = buildDecision(udid || active.simulator, profile);
  assert(!decision.rebuild, `Native build required: ${decision.reasons.join('; ')}`);
  assert(r === checkedActive, 'A retained compatible artifact must be activated through build before product flows');
  return checkedActive;
}
export function prepareNative(profile, testStore) {
  // Keyless Release is useful for baseline navigation, but cannot verify billing.
  const env = { ...repoEnv(), EXPO_NO_DOTENV: '1', NODE_ENV: testStore ? 'development' : 'production',
    FITSY_ALLOW_MISSING_PUBLIC_ENV: '1', CI: '1', FORCE_BUNDLING: '1', SKIP_BUNDLING: '' };
  const packageFile = join(mobile, 'package.json'), packageBefore = readFileSync(packageFile);
  try {
    run('npx', ['expo', 'prebuild', '--platform', 'ios', '--no-install'], { cwd: mobile, env, stdio: 'inherit' });
  } finally {
    const before = JSON.parse(packageBefore), after = read(packageFile);
    after.scripts = before.scripts;
    assert(JSON.stringify(after) === JSON.stringify(before), 'Prebuild changed dependencies; inspect package.json before retrying');
    writeFileSync(packageFile, packageBefore);
  }
  run('/usr/libexec/PlistBuddy', ['-c', 'Set :EXUpdatesEnabled false', join(mobile, 'ios/Fitsy/Supporting/Expo.plist')]);
  const delegate = join(mobile, 'ios/Fitsy/AppDelegate.swift');
  writeFileSync(delegate, bundleDelegate(readFileSync(delegate, 'utf8'), profile));
  const podfile = join(mobile, 'ios/Podfile'), pods = readFileSync(podfile, 'utf8');
  assert(/^\s*use_expo_modules!.*$/m.test(pods), 'Unrecognized Expo autolinking setup');
  writeFileSync(podfile, pods.replace(/^\s*use_expo_modules!.*$/m, testStore
    ? "  use_expo_modules!({ exclude: ['expo-dev-client', 'expo-dev-launcher', 'expo-dev-menu'] })"
    : '  use_expo_modules!'));
  const project = join(mobile, 'ios/Fitsy.xcodeproj/project.pbxproj');
  writeFileSync(project, readFileSync(project, 'utf8').replaceAll('export SKIP_BUNDLING=1', 'export FORCE_BUNDLING=1'));
  run('pod', ['install'], { cwd: join(mobile, 'ios'), env, stdio: 'inherit' });
  return env;
}
export function compileNative(profile, udid, env, jobs = 4) {
  const log = join(buildDir, 'build.log');
  const fd = openSync(log, 'w');
  try {
    run('xcodebuild', ['-workspace', 'ios/Fitsy.xcworkspace', '-scheme', 'Fitsy', '-configuration', profile.configuration,
      '-sdk', 'iphonesimulator', '-destination', `id=${udid}`, '-derivedDataPath', buildDir, '-jobs', String(jobs),
      'ONLY_ACTIVE_ARCH=YES', 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', 'build'],
    { cwd: mobile, env, stdio: ['ignore', fd, fd] });
  } finally { closeSync(fd); }
  const app = join(buildDir, `Build/Products/${profile.configuration}-iphonesimulator/Fitsy.app`);
  const entitlementsFile = join(buildDir,
    `Build/Intermediates.noindex/Fitsy.build/${profile.configuration}-iphonesimulator/Fitsy.build/Fitsy.app-Simulated.xcent`);
  const entitlements = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', entitlementsFile]));
  assert(entitlements['application-identifier']?.endsWith('.com.fitsy.mobile'), 'Simulator keychain application entitlement is missing');
  return { app, entitlements };
}
async function build(udid, testStore, forceReason = null, refreshEmbedded = false) {
  const config = environment();
  const profile = buildProfile(testStore, process.env), buildRecipe = recipeIdentity();
  const { r: previous, active, identity, native, compatibility, decision } = buildDecision(udid, profile);
  const sourceJsHash = inputHash(root, 'js');
  const matchingEmbedded = profile.buildMode === 'embedded-release' ? reusableNativeReceipt(
    [active, ...retainedReceipts()].filter(r => r?.buildMode === 'embedded-release' &&
      embeddedBundleCompatibility(r, sourceJsHash, config.configHash).compatible),
    native, compatibility, buildRecipe, intact) : null;
  const reusable = matchingEmbedded || (decision.rebuild ? null : previous);
  const embeddedPlan = embeddedArtifactPlan(reusable || previous, sourceJsHash, config.configHash, refreshEmbedded);
  if (refreshEmbedded) assert(!testStore && previous?.buildMode === 'embedded-release' &&
    embeddedPlan.action === 'rebuild', '--refresh-embedded-js requires a stale embedded Release artifact');
  const initialBuildInputs = { native, jsHash: sourceJsHash, configHash: config.configHash, recipe: buildRecipe };
  if (reusable && !forceReason && !refreshEmbedded) {
    assert(embeddedPlan.action !== 'requires-artifact',
      `${embeddedPlan.reason}; select a compatible owned Metro profile or explicitly run build ${udid} --refresh-embedded-js`);
    if (reusable !== active) {
      mkdirSync(resumeDir, { recursive: true });
      archiveActiveReceipt();
      const { receiptHash, ...artifact } = reusable;
      save(join(buildDir, 'receipt.json'), sealReceipt({ ...artifact,
        publicConfigAcceptance: buildPublicConfigAcceptance(active, config, reusable) }));
    }
    console.log(JSON.stringify({ action: 'reuse', app: reusable.app, appHash: reusable.appHash,
      nativeIdentity: native.hash, profileIdentity: compatibility.hash, reason: 'verified compatible native artifact' }));
    cacheBuiltArtifact();
    return true;
  }
  if (!forceReason && !refreshEmbedded) {
    let imported;
    try {
      imported = importNativeArtifact(sharedNativeCacheDirectory(root), buildDir, native, compatibility,
        buildRecipe, [active, ...retainedReceipts()], intact, () => admitDisk(root, 'Native cache import'));
    } catch (error) {
      if (!['EACCES', 'EPERM', 'EROFS', 'ENOENT'].includes(error.code)) throw error;
      console.error(`Native cache lookup skipped: ${error.message}`);
    }
    if (imported) {
      mkdirSync(resumeDir, { recursive: true });
      archiveActiveReceipt();
      save(join(buildDir, 'receipt.json'), sealReceipt({ ...imported,
        publicConfigAcceptance: buildPublicConfigAcceptance(active, config, imported) }));
      console.log(JSON.stringify({ action: 'reuse', app: imported.app, appHash: imported.appHash,
        nativeIdentity: native.hash, profileIdentity: compatibility.hash, reason: 'verified shared native artifact' }));
      return true;
    }
  }
  const reasons = refreshEmbedded ? [embeddedPlan.reason, ...decision.reasons]
    : forceReason ? [`operator forced diagnostic rebuild: ${forceReason}`, ...decision.reasons] : decision.reasons;
  assert(reasons.length > 0, 'Native compile requires a changed input, missing artifact, or recorded diagnostic reason');
  console.log(JSON.stringify({ action: 'rebuild', reasons, nativeIdentity: native.hash, profileIdentity: compatibility.hash }));
  mkdirSync(resumeDir, { recursive: true });
  const admission = admitDisk(root, 'Native build');
  event(join(resumeDir, 'runner-events.jsonl'), { type: 'build-admission', ...admission, simulator: udid, reasons, nativeIdentity: native.hash });
  claimDevice();
  try {
    mkdirSync(buildDir, { recursive: true });
    const outputApp = join(buildDir, `Build/Products/${profile.configuration}-iphonesimulator/Fitsy.app`);
    preserveRetainedArtifacts(outputApp);
    archiveActiveReceipt(outputApp);
    const env = prepareNative(profile, testStore);
    const preparedNative = nativeIdentity(root, env);
    const preparedJsHash = inputHash(root, 'js');
    const preparedConfigHash = environment().configHash;
    const preparedInputs = { native: preparedNative, jsHash: preparedJsHash,
      configHash: preparedConfigHash, recipe: recipeIdentity() };
    const preparationDrift = buildInputDrift(initialBuildInputs, preparedInputs);
    assert(preparationDrift.length === 0,
      `Inputs changed during native preparation: ${preparationDrift.join(', ')}; discard this artifact`);
    const { app, entitlements } = compileNative(profile, udid, env);
    const builtNative = nativeIdentity(root, env);
    const completedInputs = { native: builtNative, jsHash: inputHash(root, 'js'),
      configHash: environment().configHash, recipe: recipeIdentity() };
    const compilationDrift = buildInputDrift(preparedInputs, completedInputs, true);
    assert(compilationDrift.length === 0,
      `Inputs changed during compilation: ${compilationDrift.join(', ')}; discard this artifact`);
    const bundleHash = digest(readFileSync(join(app, 'main.jsbundle')));
    save(join(buildDir, 'receipt.json'), sealReceipt({ ...config, ...identity, nativeIdentity: builtNative,
      profileIdentity: compatibility, jsHash: inputHash(root, 'js'), app, appHash: treeHash(app), bundleHash,
      publicConfigAcceptance: buildPublicConfigAcceptance(previous, config, active),
      ...profile, metroRoute: profile.metroPort ? metroRoute : null,
      recipeIdentity: buildRecipe, buildRecipeHash: buildRecipe.hash,
      simulatorApplicationIdentifier: entitlements['application-identifier'],
      buildReasons: reasons, builtAt: new Date().toISOString() }));
    cacheBuiltArtifact();
    console.log('Built identified simulator app. Next: run <UDID> [flow names].');
    return false;
  } finally { releaseDevice(); }
}
function cacheBuiltArtifact() {
  const receiptFile = join(buildDir, 'receipt.json');
  if (read(receiptFile).sharedNativeArtifact) return;
  try { publishNativeArtifact(sharedNativeCacheDirectory(root), receiptFile); }
  catch (error) {
    // Optional cache storage cannot invalidate an otherwise verified build.
    console.error(`Native cache publication skipped: ${error.message}`);
  }
}
export function collectionPublicConfigKeys(previousFile, build, current, preflightPlan) {
  const prior = existsSync(previousFile) ? readPreviousReportForReuse(previousFile) : { report: build };
  // Archive recovery must not erase obligations when its fresh report replaces
  // unreadable history. Finish/check/publication consume these same keys.
  return [...new Set([...requiredPublicConfigKeys(prior.report, build, current),
    ...(prior.error ? ['<unknown>'] : []),
    ...(preflightPlan?.paths || []).filter(path => path.startsWith('public-env:'))
      .map(path => path.slice('public-env:'.length)),
  ])].sort();
}
async function execute(udid, names, mode, { approvalId, environmentRetryAllowed = true } = {}) {
  const runFlow = options => runSelectedRecordedFlow(mode, options);
  if (process.env.NODE_ENV === 'test' && process.env.FITSY_PRODUCT_FLOW_TEST_FIXTURE) {
    const fixture = read(process.env.FITSY_PRODUCT_FLOW_TEST_FIXTURE);
    const { runner, commandsFile, captureReceipt, reportFile, flowName } = fixture;
    const report = { ...fixture.reportTemplate, result: 'running', evidenceMode: mode.name,
      videoRequested: mode.recordVideo, flows: fixture.reportTemplate?.flows || [] };
    save(reportFile, report);
    let recorded, attachment;
    try { recorded = await runFlow({ ...runner, env: process.env, diagnostic: async () => {} }); }
    finally {
      const snapshots = fixture.attachmentSnapshots;
      attachment = writeAttachmentCloseout({ before: snapshots.before, after: snapshots.after,
        udid: runner.udid, dir: runner.dir, timeline: runner.timeline, flow: flowName });
    }
    const commands = existsSync(commandsFile) ? read(commandsFile) : null;
    const captureEvents = existsSync(captureReceipt) ? readFileSync(captureReceipt, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    const captureError = attachment.error || (attachment.receipt.generated.videos ? 'XCTest created unexpected video attachment' : null);
    const outcome = verifyRecordedFlow({ recorded, captureError, captureVerified: !captureError && captureEvents.length > 0 &&
      captureEvents.every(item => item.udid === runner.udid && item.preferredScreenCaptureFormat === 'screenshots'),
      commands, videoPath: mode.recordVideo ? runner.video : null, videoReceipt: mode.recordVideo ? 'video.mp4' : null,
      dir: runner.dir, flowName, report, reportFile, timeline: runner.timeline,
      commandReceipt: existsSync(commandsFile) ? commandsFile : null,
      failureDetail: failureReason => ({ failureReason, commandReceipt: existsSync(commandsFile) ? commandsFile : null }) });
    if (outcome.failureReason) throw new Error(`Fixture flow failed: ${outcome.failureReason}`);
    report.flows.push({ ...fixture.flowTemplate, name: flowName,
      commands: relative(dirname(reportFile), commandsFile), sha256: digest(readFileSync(commandsFile)),
      captureReceipt: relative(dirname(reportFile), captureReceipt), captureReceiptHash: digest(readFileSync(captureReceipt)),
      attachmentCloseout: relative(dirname(reportFile), attachment.file), attachmentCloseoutHash: digest(readFileSync(attachment.file)),
      ...(mode.recordVideo ? { video: relative(dirname(reportFile), runner.video), videoHash: digest(readFileSync(runner.video)) } : {}) });
    report.result = 'pass';
    save(reportFile, report);
    console.log(JSON.stringify({ code: recorded.result.code, recorder: recorded.recorderResult.state, report: reportFile }));
    return;
  }
  // Use the real publication consumer's prerequisites and label-aware plan
  // before any device, fixture, recording or evidence-directory mutation.
  const finalPreflight = mode.publishable
    ? await (await import('./publish-product-flow.mjs')).publishProductFlow(undefined, { preflight: true }) : null;
  if (mode.recordVideo) {
    try { run('ffprobe', ['-version'], { timeout: 5000 }); run('ffmpeg', ['-version'], { timeout: 5000 }); }
    catch { throw new Error('ffprobe and ffmpeg are required to validate recorded product-flow video before running Maestro'); }
  }
  requireScreenRecognition();
  const r = receipt(udid), identity = device(udid), server = backend();
  const embedded = embeddedBundleCompatibility(r, inputHash(root, 'js'), environment().configHash);
  assert(embedded.compatible,
    `${embedded.reason}; use a compatible owned Metro profile or run build ${udid} --refresh-embedded-js for an explicit Release artifact`);
  const fixture = fixtureLabel(process.env.FITSY_FIXTURE, process.env.FITSY_SIM_RESET_KEYCHAIN === udid);
  const priorFile = join(out, 'report.json');
  const publicConfigKeys = collectionPublicConfigKeys(priorFile, r, environment(), finalPreflight?.plan);
  const hash = inputHash(), plan = finalPreflight?.plan || candidatePlan(publicConfigKeys);
  const currentStoreMode = buildProfile(r.buildMode === 'owned-metro-test-store', process.env).storeMode;
  assert(!plan.categories.includes('billing') || currentStoreMode !== 'unconfigured', 'Billing evidence requires a configured store');
  const selected = selectedFlows(plan, names);
  assert(selected.length > 0, 'No affected journeys; select explicit diagnostic flows for a non-product change');
  const exceptions = await acceptanceExceptions({ ...plan, flows: selected }, approvalId);
  const flowSources = selected.filter(name => !exceptions.some(item => item.flow === name)).map(name => {
    assert(/^[a-z0-9-]+$/.test(name), 'Invalid flow name');
    const source = `apps/mobile/e2e/flows/${name}.yaml`;
    const bytes = readFileSync(join(root, source));
    return { name, source, sourceHash: digest(bytes), tags: yaml.load(bytes.toString().split(/^---\s*$/m)[0]).tags || [] };
  });
  // Resolve each real fixture before any native action. The excepted Apple
  // history is never provisioned or replaced with a Test Store account.
  const fixtures = new Map(flowSources.map(flow => [flow.name, journeyFixture(flow)]));
  for (const entry of fixtures.values()) assertJourneyStore(entry, r);
  for (const c of plan.categories) assert(flowSources.some(f => f.tags.includes(c)), `Add/select a deterministic scenario tagged ${c}`);
  const existingReport = join(out, 'report.json');
  if (mode.publishable && !process.env.FITSY_SIM_RESET_KEYCHAIN && existsSync(existingReport)) {
    const { report: previous, error: priorError } = readPreviousReportForReuse(existingReport);
    if (priorError) console.log(`Existing final-candidate evidence cannot be reused: ${priorError}. A fresh run will archive it.`);
    if (matchesFinalCandidate(previous, { udid, appHash: r.appHash, configHash: environment().configHash,
      backendDeployment: server.backendDeployment, fixture, flows: flowSources, recordVideo: mode.recordVideo })) {
      try {
        assert(previous.releaseExceptionId === approvalId, 'Release exception selection changed');
        await validateAcceptance(previous, plan, hash, out, Date.now(), root, r.nativeIdentity.hash, mode.name);
        installedApp(udid, r.appHash);
        await checkBundle(previous);
        console.log('Reusing valid final-candidate evidence for this source, app, backend, simulator and flow selection.');
        return true;
      } catch (error) { console.log(`Existing final-candidate evidence cannot be reused: ${error.message}`); }
    }
  }
  mkdirSync(resumeDir, { recursive: true });
  const admission = admitDisk(root, 'Native run', plan.simulator.scope === 'full' ? 31 : 8);
  const history = existsSync(failuresFile) ? read(failuresFile) : [];
  const previous = history.slice(-2);
  if (needsDiagnosis(history)) {
    const checkpoint = join(resumeDir, 'diagnosis-checkpoint.json');
    save(checkpoint, { reason: 'Two matching native failures', failures: previous,
      next: 'Inspect both raw receipts and screen/AX evidence. Write a diagnosis, counterfactual and repair before a new run.' });
    const supplied = process.env.FITSY_DIAGNOSIS_CHECKPOINT;
    const diagnosis = supplied && existsSync(supplied) ? read(supplied) : null;
    if (!diagnosis?.cause || !diagnosis?.counterfactual || !diagnosis?.evidence) throw new Error(`Two matching failures require a diagnosis before retry. Write JSON with cause, counterfactual and evidence; set FITSY_DIAGNOSIS_CHECKPOINT to its path. See ${checkpoint}`);
    history.at(-1).diagnosis = { file: supplied, at: new Date().toISOString() };
    save(failuresFile, history);
  }
  claimDevice();
  try {
    // Retain complete raw proof from a previous run before invalidating its report.
    if (existsSync(out)) {
      const archive = join(resumeDir, `product-flow-${Date.now()}`);
      renameSync(out, archive);
      const relocated = archiveFailureEvidence(history, relative(root, out), relative(root, archive));
      history.splice(0, history.length, ...relocated);
      save(failuresFile, history);
    }
    mkdirSync(out, { recursive: true });
    const timeline = join(out, 'runner-timeline.jsonl');
    event(timeline, { type: 'run-start', simulator: udid, inputHash: hash, buildHash: r.appHash, admission, evidenceMode: mode.name,
      videoRequested: mode.recordVideo });
    const { app, ...buildIdentity } = r;
    const report = { version: 1, ...buildIdentity, storeMode: currentStoreMode,
      ...identity, ...server, inputHash: hash,
      selection: plan.simulator, releaseExceptionId: approvalId, exceptions, environmentRetryAllowed,
      jsHash: inputHash(root, 'js'), configHash: environment().configHash,
      publicConfig: environment().publicConfig,
      publicConfigAcceptance: { keys: publicConfigKeys },
      result: 'running', startedAt: new Date().toISOString(),
      fixture, keychainReset: false, evidenceMode: mode.name, videoRequested: mode.recordVideo,
      maestroVersion: run(process.env.MAESTRO_BIN || 'maestro', ['--version']), flows: [], exploration: [],
      ...(r.buildMode === 'owned-metro-test-store' ? { walkthroughProtocol: 1, walkthroughSessions: [] } : {}) };
    save(join(out, 'report.json'), report);
    if (process.env.FITSY_SIM_RESET_KEYCHAIN) {
      assert(process.env.FITSY_SIM_RESET_KEYCHAIN === udid, 'Keychain reset must explicitly name the selected disposable simulator');
      run('xcrun', ['simctl', 'keychain', udid, 'reset']);
      report.keychainReset = true;
      save(join(out, 'report.json'), report);
    }
    // Keep an already verified installation intact, including an artifact
    // restored through its original writable archive metadata.
    try { installedApp(udid, r.appHash); }
    catch {
      run('xcrun', ['simctl', 'install', udid, app]);
      installedApp(udid, r.appHash);
    }
    for (const flow of flowSources) {
      const journey = fixtures.get(flow.name);
      await withEnvironmentRetry(dir => withFixtureEnvironment(journey, async () => {
        environment();
        releaseDevice();
        prepareJourney(journey, flow.name, udid);
        claimDevice();
        const session = simulatorSession(udid);
        assertJourneyStore(journey, session.built);
        assert(session.built.appHash === r.appHash && session.backendDeployment === report.backendDeployment,
          'Fixture preparation changed the native artifact or backend');
        let metro;
        try {
          if (r.buildMode === 'owned-metro-test-store') metro = await startMetro(r);
          assert(hash === inputHash() && r.appHash === treeHash(app) && session.configHash === environment().configHash,
            'Acceptance inputs, artifact or public configuration changed before Maestro; start a fresh run');
          installedApp(udid, r.appHash);
          if (metro) await requireMetro(metro, { processIdentity,
            sourceHash: report.jsHash, configHash: session.configHash, route: metro.route });
          const flowBytes = readFileSync(join(root, flow.source), 'utf8');
          if (journey.name === 'entitled-dev')
            await prepareEntitledEvidence(r, udid, join(dir, 'active-setup'));
          if (r.storeMode === 'test-store' && ['empty-store', 'expired-subscription'].includes(journey.name))
            await prepareBillingEvidence(r, udid, join(dir, 'billing-setup'), journey.name);
          event(timeline, { type: 'flow-start', flow: flow.name, expected: 'all required commands complete', sourceHash: flow.sourceHash });
          let diagnosticCount = 0;
          const diagnostic = async (reason, details) => {
            const diagnosticName = `diagnostic-${++diagnosticCount}-${reason.replace(/[^a-z0-9-]/gi, '-')}`;
            const screenshot = join(dir, `${diagnosticName}-screen.png`);
            try { run('xcrun', ['simctl', 'io', udid, 'screenshot', screenshot], { timeout: 15000 }); } catch { /* explicitly recorded below */ }
            save(join(dir, `${diagnosticName}.json`), { reason, ...details, screenshot: existsSync(screenshot) ? relative(out, screenshot) : null,
              ax: 'unavailable until Maestro writes a failed command hierarchy', networkTiming: 'unavailable' });
          };
          const video = join(dir, 'flow-untrimmed.mp4');
          const captureReceipt = join(dir, 'xctest-capture-policy.jsonl');
          writeFileSync(captureReceipt, '');
          const attachmentBefore = snapshotXCTestAttachments(udid);
          let recorded, attachment;
          try { recorded = await runFlow({
            maestroCommand: process.env.MAESTRO_BIN || 'maestro',
            maestroArgs: ['--device', udid, 'test', ...maestroApiArgs(process.env, {
              includeLogin: !['empty-store', 'expired-subscription'].includes(journey.name),
            }), join(root, flow.source), '--format', 'junit', '--output', join(dir, 'junit.xml'), '--debug-output', dir, '--test-output-dir', dir],
            udid, video, recorderLog: join(dir, 'recorder.log'), cwd: root,
            env: { ...repoEnv(), PATH: `${controlDirectory}${delimiter}${process.env.PATH || ''}`,
              FITSY_XCTEST_CAPTURE_RECEIPT: captureReceipt, FITSY_XCTEST_SIM_UDID: udid },
            dir, timeline, flow: flowBytes, diagnostic });
          } finally {
            attachment = writeAttachmentCloseout({ before: attachmentBefore, after: () => snapshotXCTestAttachments(udid),
              udid, dir, timeline, flow: flow.name });
          }
          const { result, recorderResult } = recorded;
          let captureEvents = [], captureError = null;
          try { captureEvents = readFileSync(captureReceipt, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
          catch (error) { captureError = error.message; }
          if (attachment.error) captureError = `XCTest attachment closeout failed: ${attachment.error}`;
          else if (attachment.receipt.generated.videos) captureError = `XCTest created ${attachment.receipt.generated.videos} unexpected video attachment(s); exact files were retired after writer-idle proof`;
          const captureVerified = !captureError && captureEvents.length > 0 &&
            captureEvents.every(item => item.udid === udid && item.preferredScreenCaptureFormat === 'screenshots');
          event(timeline, { type: 'xctest-capture-check', flow: flow.name, outcome: captureVerified ? 'verified' : 'missing-or-invalid',
            expected: 'owned xcodebuild uses screenshots, never screenRecording', receipt: relative(out, captureReceipt) });
          const commands = files(dir).filter(f => /commands-.*\.json$/.test(f) &&
            !['active-setup', 'billing-setup'].some(setup => f.startsWith(join(dir, setup) + '/')));
          let parsed = null, commandParseError = null;
          if (commands.length === 1) {
            try { parsed = read(commands[0]); }
            catch (error) { commandParseError = error.message; }
          }
          const failure = Array.isArray(parsed) ? nearestFailure(parsed) : null;
          const outcome = verifyRecordedFlow({ dir, recorded, captureVerified, captureError, commands: parsed, videoPath: mode.recordVideo ? video : null,
            videoReceipt: mode.recordVideo ? relative(out, video) : null,
            flowName: flow.name, report, reportFile: join(out, 'report.json'), timeline,
            commandReceipt: commands.length === 1 ? relative(out, commands[0]) : null,
            failureDetail: failureReason => {
              const screenshot = join(dir, 'failure-screen.png');
              try { run('xcrun', ['simctl', 'io', udid, 'screenshot', screenshot], { timeout: 15000 }); } catch { /* absence recorded below */ }
              const log = latestMaestroLog(dir);
              // Retain raw log; expose only status and duration pairs in the derived summary.
              const networkTiming = log ? [...readFileSync(log, 'utf8').matchAll(/\bHTTP\s+(\d{3})\b[^\n]{0,100}?\b(\d+)\s*ms\b/g)].map(match => ({ status: Number(match[1]), durationMs: Number(match[2]) })) : [];
              return { flow: flow.name, failureReason, exitCode: result.code,
                watchdog: ['inactivity-deadline', 'wall-deadline'].find(reason => reason === (result.priorReason || result.reason)) || null,
                runnerError: result.error || null, capturePolicyFailure: result.capturePolicyFailure || null,
                commandReceipt: commands.length === 1 ? relative(out, commands[0]) : null, commandParseError,
                recorder: { ...recorderResult, file: mode.recordVideo ? relative(out, video) : null },
                failedCommand: failure && { command: failure.command, expected: failure.expected, deadlineMs: failure.deadlineMs, error: failure.error },
                nearestScreenshot: existsSync(screenshot) ? relative(out, screenshot) : null,
                nearestAX: failure?.hierarchy ? 'raw failed command metadata.error.hierarchyRoot' : null,
                networkTiming: networkTiming.length ? networkTiming : null, networkTimingAbsence: networkTiming.length ? null : 'No structured network status/duration in Maestro log' };
            } });
          if (outcome.failureReason) {
            appendRecordedFlowFailure(history, failure, flow.name, outcome, result,
              { at: new Date().toISOString(), evidence: relative(root, dir), head: run('git', ['rev-parse', 'HEAD']) });
            save(failuresFile, history);
            throw maestroFailure(`Native flow ${flow.name} failed; inspect ${relative(root, join(dir, 'failure.json'))} and raw Maestro receipt before retry`, result, failure);
          }
          assert(commands.length === 1, `Expected exactly one command report: ${flow.name}`);
          const screenshot = join(dir, 'outcome.png');
          run('xcrun', ['simctl', 'io', udid, 'screenshot', screenshot]);
          const screenCheck = inspectScreenshot(screenshot, flowBytes);
          const screenshots = inspectScreenshotDirectory(dir, flowBytes);
          save(join(dir, 'screen-checks.json'), screenshots);
          assert(hash === inputHash() && session.configHash === environment().configHash,
            'Candidate source or fixture configuration changed during the journey');
          const bundleHash = metro ? await metroBundle(metro) : r.bundleHash;
          assert(!metro || bundleHash === metro.bundleHash, 'Metro served a different bundle during the journey');
          const identityFile = join(dir, 'identity.json');
          save(identityFile, { version: 1, inputHash: hash, jsHash: report.jsHash, configHash: session.configHash,
            initialBundleHash: metro?.bundleHash || r.bundleHash,
            appHash: r.appHash, nativeHash: r.nativeIdentity.hash, bundleHash, simulator: udid, os: session.os,
            backendRevision: session.backendRevision, backendDeployment: session.backendDeployment,
            fixture: journey.name, storeMode: r.storeMode });
          report.flows.push({ ...flow, commands: relative(out, commands[0]), sha256: digest(readFileSync(commands[0])),
            identity: relative(out, identityFile), identityHash: digest(readFileSync(identityFile)),
            screenshot: relative(out, screenshot), screenshotHash: digest(readFileSync(screenshot)), screenCheck,
            captureReceipt: relative(out, captureReceipt), captureReceiptHash: digest(readFileSync(captureReceipt)),
            attachmentCloseout: relative(out, join(dir, 'xctest-attachment-closeout.json')),
            attachmentCloseoutHash: digest(readFileSync(join(dir, 'xctest-attachment-closeout.json'))),
            ...(mode.recordVideo ? { video: relative(out, video), videoHash: digest(readFileSync(video)) } : {}) });
          save(join(out, 'report.json'), report);
          event(timeline, { type: 'flow-end', flow: flow.name, outcome: 'pass', elapsedMs: result.elapsedMs, commandReceipt: relative(out, commands[0]) });
        } finally {
          try { if (metro) await stopMetro(); }
          finally { releaseDevice(); }
        }
      }), { dir: join(out, flow.name), canRetry: () => environmentRetryAllowed && hash === inputHash() &&
        r.appHash === treeHash(app) && report.configHash === environment().configHash });
    }
    claimDevice();
    if (r.buildMode === 'owned-metro-test-store') {
      report.metro = await startMetro(r);
      report.bundleHash = report.metro.bundleHash;
      save(join(out, 'report.json'), report);
    }
    assert(hash === inputHash() && r.appHash === treeHash(app), 'Candidate changed during tests');
    assert(server.backendDeployment === backend().backendDeployment, 'Dev deployment changed during tests');
    await checkBundle(report);
    completeMaestroRun(join(out, 'report.json'), timeline, report);
    console.log('Maestro complete. Capture affected primary/recovery flows through Maestro MCP, then finish <walkthrough.json>.');
  } catch (error) {
    const evidenceErrors = recordRunFailure(join(out, 'report.json'), join(out, 'runner-timeline.jsonl'), error);
    if (evidenceErrors.length) console.error(`Failure receipt write errors: ${evidenceErrors.join('; ')}`);
    throw error;
  } finally { releaseDevice(); }
}
async function finish(walkthrough) {
  const report = read(join(out, 'report.json'));
  const r = receipt(report.simulator);
  assert(report.result === 'awaiting-walkthrough', 'A completed deterministic run is required');
  assert(report.inputHash === inputHash() && report.appHash === r.appHash, 'Candidate changed after tests');
  assert(report.backendDeployment === backend().backendDeployment, 'Backend changed after tests');
  await checkBundle(report);
  // Walkthrough JSON: array of category/expected/observed/branches/result/trace.
  // trace paths must already be inside the run evidence directory; no secrets.
  report.exploration = walkthrough ? read(resolve(walkthrough)) : [];
  for (const o of report.exploration) {
    assert(typeof o.trace === 'string' && !o.trace.includes('..') && !o.trace.startsWith('/'), 'Trace must be a relative artifact path');
    o.sha256 = digest(readFileSync(join(out, o.trace)));
  }
  report.result = 'pass'; report.finishedAt = new Date().toISOString();
  const result = await validateAcceptance(report, candidatePlan(requiredPublicConfigKeys(report, r, environment())), inputHash(), out,
    Date.now(), root, r.nativeIdentity.hash, report.evidenceMode);
  if (report.evidenceMode === 'final-candidate')
    report.publicConfigAcceptance.verifiedConfigHash = report.configHash;
  save(join(out, 'report.json'), report); console.log(JSON.stringify(result));
}
async function check() {
  const report = read(join(out, 'report.json'));
  const r = receipt(report.simulator);
  assert(report.appHash === r.appHash && report.configHash === environment().configHash,
    'Artifact or public configuration changed after tests');
  assert(report.jsHash === inputHash(root, 'js'), 'JavaScript changed after tests');
  if (r.buildMode === 'embedded-release') assert(report.jsHash === r.jsHash && report.bundleHash === r.bundleHash,
    'Embedded Release bundle cannot provide evidence for newer JavaScript');
  assert(report.backendDeployment === backend().backendDeployment, 'Dev deployment changed after tests');
  installedApp(report.simulator, r.appHash);
  await checkBundle(report);
  await validateAcceptance(report, candidatePlan(requiredPublicConfigKeys(report, r, environment())), inputHash(), out,
    Date.now(), root, r.nativeIdentity.hash, report.evidenceMode);
}
if (isMain(import.meta.url)) {
try {
  const [command, ...args] = process.argv.slice(2);
  if (['build', 'run'].includes(command) && process.platform === 'darwin') {
    const awake = spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
    awake.on('error', error => console.error(`Could not prevent idle sleep: ${error.message}`));
    awake.unref();
  }
  if (command === 'build') {
    const force = args.indexOf('--force-rebuild');
    const reason = args.find(arg => arg.startsWith('--reason='))?.slice('--reason='.length);
    const refresh = args.includes('--refresh-embedded-js');
    assert(args.length >= 1 && args.every((arg, index) => index === 0 || arg === '--test-store' ||
      arg === '--force-rebuild' || arg === '--refresh-embedded-js' || arg.startsWith('--reason=')),
    'build UDID [--test-store] [--refresh-embedded-js] [--force-rebuild --reason=WHY]');
    assert((force >= 0) === Boolean(reason) && (!reason || reason.trim().length >= 8),
      'Diagnostic force rebuild requires --force-rebuild and a recorded --reason of at least eight characters');
    assert(!refresh || (force < 0 && !args.includes('--test-store')),
      '--refresh-embedded-js is only for an existing stale Release artifact');
    await build(args[0], args.includes('--test-store'), reason, refresh);
  }
  else if (command === 'run') { const selected = runSelection(args); await execute(selected.udid, selected.names, selected.mode, selected); }
  else if (command === 'prepare-walkthrough') {
    assert(args.length >= 2 && args.length <= 3, 'prepare-walkthrough requires UDID category [executed-flow]');
    await prepareWalkthrough(...args);
  }
  else if (command === 'finish-walkthrough') {
    assert(args.length === 1, 'finish-walkthrough requires one trace path relative to .evidence/product-flow');
    await finishWalkthrough(args[0]);
  }
  else if (command === 'finish') await finish(args[0]);
  else if (command === 'check') await check();
  else if (command === 'stop-metro') await stopMetro();
  else throw new Error('Usage: node --env-file=apps/mobile/.env.development.local scripts/sim/product-flow.mjs build UDID | run UDID [flow names] [--mode=development|final-candidate|requested-video] [--record-video] [--release-exception=6716597294] [--no-environment-retry] | prepare-walkthrough UDID category [executed-flow] | finish-walkthrough relative-trace | finish [walkthrough.json]');
} catch (e) {
  console.error(JSON.stringify({ status: 'fail', classification: classifySimulatorFailure(e), environmentRetries: e.environmentRetries || 0, summary: e.message })); process.exitCode = 1;
}
}
