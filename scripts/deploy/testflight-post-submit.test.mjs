import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { appleClient, preflight, waitForBuild, inspectArtifact, baselineFor, openBaselinePR, postSubmit } = require('./testflight-post-submit');
const id = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`;
const build = { id: id(1), status: 'FINISHED', platform: 'IOS', distribution: 'STORE', buildProfile: 'testflight',
  appBuildVersion: '7', appVersion: '1.0.0', gitCommitHash: 'a'.repeat(40), runtimeVersion: 'b'.repeat(40),
  artifacts: { buildUrl: 'https://expo.dev/artifacts/eas/fixture.ipa' } };
const fingerprint = { fingerprint: { hash: build.runtimeVersion, package_version: '0.15.4' },
  app: { bundle_id: 'com.fitsy.mobile', version: '1.0.0', build_number: '7', runtime_version: { policy: 'fingerprint' } } };
const artifact = { bundle_id: 'com.fitsy.mobile', build_number: '7', app_version: '1.0.0', runtime_version: build.runtimeVersion,
  channel: 'testflight', ipa_sha256: 'c'.repeat(64), google_ios_client_id: 'fixture.apps.googleusercontent.com' };
const processed = { id: id(2), attributes: { version: '7', processingState: 'VALID' },
  relationships: { preReleaseVersion: { data: { id: id(4) } } } };
const included = [{ id: id(4), attributes: { version: '1.0.0', platform: 'IOS' } }];
const baseline = () => baselineFor(build, fingerprint, artifact, processed, new Date('2026-10-31T22:00:00Z'));

function githubFixture() {
  const calls = [], state = { pr: null, files: null, branch: null, comparison: 'ahead', oldBuild: '6' };
  const encode = value => ({ content: Buffer.from(value).toString('base64') });
  const gh = (path, body) => {
    calls.push({ path, body });
    if (path.startsWith('pulls?')) return state.pr ? [state.pr] : [];
    if (path === 'git/ref/heads/main') return { object: { sha: 'e'.repeat(40) } };
    if (path.startsWith('compare/')) return { status: state.comparison };
    if (path.startsWith('contents/')) {
      const [file, ref] = path.slice(9).split('?ref=');
      if (ref.startsWith('chore/')) return encode(state.files[file]);
      return encode(file.endsWith('.json') ? JSON.stringify({ build_number: state.oldBuild }) : 'export default { ios: { buildNumber: "6" } };\n');
    }
    if (path === `git/commits/${'e'.repeat(40)}`) return { tree: { sha: 'f'.repeat(40) } };
    if (path.startsWith('git/matching-refs/')) return state.branch ? [{ ref: state.branch }] : [];
    if (path === 'git/trees') { state.files = Object.fromEntries(body.tree.map(item => [item.path, item.content])); return { sha: 'd'.repeat(40) }; }
    if (path === 'git/commits') return { sha: '9'.repeat(40) };
    if (path === 'git/refs') { state.branch = body.ref; return {}; }
    if (path === 'pulls') { state.pr = { state: 'open', html_url: 'https://github.com/dgmolla/fitsy/pull/999' }; return state.pr; }
    throw new Error(`Unexpected GitHub operation: ${path}`);
  };
  return { gh, calls, state };
}

test('real ES256 tokens use a short lifetime and never follow pagination off Apple', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  let calls = 0;
  const apple = appleClient({ key: privateKey, ascApiKeyId: 'KEY', ascApiKeyIssuerId: id(8) }, async (url, options) => {
    calls++;
    assert.equal(url.origin, 'https://api.appstoreconnect.apple.com');
    const token = options.headers.authorization.slice(7), [header, payload, signature] = token.split('.');
    assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'ES256');
    const claim = JSON.parse(Buffer.from(payload, 'base64url'));
    assert.equal(claim.exp - claim.iat, 300); assert.equal(claim.aud, 'appstoreconnect-v1');
    assert.equal(verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true);
    return { ok: true, status: 204 };
  });
  await apple('/v1/apps/6763851364');
  await assert.rejects(apple('https://elsewhere.example/v1/builds'), /Unexpected Apple/);
  assert.equal(calls, 1);
});

test('deploy preflight refuses missing CI grants, malformed keys and missing write access before build', () => {
  assert.throws(() => preflight({ GITHUB_ACTIONS: 'true' }), /CI requires/);
  assert.throws(() => preflight({ ASC_API_KEY_P8: 'invalid' }), /configure ASC_API_KEY_P8/);
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const env = { ASC_API_KEY_P8: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  assert.throws(() => preflight(env, () => JSON.stringify({ permissions: { push: false } })), /write access/);
  const commands = [];
  preflight(env, (binary, args) => { commands.push([binary, ...args]); return JSON.stringify({ permissions: { push: true } }); });
  assert.deepEqual(commands.map(args => args[0]), ['gh', 'eas', 'python3']);
});

test('IPA inspection hashes real bytes and reads binary and XML plists from the main app', async () => {
  const zip = execFileSync('python3', ['-c', `import io, plistlib, sys, zipfile
