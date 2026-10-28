#!/usr/bin/env node
// Only an owner-set production build value authorizes this exact role migration.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const migration = 'prisma/migrations/20261028120000_pipeline_writer_roles/migration.sql';
export function assertPipelineRolesApproval(env = process.env) {
  const digest = createHash('sha256').update(readFileSync(new URL('../../' + migration, import.meta.url))).digest('hex');
  if (env.FITSY_PIPELINE_ROLES_APPROVED_SHA256 !== digest) {
    throw new Error('refusing: issue #588 requires Dawit approval of the exact database role migration before production deploy');
  }
  return digest;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { assertPipelineRolesApproval(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
