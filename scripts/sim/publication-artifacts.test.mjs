import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createPublicationArchive, publishProductFlow } from './publish-product-flow.mjs';
import { artifactPath } from '../verify/product-flow.mjs';

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
      evidenceMode: 'final-candidate', finishedAt: '2026-01-01T00:00:00Z', storeMode: 'test-store' };
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
      ['mode', { evidenceMode: 'development' }, /Final candidate video proof is required/],
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
      validateEvidence: () => {} }), /Final candidate video proof is required/);
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
