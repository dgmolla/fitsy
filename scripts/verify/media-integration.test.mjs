import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
