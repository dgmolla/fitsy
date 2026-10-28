import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPipelineRolesApproval, migration, migrationName } from './pipeline-roles-approval.mjs';

test('approval binds to the migration bytes and cannot inherit general production write flags', () => {
  for (const env of [{}, { FITSY_ALLOW_PROD_WRITE: '1' }, { FITSY_PIPELINE_ROLES_APPROVED_SHA256: 'true' },
    { FITSY_PIPELINE_ROLES_APPROVED_SHA256: 'a'.repeat(64) }]) {
    assert.throws(() => assertPipelineRolesApproval(env), /Dawit approval/);
  }
  const digest = createHash('sha256').update(readFileSync(new URL('../../' + migration, import.meta.url))).digest('hex');
  assert.equal(assertPipelineRolesApproval({ FITSY_PIPELINE_ROLES_APPROVED_SHA256: digest }), digest);
});

test('real Prisma deploy holds unapproved SQL, applies an approved gap once, and preserves failure handling', { timeout: 60_000 }, () => {
  // File-backed SQLite exercises the installed migration engine and its ledger
  // without a server or production access. Marker SQL stands in for role DDL.
  const directory = mkdtempSync(join(tmpdir(), 'fitsy-role-deploy-'));
  try {
    const script = join(directory, 'scripts/deploy/pipeline-roles-approval.mjs');
    mkdirSync(join(directory, 'scripts/deploy'), { recursive: true });
    writeFileSync(script, readFileSync(new URL('./pipeline-roles-approval.mjs', import.meta.url)));
    symlinkSync(fileURLToPath(new URL('../../node_modules', import.meta.url)), join(directory, 'node_modules'), 'dir');
    const migrations = join(directory, 'prisma/migrations');
    mkdirSync(migrations, { recursive: true });
    writeFileSync(join(directory, 'prisma/schema.prisma'), `datasource db {
  provider = "sqlite"
  url = env("POSTGRES_PRISMA_URL")
}
`);
    writeFileSync(join(migrations, 'migration_lock.toml'), 'provider = "sqlite"\n');
    const before = '20261028110000_before', after = '20261028130000_after';
    for (const [name, table] of [[before, 'before'], [migrationName, 'role_probe'], [after, 'after']]) {
      mkdirSync(join(migrations, name));
      writeFileSync(join(migrations, name, 'migration.sql'), `CREATE TABLE "${table}" (id INTEGER PRIMARY KEY);\n`);
    }
    const sql = readFileSync(join(migrations, migrationName, 'migration.sql'));
    let database = join(directory, 'fixture.db');
    const env = { ...process.env, POSTGRES_PRISMA_URL: `file:${database}`, npm_config_cache: join(directory, 'npm-cache'),
      CHECKPOINT_DISABLE: '1' };
    delete env.FITSY_PIPELINE_ROLES_APPROVED_SHA256;
    const rejected = spawnSync(process.execPath, [script], { cwd: directory, env, encoding: 'utf8', timeout: 5_000 });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /requires Dawit approval/);
    const deploy = approval => spawnSync(process.execPath, [script, '--deploy'], {
      cwd: directory, encoding: 'utf8', timeout: 15_000,
      env: { ...env, ...(approval === undefined ? {} : { FITSY_PIPELINE_ROLES_APPROVED_SHA256: approval }) },
    });
    const applied = () => {
      const result = spawnSync('python3', ['-c', `import json, sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    print(json.dumps({
        'tables': [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")],
        'migrations': [row[0] for row in db.execute('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name')]
    }))`, database], { encoding: 'utf8', timeout: 5_000 });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    for (const approval of [undefined, 'incorrect']) {
      const result = deploy(approval);
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stderr, /holding 20261028120000_pipeline_writer_roles/);
      assert.deepEqual(applied(), { tables: ['_prisma_migrations', 'after', 'before'], migrations: [before, after] });
    }
    const approved = deploy(createHash('sha256').update(sql).digest('hex'));
    assert.equal(approved.status, 0, approved.stderr + approved.stdout);
    const expected = { tables: ['_prisma_migrations', 'after', 'before', 'role_probe'], migrations: [before, migrationName, after] };
    assert.deepEqual(applied(), expected);
    // An already-applied role change does not need repeated approval, nor does
    // holding it erase or forge the existing ledger entry.
    const subsequent = deploy();
    assert.equal(subsequent.status, 0, subsequent.stderr + subsequent.stdout);
    assert.deepEqual(applied(), expected);
    mkdirSync(join(migrations, '20261028140000_failed'));
    writeFileSync(join(migrations, '20261028140000_failed/migration.sql'), 'INVALID SQL;');
    assert.equal(deploy().status, 1);
    assert.deepEqual(applied(), expected);
    assert.deepEqual(readFileSync(join(migrations, migrationName, 'migration.sql')), sql);
    // Excluding role SQL must not hide a previously failed role migration.
    rmSync(join(migrations, '20261028140000_failed'), { recursive: true });
    const failedSql = Buffer.concat([sql, Buffer.from('INVALID SQL;')]);
    writeFileSync(join(migrations, migrationName, 'migration.sql'), failedSql);
    database = join(directory, 'failed-role.db');
    env.POSTGRES_PRISMA_URL = `file:${database}`;
    const failedRole = deploy(createHash('sha256').update(failedSql).digest('hex'));
    assert.equal(failedRole.status, 1);
    const heldFailure = deploy();
    assert.equal(heldFailure.status, 1, heldFailure.stdout + heldFailure.stderr);
    assert.deepEqual(applied().migrations, [before]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
