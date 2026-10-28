import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mediaIntegrationRequired, validateMediaReceipt, writeMediaReceipt } from './media-integration.mjs';

test('media lane selects changed native controls without selecting unrelated application paths', () => {
  assert.equal(mediaIntegrationRequired(['apps/api/app/api/health/route.ts']), false);
  for (const path of ['scripts/sim/runner-controls.mjs', 'scripts/sim/xctest-attachments.test.mjs',
    'scripts/verify/product-flow.mjs', 'scripts/verify/test.sh', 'scripts/verify/registry.yml'])
    assert.equal(mediaIntegrationRequired([path]), true, path);
});

test('receipt binds the completed media lane to source and test contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-media-receipt-')), file = join(dir, 'receipt.json');
  try {
    assert.deepEqual(validateMediaReceipt(['apps/api/health.ts'], 'head', 'hash', file), { required: false });
    assert.throws(() => validateMediaReceipt(['scripts/sim/runner-controls.mjs'], 'head', 'hash', file), /Missing local media integration receipt/);
    const receipt = writeMediaReceipt(file, 'head', 'hash');
    assert.equal(receipt.command.includes('xctest-attachments.test.ts'), true);
    assert.equal(validateMediaReceipt(['scripts/sim/runner-controls.mjs'], 'head', 'hash', file).required, true);
    assert.throws(() => validateMediaReceipt(['scripts/sim/runner-controls.mjs'], 'changed', 'hash', file), /Stale or failed/);
    assert.throws(() => validateMediaReceipt(['scripts/sim/runner-controls.mjs'], 'head', 'changed', file), /Stale or failed/);
    receipt.finished_at = new Date(Date.now() - 25 * 3600_000).toISOString();
    writeFileSync(file, JSON.stringify(receipt));
    assert.throws(() => validateMediaReceipt(['scripts/sim/runner-controls.mjs'], 'head', 'hash', file), /Stale or failed/);
    receipt.finished_at = new Date().toISOString(); receipt.result = 'fail';
    writeFileSync(file, JSON.stringify(receipt));
    assert.throws(() => validateMediaReceipt(['scripts/sim/runner-controls.mjs'], 'head', 'hash', file), /Stale or failed/);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).result, 'fail');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('canonical media caller fails unavailable process inspection or decoders before starting fixtures', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-media-preflight-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GIT_|FITSY_|CI$)/.test(key)));
  const git = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' });
  try {
    // Applicability imports product-flow and its shared impact planner before the preflight.
    for (const name of ['media-integration.sh', 'media-integration.mjs', 'product-flow.mjs', 'impact-plan.mjs']) {
      const path = join(dir, 'scripts/verify', name); mkdirSync(dirname(path), { recursive: true });
      copyFileSync(join(root, 'scripts/verify', name), path);
    }
    mkdirSync(join(dir, 'scripts/sim'));
    copyFileSync(join(root, 'scripts/sim/backend-identity.mjs'), join(dir, 'scripts/sim/backend-identity.mjs'));
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
    writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
    git('init', '-q'); git('config', 'user.name', 'Media fixture'); git('config', 'user.email', 'media@example.test');
    git('config', 'core.hooksPath', '/dev/null'); git('add', '.'); git('commit', '-qm', 'baseline');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    writeFileSync(join(dir, 'scripts/sim/changed.mjs'), 'export {};\n');
    const bin = join(dir, 'bin'); mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, 'node'));
    writeFileSync(join(bin, 'npm'), '#!/bin/sh\ntouch fixtures-started\nexit 99\n', { mode: 0o755 });
    for (const entry of [
      { ps: 126, ffprobe: 0, ffmpeg: 0, summary: /process ownership inspection/ },
      { ps: 0, ffprobe: 1, ffmpeg: 0, summary: /ffprobe/ },
      { ps: 0, ffprobe: 0, ffmpeg: 1, summary: /ffmpeg/ },
    ]) {
      for (const name of ['ps', 'ffprobe', 'ffmpeg']) {
        writeFileSync(join(bin, name), `#!/bin/sh\nexit ${entry[name]}\n`); chmodSync(join(bin, name), 0o755);
      }
      const result = spawnSync('/bin/bash', ['scripts/verify/media-integration.sh'], {
        cwd: dir, env: { ...env, PATH: `${bin}:/usr/bin:/bin`, FITSY_PRODUCT_ROOT: dir }, encoding: 'utf8',
      });
      assert.equal(result.status, 1, result.stderr);
      assert.match(JSON.parse(result.stdout).summary, entry.summary);
      assert.equal(existsSync(join(dir, 'fixtures-started')), false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