b=io.BytesIO()
with zipfile.ZipFile(b,'w') as z:
 z.writestr('Payload/Fitsy.app/Info.plist',plistlib.dumps(dict(CFBundleIdentifier='com.fitsy.mobile', CFBundleVersion='7', CFBundleShortVersionString='1.0.0', CFBundleURLTypes=[dict(CFBundleURLSchemes=['com.googleusercontent.apps.fixture'])]),fmt=plistlib.FMT_BINARY))
 z.writestr('Payload/Fitsy.app/Expo.plist',plistlib.dumps(dict(EXUpdatesRuntimeVersion='${build.runtimeVersion}', EXUpdatesRequestHeaders={'expo-channel-name':'testflight'})))
sys.stdout.buffer.write(b.getvalue())`]);
  const result = await inspectArtifact(build.artifacts.buildUrl, async () => new Response(zip));
  assert.deepEqual(result, { ...artifact, ipa_sha256: createHash('sha256').update(zip).digest('hex') });
});

test('processing waits through absent, transient and processing responses for the exact app version', async () => {
  let at = 0, calls = 0;
  const found = await waitForBuild(async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('busy'), { status: 429 });
    if (calls === 2) return { data: [] };
    return { data: [{ ...processed, attributes: { ...processed.attributes, processingState: calls === 3 ? 'PROCESSING' : 'VALID' } }], included };
  }, '6763851364', build, { now: () => at, sleep: async ms => { at += ms; }, timeoutSeconds: 120 });
  assert.equal(found.id, processed.id); assert.equal(calls, 4);
});

for (const state of ['FAILED', 'INVALID']) test(`terminal Apple ${state} stops immediately`, async () => {
  await assert.rejects(waitForBuild(async () => ({ data: [{ ...processed, attributes: { version: '7', processingState: state } }], included }),
    '6763851364', build), /processing failed/);
});

test('wrong marketing version and platform cannot satisfy the bounded processing wait', async () => {
  for (const attrs of [{ version: '0.9.0', platform: 'IOS' }, { version: '1.0.0', platform: 'MAC_OS' }]) {
    let at = 0;
    await assert.rejects(waitForBuild(async () => ({ data: [processed], included: [{ id: id(4), attributes: attrs }] }),
      '6763851364', build, { timeoutSeconds: 1, now: () => at, sleep: async ms => { at += ms; } }), /Timed out/);
  }
});

test('baseline refuses runtime, build, source and channel mismatches without altering compatibility gates', () => {
  for (const changes of [{ runtime_version: 'd'.repeat(40) }, { build_number: '8' }, { channel: 'production' }, { ipa_sha256: null }])
    assert.throws(() => baselineFor(build, fingerprint, { ...artifact, ...changes }, processed));
  for (const changes of [{ gitCommitHash: 'unknown' }, { buildProfile: 'production' }, { status: 'ERRORED' }])
    assert.throws(() => baselineFor({ ...build, ...changes }, fingerprint, artifact, processed));
  assert.equal(baseline().asc_build_id, processed.id);
});

test('PR transaction updates buildNumber and TestFlight baseline, survives interruption and never merges', () => {
  const { gh, state, calls } = githubFixture();
  const pr = openBaselinePR(baseline(), gh);
  assert.match(state.files['apps/mobile/app.config.ts'], /buildNumber: "7"/);
  assert.equal(JSON.parse(state.files['scripts/deploy/ios-binary-baseline.json']).ipa_sha256, artifact.ipa_sha256);
  assert.equal(calls.filter(call => call.body && call.path === 'git/refs').length, 1);
  assert.equal(openBaselinePR({ ...baseline(), verified_at: '2026-11-01T00:00:00Z' }, gh), pr);
  state.pr = null; // Remote branch created, response lost before opening the PR.
  assert.equal(openBaselinePR({ ...baseline(), verified_at: '2026-11-01T00:00:00Z' }, gh), pr);
  assert.equal(calls.filter(call => call.body && call.path === 'git/refs').length, 1);
  assert.equal(calls.some(call => /merge|production-binary/.test(call.path)), false);
  assert.match(calls.find(call => call.path === 'pulls').body.body, /^\*\*TL;DR:\*\*/);
});

for (const refusal of ['unmerged-source', 'downgrade', 'closed-pr', 'changed-branch']) test(`PR refuses ${refusal}`, () => {
  const { gh, state, calls } = githubFixture();
  if (refusal === 'unmerged-source') state.comparison = 'behind';
  if (refusal === 'downgrade') state.oldBuild = '8';
  if (refusal === 'closed-pr') state.pr = { state: 'closed' };
  if (refusal === 'changed-branch') {
    openBaselinePR(baseline(), gh); state.pr = null; calls.length = 0;
    state.files['apps/mobile/app.config.ts'] = 'different candidate';
  }
  assert.throws(() => openBaselinePR(baseline(), gh));
  assert.equal(calls.some(call => call.body), false);
});

test('actual post-submit caller waits, confirms Internal membership, opens PR and is idempotent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-post-submit-'));
  const file = join(dir, 'fingerprint.json'); writeFileSync(file, JSON.stringify(fingerprint));
  const { gh, state, calls } = githubFixture();
  const appleCalls = []; let added = false;
  const apple = async (path, body) => {
    appleCalls.push({ path, body });
    if (path === '/v1/apps/6763851364') return { data: { attributes: { bundleId: 'com.fitsy.mobile' } } };
    if (path.startsWith('/v1/builds?')) return { data: [processed], included };
    if (path.includes('/betaGroups?')) return { data: [{ id: id(3), attributes: { name: 'Internal', isInternalGroup: true } }] };
    if (path.endsWith('/relationships/builds')) {
      if (body) { added = true; assert.deepEqual(body, { data: [{ type: 'builds', id: processed.id }] }); return {}; }
      return { data: added ? [{ id: processed.id, type: 'builds' }] : [] };
    }
    throw new Error(`Unexpected Apple call: ${path}`);
  };
  const deps = { apple, gh, evidenceDirectory: dir, inspect: async () => artifact, run: (binary, args) => {
    assert.deepEqual([binary, ...args], ['eas', 'build:view', build.id, '--json']); return JSON.stringify(build);
  } };
  try {
    const result = await postSubmit({ buildId: build.id, fingerprintFile: file }, deps);
    assert.equal(result.baseline_pr, state.pr.html_url);
    assert.equal(JSON.parse(readFileSync(result.evidence)).group, 'Internal');
    await postSubmit({ buildId: build.id, fingerprintFile: file }, deps);
    assert.equal(appleCalls.filter(call => call.body).length, 1);
    assert.equal(calls.filter(call => call.path === 'pulls').length, 1);
    added = false;
    await assert.rejects(postSubmit({ buildId: build.id, fingerprintFile: file }, { ...deps, inspect: async () => ({ ...artifact, channel: 'production' }) }));
    assert.equal(added, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI refuses latest and invalid flags before reading credentials or performing external work', () => {
  for (const args of [[], ['--build=latest'], ['--preflight', '--timeout=0'], ['--unknown']]) {
    const result = spawnSync(process.execPath, [new URL('./testflight-post-submit', import.meta.url).pathname, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /required|Usage|Timeout/);
  }
});

test('the real workflow shell submits its captured build and removes its private key on success and failure', () => {
  const workflow = require('js-yaml').load(readFileSync(new URL('../../.github/workflows/eas-build.yml', import.meta.url), 'utf8'));
  const steps = workflow.jobs['build-and-submit'].steps;
  const buildStep = steps.find(step => step.id === 'native');
  const submit = steps.find(step => step.name === 'Submit to TestFlight');
  const preflightStep = steps.find(step => step.run?.includes('testflight-post-submit --preflight'));
  const followup = steps.find(step => step.run?.includes('testflight-post-submit --build='));
  assert.ok(steps.indexOf(preflightStep) < steps.indexOf(buildStep));
  assert.equal(followup.env.TESTFLIGHT_BUILD_ID, '${{ steps.native.outputs.id }}');
  assert.equal(preflightStep.env.GH_TOKEN, '${{ secrets.TESTFLIGHT_GH_TOKEN }}');
  assert.equal(workflow.jobs['build-and-submit'].environment, 'production-native');
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-testflight-workflow-'));
  try {
    const mobile = join(dir, 'mobile'), bin = join(dir, 'bin');
    mkdirSync(mobile); mkdirSync(bin);
    writeFileSync(join(mobile, 'eas.json'), readFileSync(new URL('../../apps/mobile/eas.json', import.meta.url)));
    writeFileSync(join(bin, 'eas'), `#!/usr/bin/env node
