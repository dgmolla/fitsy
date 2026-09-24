import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { publicationArtifacts } from './publication-artifacts.mjs';

test('the publisher archive retains complete flow video beside verified command and screen proof', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-publication-'));
  try {
    const report = { flows: [{ commands: 'welcome/commands.json', screenshot: 'welcome/outcome.png', video: 'welcome/flow-untrimmed.mp4' }],
      exploration: [{ category: 'onboarding', trace: 'mcp/onboarding.jsonl' }] };
    const artifacts = publicationArtifacts(report, ['onboarding']);
    for (const path of artifacts) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), path);
    }
    const archive = join(dir, 'proof.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', dir, ...artifacts]);
    const listed = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(new Set(listed), new Set(artifacts));
    assert.ok(listed.includes('welcome/flow-untrimmed.mp4'));
    for (const path of artifacts) {
      const extracted = execFileSync('tar', ['-xOf', archive, path]);
      const expected = createHash('sha256').update(path).digest('hex');
      assert.equal(createHash('sha256').update(extracted).digest('hex'), expected, path);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
