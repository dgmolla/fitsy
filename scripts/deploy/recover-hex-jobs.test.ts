import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertFailedAttempt, assertRecoveryResult, failedAttempt, recoveryMode, type Audit } from './recover-hex-jobs';

const { load }: { load(input: string): unknown } = require('js-yaml');

function snapshot(): Audit {
  return {
    database: 'postgres', migration_history: [{ ...failedAttempt,
      started_at: '2026-10-28T18:56:48.891157+00:00', finished_at: null, rolled_back_at: null,
      applied_steps_count: 0, unresolved: true, failure_logs_present: false, missing_pipeline_writer: null,
    }],
    relations: ['hex_job_events', 'hex_jobs'].map(name => ({ name, present: false })),
    roles: [{ name: 'pipeline_writer', present: false }],
    runtime_schema: { migration_name: '20261029010000_widget_search_tokens',
      migration_history: [], relation_present: false },
  };
}

test('the exact inspected failure is eligible for separately approved recovery', () => {
  expect(() => assertFailedAttempt(snapshot())).not.toThrow();
});

test.each([
  { id: 'different-attempt' }, { checksum: 'a'.repeat(64) }, { migration_name: 'different-migration' },
  { started_at: '2026-10-28T18:56:49+00:00' }, { finished_at: '2026-10-29' },
  { rolled_back_at: '2026-10-29' }, { unresolved: false }, { applied_steps_count: 1 },
  { failure_logs_present: true }, { missing_pipeline_writer: false },
])('changed attempt refuses recovery: %j', change => {
  const audit = snapshot(); Object.assign(audit.migration_history[0]!, change);
  expect(() => assertFailedAttempt(audit)).toThrow(/audit differs/);
});

test('unknown failures, missing evidence and any partial relation refuse recovery', () => {
  const extra = snapshot(); extra.migration_history.push({ ...extra.migration_history[0]!, id: 'other' });
  const partial = snapshot(); partial.relations[0]!.present = true;
  const missing = snapshot(); missing.relations.pop();
  for (const audit of [extra, partial, missing,
    { ...snapshot(), migration_history: [] }, { ...snapshot(), relations: [] }]) {
    expect(() => assertFailedAttempt(audit)).toThrow(/audit differs/);
  }
});

function recoveredSnapshot(): Audit {
  const audit = snapshot();
  Object.assign(audit.migration_history[0]!, { rolled_back_at: '2026-10-29T09:00:00+00:00', unresolved: false });
  return audit;
}

test('rollback comparison accepts independently parsed audit results without mutating the original evidence', () => {
  const before: Audit = JSON.parse(JSON.stringify(snapshot()));
  const after: Audit = JSON.parse(JSON.stringify(recoveredSnapshot()));
  Object.assign(before, { inspected_at: '2026-10-29T08:00:00+00:00' });
  Object.assign(after, { inspected_at: '2026-10-29T09:00:00+00:00' });
  const evidence = JSON.stringify({ before, after });
  expect(() => assertRecoveryResult(before, after)).not.toThrow();
  expect(JSON.stringify({ before, after })).toBe(evidence);
});

test.each([
  { rolled_back_at: null }, { unresolved: true },
])('rollback comparison requires Prisma to resolve the attempt: %j', change => {
  const after = recoveredSnapshot(); Object.assign(after.migration_history[0]!, change);
  expect(() => assertRecoveryResult(snapshot(), after)).toThrow(/did not mark the expected attempt/);
});

test.each([
  ['database', (audit: Audit) => { audit.database = 'other'; }],
  ['checksum', (audit: Audit) => { audit.migration_history[0]!.checksum = 'b'.repeat(64); }],
  ['ledger steps', (audit: Audit) => { audit.migration_history[0]!.applied_steps_count = 1; }],
  ['failure evidence', (audit: Audit) => { audit.migration_history[0]!.failure_logs_present = true; }],
  ['extra attempt', (audit: Audit) => { audit.migration_history.push({ ...audit.migration_history[0]!, id: 'other' }); }],
  ['relation', (audit: Audit) => { audit.relations[0]!.present = true; }],
  ['relation metadata', (audit: Audit) => { Object.assign(audit.relations[0]!, { rls: true, acl: '{unexpected}' }); }],
  ['role', (audit: Audit) => { audit.roles[0]!.present = true; }],
  ['runtime migration', (audit: Audit) => { audit.runtime_schema.migration_history.push({
    id: 'other', checksum: 'a'.repeat(64), finished_at: '2026-10-29', rolled_back_at: null }); }],
  ['runtime audit', (audit: Audit) => { Object.assign(audit, { runtime_schema: undefined }); }],
  ['additional audit evidence', (audit: Audit) => { Object.assign(audit, { additional_evidence: 'changed' }); }],
])('rollback comparison refuses unexpected changes to %s', (_name, change) => {
  const after = recoveredSnapshot(); change(after);
  expect(() => assertRecoveryResult(snapshot(), after)).toThrow(/state changed beyond the expected rollback marker/);
});

