import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { publishProductFlow } from './publish-product-flow.mjs';

test('the publisher path retains every flow command, screen and complete video with the report and exploration proof', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-publication-'));
  try {
    const evidenceDirectory = join(dir, 'product-flow');
    const publicationDirectory = join(dir, 'publication');
    const report = { flows: [
      { commands: 'welcome/commands.json', screenshot: 'welcome/outcome.png', video: 'welcome/flow-untrimmed.mp4' },
      { commands: 'signup/commands.json', screenshot: 'signup/outcome.png', video: 'signup/flow-untrimmed.mp4' },
    ],
      exploration: [{ category: 'onboarding', trace: 'mcp/onboarding.jsonl' }],
      inputHash: 'fixture-input', finishedAt: '2026-01-01T00:00:00Z', storeMode: 'test-store' };
    const required = [
      'report.json',
      'welcome/commands.json',
      'welcome/outcome.png',
      'welcome/flow-untrimmed.mp4',
      'signup/commands.json',
      'signup/outcome.png',
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
    const execute = (command, args, options = {}) => {
      if (command === 'tar') return execFileSync('tar', args, { encoding: 'utf8' }).trim();
      if (command === 'git') return args[0] === 'rev-parse' ? head : '';
      if (command === process.execPath) return '';
      assert.equal(command, 'gh');
      if (args[0] === 'pr') return JSON.stringify({ headRefOid: head, baseRefName: 'main', headRepositoryOwner: { login: 'dgmolla' }, state: 'OPEN', url: prUrl });
      if (args[0] === 'api' && args[1].includes('/statuses/')) {
        states.push(JSON.parse(options.input).state);
        return '';
      }
      if (args[0] === 'release' && args[1] === 'view') throw new Error('fixture release absent');
      if (args[0] === 'release') return '';
      if (args[0] === 'api' && args[1].includes('/releases/tags/')) {
        const archive = join(publicationDirectory, 'local-evidence.tar.gz');
        return JSON.stringify({ draft: true, html_url: 'https://github.com/dgmolla/fitsy/releases/tag/fixture',
          assets: [{ name: 'local-evidence.tar.gz', state: 'uploaded', size: readFileSync(archive).length,
            digest: `sha256:${createHash('sha256').update(readFileSync(archive)).digest('hex')}` }] });
      }
      assert.fail(`Unexpected forge command: ${args.join(' ')}`);
    };
    const result = await publishProductFlow('7', { execute, evidenceDirectory, publicationDirectory,
      resolvePlan: () => ({ required: true, categories: ['onboarding'] }), sourceHash: () => 'fixture-input',
      validateEvidence: (actual, plan, sourceHash) => {
        assert.deepEqual(actual.flows, report.flows);
        assert.deepEqual(plan.categories, ['onboarding']);
        assert.equal(sourceHash, report.inputHash);
      } });
    assert.equal(result.status, 'pass');
    assert.deepEqual(states, ['pending', 'success']);
    const archive = join(publicationDirectory, 'local-evidence.tar.gz');
    const listed = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual([...listed].sort(), [...required].sort());
    for (const path of required) {
      const extracted = execFileSync('tar', ['-xOf', archive, path]);
      const expected = createHash('sha256').update(readFileSync(join(evidenceDirectory, path))).digest('hex');
      assert.equal(createHash('sha256').update(extracted).digest('hex'), expected, path);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
