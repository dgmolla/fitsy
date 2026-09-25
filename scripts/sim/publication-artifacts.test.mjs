import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createPublicationArchive, publishProductFlow } from './publish-product-flow.mjs';
import { artifactPath, baseline, inputHash, root } from '../verify/product-flow.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');

test('the publisher path retains every flow command, screen and complete video with the report and exploration proof', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-publication-'));
  try {
    const evidenceDirectory = join(dir, 'product-flow');
    const publicationDirectory = join(dir, 'publication');
    const report = { flows: [
      { commands: 'welcome/commands.json', screenshot: 'welcome/outcome.png', captureReceipt: 'welcome/xctest-capture-policy.jsonl', video: 'welcome/flow-untrimmed.mp4', videoHash: 'hash' },
      { commands: 'signup/commands.json', screenshot: 'signup/outcome.png', captureReceipt: 'signup/xctest-capture-policy.jsonl', video: 'signup/flow-untrimmed.mp4', videoHash: 'hash' },
    ],
      exploration: [{ category: 'onboarding', trace: 'mcp/onboarding.jsonl' }],
      inputHash: 'fixture-input', appHash: 'fixture-app', configHash: 'fixture-config', result: 'pass',
      evidenceMode: 'final-candidate', videoRequested: true, finishedAt: '2026-01-01T00:00:00Z', storeMode: 'test-store' };
    const required = [
      'report.json',
      'welcome/commands.json',
      'welcome/outcome.png',
      'welcome/xctest-capture-policy.jsonl',
      'welcome/flow-untrimmed.mp4',
      'signup/commands.json',
      'signup/outcome.png',
      'signup/xctest-capture-policy.jsonl',
      'signup/flow-untrimmed.mp4',
      'mcp/onboarding.jsonl',
    ];
    for (const path of required) {
      mkdirSync(join(evidenceDirectory, path, '..'), { recursive: true });
      writeFileSync(join(evidenceDirectory, path), path);
    }
    writeFileSync(join(evidenceDirectory, 'report.json'), JSON.stringify(report));
    const head = 'a'.repeat(40);
    const prUrl = 'https://github.com/dgmolla/fitsy/pull/7';
    const states = [];
    let uploadedBytes = null, suppressUpload = false, corruptDigest = false, validations = 0, identityChecks = 0, uploadAttempts = 0;
    const execute = (command, args, options = {}) => {
      if (command === 'tar') return execFileSync('tar', args, { encoding: 'utf8' }).trim();
      if (command === 'git') return args[0] === 'rev-parse' ? head : '';
      if (command === process.execPath) {
        assert.equal(args.at(-1), 'check');
        identityChecks++;
        assert.equal(report.appHash, 'fixture-app', 'invalid current app identity');
        assert.equal(report.configHash, 'fixture-config', 'invalid current configuration identity');
        return '';
      }
      assert.equal(command, 'gh');
      if (args[0] === 'pr') return JSON.stringify({ headRefOid: head, baseRefName: 'main', headRepositoryOwner: { login: 'dgmolla' }, state: 'OPEN', url: prUrl });
      if (args[0] === 'api' && args[1].includes('/statuses/')) {
        states.push(JSON.parse(options.input).state);
        return '';
      }
      if (args[0] === 'release' && args[1] === 'view') throw new Error('fixture release absent');
      if (args[0] === 'release' && args[1] === 'upload') {
        uploadAttempts++;
        if (!suppressUpload) uploadedBytes = readFileSync(args[3]);
        return '';
      }
      if (args[0] === 'release') return '';
      if (args[0] === 'api' && args[1].includes('/releases/tags/')) {
        return JSON.stringify({ draft: true, html_url: 'https://github.com/dgmolla/fitsy/releases/tag/fixture',
          assets: uploadedBytes ? [{ name: 'local-evidence.tar.gz', state: 'uploaded', size: uploadedBytes.length,
            digest: corruptDigest ? `sha256:${'0'.repeat(64)}` : `sha256:${createHash('sha256').update(uploadedBytes).digest('hex')}` }] : [] });
      }
      assert.fail(`Unexpected forge command: ${args.join(' ')}`);
    };
    const validateIdentity = (actual, plan, currentSourceHash) => {
      validations++;
      assert.deepEqual(plan.categories, ['onboarding']);
      assert.equal(currentSourceHash, 'fixture-input', 'publisher must pass the current source hash');
      assert.equal(actual.inputHash, currentSourceHash, 'invalid source-bound evidence');
      assert.equal(actual.result, 'pass', 'failed flow evidence cannot be published');
    };
    const result = await publishProductFlow('7', { execute, evidenceDirectory, publicationDirectory,
      resolvePlan: () => ({ required: true, categories: ['onboarding'] }), sourceHash: () => 'fixture-input',
      validateEvidence: (actual, plan, sourceHash) => {
        validateIdentity(actual, plan, sourceHash);
        assert.deepEqual(actual.flows, report.flows);
      } });
    assert.equal(result.status, 'pass');
    assert.equal(validations, 1, 'source-bound validation ran before publication');
    assert.equal(identityChecks, 1, 'current app and configuration checked before publication');
    assert.deepEqual(states, ['pending', 'success']);
    const options = { execute, evidenceDirectory, publicationDirectory,
      resolvePlan: () => ({ required: true, categories: ['onboarding'] }), sourceHash: () => 'fixture-input',
      validateEvidence: validateIdentity };
    const validIdentity = { inputHash: report.inputHash, appHash: report.appHash, configHash: report.configHash,
      result: report.result, evidenceMode: report.evidenceMode };
    for (const [field, change, expected] of [
      ['source input', { inputHash: 'stale-source' }, /invalid source-bound evidence/],
      ['status', { result: 'fail' }, /failed flow evidence cannot be published/],
      ['mode', { evidenceMode: 'development' }, /Final candidate proof is required/],
      ['app hash', { appHash: 'stale-app' }, /invalid current app identity/],
      ['configuration hash', { configHash: 'stale-config' }, /invalid current configuration identity/],
    ]) {
      Object.assign(report, validIdentity, change);
      writeFileSync(join(evidenceDirectory, 'report.json'), JSON.stringify(report));
      uploadedBytes = null;
      const attemptsBefore = uploadAttempts;
      await assert.rejects(publishProductFlow('7', options), expected, field);
      assert.equal(uploadedBytes, null, `${field} cannot reach asset upload`);
      assert.equal(uploadAttempts, attemptsBefore, `${field} must reject before upload`);
      assert.deepEqual(states.slice(-2), ['pending', 'failure'], field);
    }
    Object.assign(report, validIdentity);
    writeFileSync(join(evidenceDirectory, 'report.json'), JSON.stringify(report));
    uploadedBytes = null;
    suppressUpload = true;
    await assert.rejects(publishProductFlow('7', options), /asset digest\/size readback/);
    assert.equal(uploadedBytes, null, 'a skipped upload cannot create a remote asset');
    assert.deepEqual(states.slice(-2), ['pending', 'failure']);
    suppressUpload = false;
    corruptDigest = true;
    await assert.rejects(publishProductFlow('7', options), /asset digest\/size readback/);
    assert.ok(uploadedBytes?.length > 0, 'digest mismatch uses bytes from an actual upload');
    assert.deepEqual(states.slice(-2), ['pending', 'failure']);
    corruptDigest = false;
    const archive = join(publicationDirectory, 'local-evidence.tar.gz');
    const listed = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual([...listed].sort(), [...required].sort());
    for (const path of required) {
      const extracted = execFileSync('tar', ['-xOf', archive, path]);
      const expected = createHash('sha256').update(readFileSync(join(evidenceDirectory, path))).digest('hex');
      assert.equal(createHash('sha256').update(extracted).digest('hex'), expected, path);
    }
    const unarchived = join(evidenceDirectory, 'unarchived-video.mp4');
    writeFileSync(unarchived, 'complete video bytes');
    unlinkSync(join(evidenceDirectory, report.flows[0].video));
    symlinkSync('../unarchived-video.mp4', join(evidenceDirectory, report.flows[0].video));
    assert.equal(artifactPath(report.flows[0].video, evidenceDirectory), realpathSync(unarchived));
    const attemptsBeforeUnsafeArchive = uploadAttempts;
    await assert.rejects(publishProductFlow('7', { execute, evidenceDirectory, publicationDirectory,
      resolvePlan: () => ({ required: true, categories: ['onboarding'] }), sourceHash: () => 'fixture-input',
      validateEvidence: () => {} }), /regular file/);
    assert.equal(uploadAttempts, attemptsBeforeUnsafeArchive, 'unsafe archive must reject before upload');
    assert.deepEqual(states.slice(-2), ['pending', 'failure']);
    const archivePath = join(publicationDirectory, 'local-evidence.tar.gz');
    await assert.rejects(createPublicationArchive(report, ['onboarding'], evidenceDirectory, archivePath, execute), /regular file/);
    unlinkSync(join(evidenceDirectory, report.flows[0].video));
    symlinkSync(join(dir, 'outside-video.mp4'), join(evidenceDirectory, report.flows[0].video));
    writeFileSync(join(dir, 'outside-video.mp4'), 'outside bytes');
    assert.throws(() => artifactPath(report.flows[0].video, evidenceDirectory), /escapes evidence directory/);
    await assert.rejects(createPublicationArchive(report, ['onboarding'], evidenceDirectory, archivePath, execute), /regular file/);
    unlinkSync(join(evidenceDirectory, report.flows[0].video));
    writeFileSync(join(evidenceDirectory, report.flows[0].video), 'restored video');
    renameSync(join(evidenceDirectory, 'welcome'), join(evidenceDirectory, 'actual-welcome'));
    symlinkSync('actual-welcome', join(evidenceDirectory, 'welcome'));
    await assert.rejects(createPublicationArchive(report, ['onboarding'], evidenceDirectory, archivePath, execute), /real parent directories/);
    report.evidenceMode = 'development';
    delete report.flows[0].video;
    delete report.flows[0].videoHash;
    writeFileSync(join(evidenceDirectory, 'report.json'), JSON.stringify(report));
    await assert.rejects(publishProductFlow('7', { execute, evidenceDirectory, publicationDirectory,
      resolvePlan: () => ({ required: true, categories: ['onboarding'] }), sourceHash: () => 'fixture-input',
      validateEvidence: () => {} }), /Final candidate proof is required/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('publisher detects an archive with listed video whose extracted bytes differ', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-archive-bytes-'));
  try {
    const evidence = join(dir, 'evidence'), tampered = join(dir, 'tampered'), archive = join(dir, 'archive.tar.gz');
    const report = { flows: [{ commands: 'flow/commands.json', screenshot: 'flow/outcome.png',
      captureReceipt: 'flow/xctest-capture-policy.jsonl', video: 'flow/flow-untrimmed.mp4' }], exploration: [] };
    for (const base of [evidence, tampered]) {
      mkdirSync(join(base, 'flow'), { recursive: true });
      for (const path of ['report.json', ...Object.values(report.flows[0])]) writeFileSync(join(base, path), path);
    }
    writeFileSync(join(tampered, report.flows[0].video), 'changed video bytes');
    const execute = (_command, args) => {
      if (args[0] === '-czf') return execFileSync('tar', ['-czf', args[1], '-C', tampered, ...args.slice(4)], { encoding: 'utf8' }).trim();
      return execFileSync('tar', args, { encoding: 'utf8' }).trim();
    };
    await assert.rejects(createPublicationArchive(report, [], evidence, archive, execute), /incomplete or changed bytes: flow\/flow-untrimmed.mp4/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('final candidate publishes complete non-video proof when recording was not requested', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-no-video-publication-'));
  try {
    const evidenceDirectory = join(dir, 'product-flow'), publicationDirectory = join(dir, 'publication');
    const report = { evidenceMode: 'final-candidate', videoRequested: false, inputHash: 'source',
      result: 'pass', finishedAt: '2026-01-01T00:00:00Z', storeMode: 'test-store',
      flows: [{ commands: 'welcome/commands.json', screenshot: 'welcome/outcome.png',
        captureReceipt: 'welcome/xctest-capture-policy.jsonl' }],
      exploration: [{ category: 'onboarding', trace: 'mcp/onboarding.jsonl' }] };
    const required = ['report.json', 'welcome/commands.json', 'welcome/outcome.png',
      'welcome/xctest-capture-policy.jsonl', 'mcp/onboarding.jsonl'];
    for (const path of required) {
      mkdirSync(join(evidenceDirectory, path, '..'), { recursive: true });
      writeFileSync(join(evidenceDirectory, path), path === 'report.json' ? JSON.stringify(report) : path);
    }
    const head = 'b'.repeat(40), url = 'https://github.com/dgmolla/fitsy/pull/8';
    let uploaded = null, validations = 0;
    const execute = (command, args) => {
      if (command === 'tar') return execFileSync('tar', args, { encoding: 'utf8' }).trim();
      if (command === 'git') return args[0] === 'rev-parse' ? head : '';
      if (command === process.execPath) return '';
      assert.equal(command, 'gh');
      if (args[0] === 'pr') return JSON.stringify({ headRefOid: head, baseRefName: 'main',
        headRepositoryOwner: { login: 'dgmolla' }, state: 'OPEN', url });
      if (args[0] === 'release' && args[1] === 'view') throw new Error('fixture release absent');
      if (args[0] === 'release' && args[1] === 'upload') uploaded = readFileSync(args[3]);
      if (args[0] === 'api' && args[1].includes('/releases/tags/')) return JSON.stringify({ draft: true,
        html_url: 'https://github.com/dgmolla/fitsy/releases/tag/fixture',
        assets: [{ name: 'local-evidence.tar.gz', state: 'uploaded', size: uploaded.length,
          digest: `sha256:${createHash('sha256').update(uploaded).digest('hex')}` }] });
      return '';
    };
    const result = await publishProductFlow('8', { execute, evidenceDirectory, publicationDirectory,
      resolvePlan: () => ({ required: true, categories: ['onboarding'] }), sourceHash: () => 'source',
      validateEvidence: actual => { validations++; assert.equal(actual.videoRequested, false); assert.equal(actual.result, 'pass'); } });
    assert.equal(result.status, 'pass');
    assert.equal(validations, 1);
    const archive = join(publicationDirectory, 'local-evidence.tar.gz');
    assert.deepEqual(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n').sort(), required.sort());
    for (const path of required)
      assert.deepEqual(execFileSync('tar', ['-xOf', archive, path]), readFileSync(join(evidenceDirectory, path)));
    assert.doesNotMatch(readFileSync(join(publicationDirectory, 'notes.md'), 'utf8'), /flow videos/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('publisher default validator accepts complete non-video proof and rejects changed commands before upload', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-default-publication-'));
  try {
    const evidenceDirectory = join(dir, 'product-flow'), publicationDirectory = join(dir, 'publication');
    const simulator = 'fixture-device', png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
    const flows = baseline.map(name => {
      const source = `apps/mobile/e2e/flows/${name}.yaml`;
      const commands = `${name}/commands.json`, screenshot = `${name}/outcome.png`;
      const captureReceipt = `${name}/xctest-capture-policy.jsonl`;
      const attachmentCloseout = `${name}/xctest-attachment-closeout.json`;
      const raw = JSON.stringify([
        { command: { applyConfigurationCommand: { config: { appId: 'com.fitsy.mobile', name } } }, metadata: { status: 'COMPLETED' } },
        { command: { assertConditionCommand: { condition: { visible: { textRegex: 'Welcome' } } } }, metadata: { status: 'COMPLETED' } },
      ]);
      const capture = JSON.stringify({ udid: simulator, preferredScreenCaptureFormat: 'screenshots' }) + '\n';
      const closeout = JSON.stringify({ udid: simulator, generated: { videos: 0 }, deleted: [] }) + '\n';
      for (const path of [commands, screenshot, captureReceipt, attachmentCloseout]) mkdirSync(join(evidenceDirectory, path, '..'), { recursive: true });
      writeFileSync(join(evidenceDirectory, commands), raw);
      writeFileSync(join(evidenceDirectory, screenshot), png);
      writeFileSync(join(evidenceDirectory, captureReceipt), capture);
      writeFileSync(join(evidenceDirectory, attachmentCloseout), closeout);
      return { name, source, sourceHash: sha(readFileSync(join(root, source))), commands, sha256: sha(raw),
        screenshot, screenshotHash: sha(png), captureReceipt, captureReceiptHash: sha(capture),
        attachmentCloseout, attachmentCloseoutHash: sha(closeout) };
    });
    const source = inputHash(), nativeSourceHash = inputHash(root, true), head = 'c'.repeat(40);
    const report = { version: 1, evidenceMode: 'final-candidate', videoRequested: false,
      startedAt: new Date(Date.now() - 10_000).toISOString(), finishedAt: new Date().toISOString(),
      inputHash: source, nativeSourceHash, result: 'pass', appHash: 'app', bundleHash: 'bundle',
      backendRevision: 'dev-revision', backend: 'https://dev.fitsy.org', simulator, os: 'iOS 26.4',
      storeMode: 'test-store', fixture: 'run-owned-user', maestroVersion: '2.3.0', flows, exploration: [] };
    writeFileSync(join(evidenceDirectory, 'report.json'), JSON.stringify(report));
    let uploaded = null, uploads = 0;
    const execute = (command, args, options = {}) => {
      if (command === 'tar') return execFileSync('tar', args, { encoding: 'utf8' }).trim();
      if (command === 'git') return args[0] === 'rev-parse' ? head : '';
      if (command === process.execPath) return '';
      assert.equal(command, 'gh');
      if (args[0] === 'pr') return JSON.stringify({ headRefOid: head, baseRefName: 'main',
        headRepositoryOwner: { login: 'dgmolla' }, state: 'OPEN', url: 'https://github.com/dgmolla/fitsy/pull/9' });
      if (args[0] === 'release' && args[1] === 'view') throw new Error('fixture release absent');
      if (args[0] === 'release' && args[1] === 'upload') { uploads++; uploaded = readFileSync(args[3]); return ''; }
      if (args[0] === 'api' && args[1].includes('/releases/tags/')) return JSON.stringify({ draft: true,
        html_url: 'https://github.com/dgmolla/fitsy/releases/tag/fixture',
        assets: [{ name: 'local-evidence.tar.gz', state: 'uploaded', size: uploaded.length,
          digest: `sha256:${sha(uploaded)}` }] });
      if (args[0] === 'api' && args[1].includes('/statuses/')) return '';
      return '';
    };
    const options = { execute, evidenceDirectory, publicationDirectory,
      resolvePlan: () => ({ required: true, categories: [] }), sourceHash: () => source };
    const published = await publishProductFlow('9', options);
    assert.equal(published.status, 'pass');
    assert.equal(uploads, 1);
    assert.equal(execFileSync('tar', ['-tzf', join(publicationDirectory, 'local-evidence.tar.gz')], { encoding: 'utf8' })
      .includes(flows[0].commands), true);
    assert.equal(execFileSync('tar', ['-tzf', join(publicationDirectory, 'local-evidence.tar.gz')], { encoding: 'utf8' })
      .includes(flows[0].attachmentCloseout), true);
    const closeoutPath = report.flows[0].attachmentCloseout;
    const closeoutHash = report.flows[0].attachmentCloseoutHash;
    delete report.flows[0].attachmentCloseout;
    delete report.flows[0].attachmentCloseoutHash;
    writeFileSync(join(evidenceDirectory, 'report.json'), JSON.stringify(report));
    await assert.rejects(publishProductFlow('9', options), /missing XCTest attachment closeout/);
    assert.equal(uploads, 1, 'missing closeout must stop before another upload');
    report.flows[0].attachmentCloseout = closeoutPath;
    report.flows[0].attachmentCloseoutHash = closeoutHash;
    writeFileSync(join(evidenceDirectory, 'report.json'), JSON.stringify(report));
    writeFileSync(join(evidenceDirectory, flows[0].commands), '[]');
    await assert.rejects(publishProductFlow('9', options), /changed command artifact/);
    assert.equal(uploads, 1, 'invalid proof must stop before another upload');
    writeFileSync(join(evidenceDirectory, flows[0].attachmentCloseout), JSON.stringify({ udid: simulator, generated: { videos: 1 }, deleted: [] }));
    report.flows[0].attachmentCloseoutHash = sha(readFileSync(join(evidenceDirectory, flows[0].attachmentCloseout)));
    writeFileSync(join(evidenceDirectory, flows[0].commands), JSON.stringify([
      { command: { applyConfigurationCommand: { config: { appId: 'com.fitsy.mobile', name: flows[0].name } } }, metadata: { status: 'COMPLETED' } },
      { command: { assertConditionCommand: { condition: { visible: { textRegex: 'Welcome' } } } }, metadata: { status: 'COMPLETED' } },
    ]));
    report.flows[0].sha256 = sha(readFileSync(join(evidenceDirectory, flows[0].commands)));
    writeFileSync(join(evidenceDirectory, 'report.json'), JSON.stringify(report));
    await assert.rejects(publishProductFlow('9', options), /unexpected XCTest recording/);
    assert.equal(uploads, 1, 'unexpected incidental recording must stop before upload');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
