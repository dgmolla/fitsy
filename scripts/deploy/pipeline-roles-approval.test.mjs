import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assertPipelineRolesApproval, migration } from './pipeline-roles-approval.mjs';

test('approval binds to the migration bytes and cannot inherit general production write flags', () => {
  for (const env of [{}, { FITSY_ALLOW_PROD_WRITE: '1' }, { FITSY_PIPELINE_ROLES_APPROVED_SHA256: 'true' },
    { FITSY_PIPELINE_ROLES_APPROVED_SHA256: 'a'.repeat(64) }]) {
    assert.throws(() => assertPipelineRolesApproval(env), /Dawit approval/);
  }
  const digest = createHash('sha256').update(readFileSync(new URL('../../' + migration, import.meta.url))).digest('hex');
  assert.equal(assertPipelineRolesApproval({ FITSY_PIPELINE_ROLES_APPROVED_SHA256: digest }), digest);
});