test('rollback comparison preserves the runtime schema prerequisite observed by the audit', () => {
  const runtime = { migration_name: '20261029010000_widget_search_tokens',
    migration_history: [], relation_present: false };
  const before = Object.assign(snapshot(), { runtime_schema: runtime });
  const after = Object.assign(recoveredSnapshot(), { runtime_schema: { ...runtime, relation_present: true } });
  expect(() => assertRecoveryResult(before, after)).toThrow(/state changed beyond the expected rollback marker/);
});

test('command arguments require explicit production intent and one mode', () => {
  expect(recoveryMode(['--prod', '--audit'])).toBe('audit');
  expect(recoveryMode(['--prod', '--resolve'])).toBe('resolve');
  for (const args of [[], ['--resolve'], ['--prod', '--apply'], ['--prod', '--prod'],
    ['--prod', '--audit', '--resolve'], ['--prod', '--resolve', '--schema=other']]) {
    expect(() => recoveryMode(args)).toThrow(/Recovery refused/);
  }
});

test('real signatures and the production guard reject unauthorized recovery', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap',
    join(__dirname, 'recover-hex-jobs.identity.integration.ts')], { encoding: 'utf8', timeout: 30_000 });
  expect({ status: result.status, error: result.error, stdout: result.stdout, stderr: result.stderr }).toEqual({
    status: 0, error: undefined, stdout: expect.stringContaining('# pass 4'), stderr: '',
  });
}, 35_000);

test('manual workflow defaults to audit and retains the protected maintenance environment and release concurrency', () => {
  const workflow = load(readFileSync(join(__dirname, '../../.github/workflows/production-migration-recovery.yml'), 'utf8')) as {
    on: Record<string, { inputs: { mode: { default: string } } }>;
    concurrency: unknown; permissions: unknown;
    jobs: { recovery: { if: string; environment: string; permissions: unknown;
      steps: Array<{ run?: string; env?: Record<string, string>; with?: Record<string, unknown> }> } };
  };
  expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
  expect(workflow.on.workflow_dispatch!.inputs.mode.default).toBe('audit');
  expect(workflow.concurrency).toEqual({ group: 'deploy-production', 'cancel-in-progress': false });
  expect(workflow.permissions).toEqual({ contents: 'read' });
  const job = workflow.jobs.recovery;
  expect(job.if).toBe("github.ref == 'refs/heads/main'");
  expect(job.environment).toBe('production-release');
  expect(job.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
  expect(job.steps[0]!.with).toEqual({ 'persist-credentials': false });
  const step = job.steps.find(step => step.env?.RECOVERY_MODE)!;
  expect(step.env).toEqual({ POSTGRES_URL_NON_POOLING: '${{ secrets.PROD_DATABASE_URL }}', RECOVERY_MODE: '${{ inputs.mode }}' });
  const directory = mkdtempSync(join(tmpdir(), 'fitsy-recovery-workflow-'));
  try {
    const calls = join(directory, 'calls.jsonl');
    const binary = join(directory, 'node');
    writeFileSync(binary, `#!${process.execPath}\nrequire('fs').appendFileSync(process.env.CALLS, JSON.stringify({ args: process.argv.slice(2), write: process.env.FITSY_ALLOW_PROD_WRITE || '' }) + '\\n');\n`, { mode: 0o700 });
    for (const mode of ['audit', 'resolve', 'unexpected', '$(exit 0)']) {
      writeFileSync(calls, '');
      const result = spawnSync('bash', ['-euo', 'pipefail', '-c', step.run!], {
        env: { PATH: directory + ':' + process.env.PATH, RECOVERY_MODE: mode, CALLS: calls }, encoding: 'utf8',
      });
      const records = readFileSync(calls, 'utf8').trim();
      expect(result.status).toBe(['audit', 'resolve'].includes(mode) ? 0 : 1);
      if (records) expect(JSON.parse(records)).toEqual({
        args: ['--import', 'tsx', 'scripts/deploy/recover-hex-jobs.ts', '--prod', '--' + mode],
        write: mode === 'resolve' ? '1' : '',
      });
      else expect(['audit', 'resolve']).not.toContain(mode);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
