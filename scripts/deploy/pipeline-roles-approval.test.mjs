import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

test('real Prisma deploy holds role dependencies, applies approved gaps once, and preserves failures', { timeout: 60_000 }, () => {
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
    const before = '20261028110000_before', after = '20261028160000_after';
    // SQLite tables stand in for PostgreSQL roles. Execute a real dependency,
    // so filtering only role creation fails the same migration CLI as Vercel.
    const roles = ['pipeline_writer', 'fitsy_app', 'fitsy_audit_readonly'];
    const dependencies = ['20261028130000_hex_jobs', '20261028140000_pipeline_ue_rate_limit',
      '20261028150000_pipeline_pdf_jobs', '20261101000000_future_role_dependency'];
    for (const [name, table] of [[before, 'before'], [migrationName, 'pipeline_writer'], [after, 'after'],
      ...dependencies.map((name, index) => [name, `dependent_${index}`])]) {
      mkdirSync(join(migrations, name));
      const index = dependencies.indexOf(name);
      const role = roles[Math.max(index, 0) % roles.length];
      const dependency = index >= 0
        ? `INSERT INTO "${index === 3 ? role.toUpperCase() : role}" (id) VALUES (${index + 1});\n` : '';
      const additionalRoles = name === migrationName
        ? roles.slice(1).map(role => `CREATE TABLE "${role}" (id INTEGER PRIMARY KEY);\n`).join('') : '';
      writeFileSync(join(migrations, name, 'migration.sql'), dependency +
        `CREATE TABLE "${table}" (id INTEGER PRIMARY KEY);\n` + additionalRoles + '-- pipeline_writer_metrics is not an approval-controlled role\n');
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
    const expected = { tables: ['_prisma_migrations', 'after', 'before', 'dependent_0', 'dependent_1', 'dependent_2', 'dependent_3', 'fitsy_app', 'fitsy_audit_readonly', 'pipeline_writer'],
      migrations: [before, migrationName, ...dependencies, after].sort() };
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
    // Reproduce #629's retained failed dependency using the old selection.
    // A corrected filter must still refuse P3009, preserving the raw ledger
    // for the separate, explicitly authorized production recovery operation.
    const legacy = join(directory, 'legacy');
    mkdirSync(legacy);
    cpSync(join(directory, 'prisma/schema.prisma'), join(legacy, 'schema.prisma'));
    cpSync(migrations, join(legacy, 'migrations'), {
      recursive: true, filter: source => source !== join(migrations, migrationName),
    });
    database = join(directory, 'failed-dependency.db');
    env.POSTGRES_PRISMA_URL = `file:${database}`;
    const failedDependency = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', join(legacy, 'schema.prisma')], {
      cwd: directory, env, encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(failedDependency.status, 1);
    assert.match(failedDependency.stderr + failedDependency.stdout, /no such table: pipeline_writer/);
    const ledger = () => {
      const result = spawnSync('python3', ['-c', `import json, sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    print(json.dumps(db.execute('SELECT id, migration_name, checksum, started_at, finished_at, rolled_back_at, logs, applied_steps_count FROM _prisma_migrations ORDER BY started_at, id').fetchall()))`, database],
      { encoding: 'utf8', timeout: 5_000 });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    const originalLedger = ledger();
    const blocked = deploy();
    assert.equal(blocked.status, 1, blocked.stdout + blocked.stderr);
    assert.match(blocked.stderr + blocked.stdout, /P3009/);
    assert.match(blocked.stderr, /migration-failure-audit.sql/);
    assert.match(blocked.stderr, /production-migration-recovery.yml/);
    assert.equal(ledger(), originalLedger);
    assert.deepEqual(applied(), { tables: ['_prisma_migrations', 'before'], migrations: [before] });
    // Only the separately authorized maintenance owner resolves production.
    // In this disposable fixture, exercise Prisma's real recovery command and
    // prove the ordinary filtered deploy resumes without granting role approval.
    const failedName = dependencies[0];
    const resolved = spawnSync('npx', ['prisma', 'migrate', 'resolve', '--rolled-back', failedName,
      '--schema', join(directory, 'prisma/schema.prisma')], {
      cwd: directory, env, encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(resolved.status, 0, resolved.stdout + resolved.stderr);
    const recoveredLedger = JSON.parse(ledger());
    const failedRow = recoveredLedger.find(row => row[1] === failedName);
    assert.ok(failedRow, 'the failed migration history must be retained');
    assert.ok(failedRow[5], 'Prisma must mark the failed attempt rolled back');
    const originalFailedRow = JSON.parse(originalLedger).find(row => row[1] === failedName);
    assert.deepEqual(failedRow, originalFailedRow.map((value, index) => index === 5 ? failedRow[5] : value));
    const resumed = deploy();
    assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
    assert.deepEqual(applied(), { tables: ['_prisma_migrations', 'after', 'before'], migrations: [before, after] });
    assert.deepEqual(JSON.parse(ledger()).find(row => row[0] === failedRow[0]), failedRow);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
