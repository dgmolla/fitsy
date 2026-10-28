#!/usr/bin/env node
// Only an owner-set production build value authorizes this exact role migration.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const migrationName = '20261028120000_pipeline_writer_roles';
export const migration = `prisma/migrations/${migrationName}/migration.sql`;
const root = fileURLToPath(new URL('../../', import.meta.url));
const migrationDigest = () => createHash('sha256').update(readFileSync(join(root, migration))).digest('hex');
export function assertPipelineRolesApproval(env = process.env) {
  const digest = migrationDigest();
  if (env.FITSY_PIPELINE_ROLES_APPROVED_SHA256 !== digest) {
    throw new Error('refusing: issue #588 requires Dawit approval of the exact database role migration before production application');
  }
  return digest;
}

// Prisma has no per-migration exclude option. Give it an isolated copy instead
// of changing tracked SQL or marking an unexecuted migration as applied.
export function deployProductionMigrations(env = process.env) {
  const approved = env.FITSY_PIPELINE_ROLES_APPROVED_SHA256 === migrationDigest();
  const directory = mkdtempSync(join(tmpdir(), 'fitsy-prod-migrations-'));
  const schema = join(directory, 'schema.prisma');
  try {
    cpSync(join(root, 'prisma/schema.prisma'), schema);
    const migrations = join(root, 'prisma/migrations');
    cpSync(migrations, join(directory, 'migrations'), {
      recursive: true,
      filter: source => approved || source !== join(migrations, migrationName),
    });
    // Recheck the actual staged bytes before allowing role SQL into Prisma.
    if (approved) {
      const stagedDigest = createHash('sha256')
        .update(readFileSync(join(directory, 'migrations', migrationName, 'migration.sql'))).digest('hex');
      if (env.FITSY_PIPELINE_ROLES_APPROVED_SHA256 !== stagedDigest) {
        throw new Error('refusing: staged database role migration does not match owner approval');
      }
    } else console.error(`production migrations: holding ${migrationName}; exact owner approval is unset or mismatched, proceeding with other migrations`);
    const args = ['prisma', 'migrate'];
    const options = { cwd: root, env, stdio: 'inherit' };
    // Pending migrations make status nonzero. Deploy remains authoritative and
    // refuses failed/unresolved migrations, as in the original build caller.
    spawnSync('npx', [...args, 'status', '--schema', schema], options);
    const result = spawnSync('npx', [...args, 'deploy', '--schema', schema], options);
    return result.status ?? 1;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--deploy') process.exitCode = deployProductionMigrations();
    else assertPipelineRolesApproval();
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