const fs=require('node:fs'); const args=process.argv.slice(2);
if(args[0]==='build') process.stdout.write(${JSON.stringify(JSON.stringify([build]))});
else if(args[0]==='submit') {
 const config=JSON.parse(fs.readFileSync('eas.json')); const key=config.submit.production.ios.ascApiKeyPath;
 fs.writeFileSync(process.env.TRACE_FILE,JSON.stringify({args,key:fs.readFileSync(key,'utf8'),mode:fs.statSync(key).mode&0o777}));
 process.exit(Number(process.env.SUBMIT_EXIT));
} else process.exit(99);
`, { mode: 0o755 });
    const env = { ...process.env, PATH: bin + ':' + process.env.PATH, RUNNER_TEMP: dir,
      GITHUB_OUTPUT: join(dir, 'output'), TRACE_FILE: join(dir, 'trace'), ASC_API_KEY_P8: 'fixture-only' };
    const built = spawnSync('bash', ['-e', '-c', buildStep.run], { cwd: mobile, env, encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    const exactId = readFileSync(env.GITHUB_OUTPUT, 'utf8').trim().slice(3);
    assert.equal(exactId, build.id);
    for (const code of [0, 1]) {
      const result = spawnSync('bash', ['-e', '-c', submit.run], { cwd: mobile,
        env: { ...env, TESTFLIGHT_BUILD_ID: exactId, SUBMIT_EXIT: String(code) }, encoding: 'utf8' });
      assert.equal(result.status, code, result.stderr);
      assert.deepEqual(JSON.parse(readFileSync(env.TRACE_FILE)), { args: ['submit', '--platform', 'ios', '--profile', 'testflight', '--id', exactId, '--non-interactive'], key: 'fixture-only', mode: 0o600 });
      assert.equal(existsSync(join(dir, 'testflight-key.p8')), false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
