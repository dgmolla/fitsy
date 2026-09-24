import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { publicationArtifacts } from './publication-artifacts.mjs';

test('the publisher archive retains the report, command, screen, video and exploration proof', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-publication-'));
  try {
    const report = { flows: [{ commands: 'welcome/commands.json', screenshot: 'welcome/outcome.png', video: 'welcome/flow-untrimmed.mp4' }],
      exploration: [{ category: 'onboarding', trace: 'mcp/onboarding.jsonl' }] };
    const required = [
      'report.json',
      'welcome/commands.json',
      'welcome/outcome.png',
      'welcome/flow-untrimmed.mp4',
      'mcp/onboarding.jsonl',
    ];
    for (const path of required) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), path);
    }
    const artifacts = publicationArtifacts(report, ['onboarding']);
    const archive = join(dir, 'proof.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', dir, ...artifacts]);
    const listed = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual([...listed].sort(), [...required].sort());
    for (const path of required) {
      const extracted = execFileSync('tar', ['-xOf', archive, path]);
      const expected = createHash('sha256').update(path).digest('hex');
      assert.equal(createHash('sha256').update(extracted).digest('hex'), expected, path);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
