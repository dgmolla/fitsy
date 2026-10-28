import { assertDatabaseRole, assertPipelineDatabase, assertRuntimeDatabase, DEV_PROJECT_REF, PROD_PROJECT_REF } from './db-target-guard';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const url = (role: string, ref = DEV_PROJECT_REF) => `postgresql://${role}.${ref}:synthetic@aws-0-us-west-1.pooler.supabase.com:5432/postgres`;

test('runtime, pipeline and audit credentials cannot substitute for one another', async () => {
  for (const role of ['postgres', 'fitsy_app', 'pipeline_writer', 'fitsy_audit_readonly']) {
    const value = url(role);
    for (const required of ['fitsy_app', 'pipeline_writer', 'fitsy_audit_readonly'] as const) {
      if (role === required) expect(assertDatabaseRole(value, required)).toBe(value);
      else expect(() => assertDatabaseRole(value, required)).toThrow(/administrator credentials are migration-only/);
    }
    if (role === 'fitsy_app') expect(assertRuntimeDatabase(value, `https://${DEV_PROJECT_REF}.supabase.co`)).toBe(value);
    else expect(() => assertRuntimeDatabase(value, `https://${DEV_PROJECT_REF}.supabase.co`)).toThrow(/must use fitsy_app/);
    if (role === 'pipeline_writer') expect(await assertPipelineDatabase(value)).toBe(value);
    else await expect(assertPipelineDatabase(value)).rejects.toThrow(/must use pipeline_writer/);
  }
});

test('direct, qualified and options routes retain project and role checks', async () => {
  for (const value of [url('pipeline_writer'), url('pipeline_writer').replace('.' + DEV_PROJECT_REF, '%2E' + DEV_PROJECT_REF),
    `postgresql://pipeline_writer:synthetic@db.${DEV_PROJECT_REF}.supabase.co/postgres`,
    `postgresql://pipeline_writer:synthetic@aws-0-us-west-1.pooler.supabase.com:5432/postgres?options=reference%3D${DEV_PROJECT_REF}`]) {
    expect(await assertPipelineDatabase(value)).toBe(value);
  }
  await expect(assertPipelineDatabase(url('pipeline_writer', PROD_PROJECT_REF), {
    env: { GITHUB_ACTIONS: 'true', FITSY_ALLOW_PROD_WRITE: '1' }, args: ['--prod'],
  })).rejects.toThrow(/signed.*identity/);
  await expect(assertPipelineDatabase(url('pipeline_writer') + `?options=reference%3D${PROD_PROJECT_REF}`)).rejects.toThrow(/conflicting/);
});

test('missing pipeline credentials cannot fall back to administrator or runtime secrets', async () => {
  const before = process.env['PIPELINE_DATABASE_URL'];
  delete process.env['PIPELINE_DATABASE_URL'];
  try { await expect(assertPipelineDatabase()).rejects.toThrow(/database URL is required/); }
  finally { if (before !== undefined) process.env['PIPELINE_DATABASE_URL'] = before; }
});

test('actual pipeline CLI rejects the administrator before driver construction', () => {
  const root = resolve(__dirname, '../..');
  const directory = mkdtempSync(join(tmpdir(), 'fitsy-pipeline-role-'));
  const log = join(directory, 'connections');
  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/backfill-chain-flag.ts', '--dry-run'], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, PIPELINE_DATABASE_URL: url('postgres'),
        NODE_OPTIONS: `--require=${join(root, 'scripts/test-fixtures/database-client-recorder.cjs')}`,
        FITSY_TEST_DB_CLIENT_LOG: log },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must use pipeline_writer');
    expect(result.stderr).not.toContain('synthetic@');
    expect(existsSync(log)).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
