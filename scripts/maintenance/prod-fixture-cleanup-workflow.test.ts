import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertDatabaseWriteAllowed, PROD_PROJECT_REF } from '../lib/db-target-guard';
import { parseOptions, tables } from './cleanup-test-fixtures';

const yaml = require('js-yaml') as { load(value: string): unknown };
type Step = { uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> };
const root = resolve(__dirname, '../..');
const workflow = yaml.load(readFileSync(join(root, '.github/workflows/prod-fixture-cleanup.yml'), 'utf8')) as {
  on: { workflow_dispatch: { inputs: Record<string, unknown> } };
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: { cleanup: { if: string; environment: string; steps: Step[] } };
};
const job = workflow.jobs.cleanup;
const cleanup = job.steps.find(step => step.run?.includes('scripts/maintenance/sanitize-cleanup-db-url.ts'))!;
const counts = Object.fromEntries(tables.map(table => [table, 0]));
const expected = JSON.stringify(counts);
// Synthetic loopback route only; the external command recorder never connects.
const url = `postgresql://postgres.${PROD_PROJECT_REF}:synthetic@localhost:1/postgres`;
let directory: string;
type Call = { args: string[]; allowProd?: string; actions?: string; databaseUrl: string };

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fitsy-cleanup-workflow-'));
  symlinkSync(process.execPath, join(directory, 'node'));
  // Substitute only the external npx transport to inspect the actual workflow shell's argv/environment.
  writeFileSync(join(directory, 'npx'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify({ args,
  allowProd: process.env.FITSY_ALLOW_PROD_WRITE, actions: process.env.GITHUB_ACTIONS,
  databaseUrl: process.env.POSTGRES_PRISMA_URL }) + '\\n');
process.stdout.write('cleanup invoked\\n');
require(${JSON.stringify(require.resolve('tsx/cjs'))});
const { databaseTarget } = require(${JSON.stringify(join(root, 'scripts/lib/db-target-guard.ts'))});
try { databaseTarget(process.env.POSTGRES_PRISMA_URL); }
catch (error) { console.error(error.message); process.exit(1); }
if (args.includes('--dry-run') && process.env.FAIL_DRY_RUN === '1') process.exit(9);
`, { mode: 0o755 });
});
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

function run(mode: string, expectedInput = '', failDryRun = false, databaseUrl = url) {
  const log = join(directory, 'calls.jsonl');
  const githubEnv = join(directory, 'github-env');
  const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', cleanup.run!], {
    cwd: root, encoding: 'utf8', env: {
      PATH: directory, CALLS: log, GITHUB_ACTIONS: 'true', POSTGRES_PRISMA_URL: databaseUrl,
      CLEANUP_MODE: mode, CLEANUP_EXPECT: expectedInput, FAIL_DRY_RUN: failDryRun ? '1' : '0',
      GITHUB_ENV: githubEnv,
    },
  });
  const calls: Call[] = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  expectNoUrl(result.stdout + result.stderr);
  expect(existsSync(githubEnv)).toBe(false);
  return { ...result, calls };
}
function expectNoUrl(output: string) {
  // The sole permitted URL emission registers a mask before any cleanup use.
  output = output.split('\n').filter(line => !line.startsWith('::add-mask::')).join('\n');
  expect(output).not.toContain(url);
  expect(output).not.toContain('synthetic');
}

test('only manual main-branch runs can access the protected production credential', () => {
  expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
  expect(workflow.on.workflow_dispatch.inputs).toMatchObject({
    mode: { type: 'choice', options: ['dry-run', 'apply'], default: 'dry-run' },
    expect: { type: 'string', required: false },
  });
  expect(Object.keys(workflow.jobs)).toEqual(['cleanup']);
  expect(job.if).toBe("github.ref == 'refs/heads/main'");
  expect(job.environment).toBe('production-release');
  expect(workflow.permissions).toEqual({ contents: 'read' });
  expect(workflow.concurrency).toEqual({ group: 'prod-fixture-cleanup', 'cancel-in-progress': false });
  expect(cleanup.env).toEqual({
    POSTGRES_PRISMA_URL: '${{ secrets.PROD_DATABASE_URL }}',
    CLEANUP_MODE: '${{ inputs.mode }}', CLEANUP_EXPECT: '${{ inputs.expect }}',
  });
  expect(cleanup.run).not.toContain('${{');
  const installIndex = job.steps.findIndex(step => step.run === 'npm ci');
  expect(installIndex).toBeGreaterThanOrEqual(0);
  expect(installIndex).toBeLessThan(job.steps.indexOf(cleanup));
});

test('dry-run mode only inventories and never enables production writes', () => {
  const result = run('dry-run');
  expect(result.status).toBe(0);
  expect(result.calls).toEqual([{ args: ['tsx', 'scripts/maintenance/cleanup-test-fixtures.ts', '--dry-run', '--prod'], actions: 'true', databaseUrl: url }]);
});

test('apply inventories first, preserves the count manifest and satisfies the real production guard', () => {
  const result = run('apply', expected);
  expect(result.status).toBe(0);
  expect(result.calls).toEqual([
    { args: ['tsx', 'scripts/maintenance/cleanup-test-fixtures.ts', '--dry-run', '--prod'], actions: 'true', databaseUrl: url },
    { args: ['tsx', 'scripts/maintenance/cleanup-test-fixtures.ts', '--apply', '--prod', '--expect=' + expected], actions: 'true', allowProd: '1', databaseUrl: url },
  ]);
  const apply = result.calls[1]!;
  expect(parseOptions(apply.args.slice(2))).toMatchObject({ apply: true, prod: true, expect: counts });
  expect(assertDatabaseWriteAllowed(url, { args: apply.args, env: {
    GITHUB_ACTIONS: apply.actions, FITSY_ALLOW_PROD_WRITE: apply.allowProd,
  } })).toBe(url);
});

test('a failed dry run stops apply in the actual workflow shell', () => {
  const result = run('apply', expected, true);
  expect(result.status).toBe(9);
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0]!.args).toContain('--dry-run');
  expect(result.calls[0]!.allowProd).toBeUndefined();
});

test('unsupported and duplicate query parameters are sanitized before the real guard sees the cleanup URL', () => {
  const result = run('apply', expected, false, url + '?sslmode=require&unknown=synthetic-secret&sslmode=disable&options=-csearch_path%3Dpublic');
  expect(result.status).toBe(0);
  expect(result.calls.map(call => call.databaseUrl)).toEqual([url + '?sslmode=require', url + '?sslmode=require']);
  const mask = '::add-mask::' + url + '?sslmode=require';
  const dropped = 'Dropped database URL query keys: ["unknown","sslmode","options"]';
  expect(result.stdout.trim().split('\n')).toEqual([mask, dropped, 'cleanup invoked', mask, dropped, 'cleanup invoked']);
  expect(result.stdout).not.toContain('synthetic-secret');
});

test('the mask escapes percent signs before any consumer and key names cannot inject workflow commands', () => {
  const key = 'unexpected\n::error::injected';
  const input = url.replace('synthetic', 'synthetic%25password') + '?' + new URLSearchParams([
    ['options', `reference=${PROD_PROJECT_REF}`], [key, 'synthetic-secret'],
  ]);
  const result = run('dry-run', '', false, input);
  expect(result.status).toBe(0);
  expect(result.stdout.trim().split('\n')).toEqual([
    '::add-mask::' + result.calls[0]!.databaseUrl.replaceAll('%', '%25'),
    'Dropped database URL query keys: ' + JSON.stringify([key]), 'cleanup invoked',
  ]);
  expect(result.stdout).not.toContain('synthetic-secret');
});

test('invalid URLs fail without exposing parser input or invoking cleanup', () => {
  const result = run('apply', expected, false, 'invalid-synthetic-secret');
  expect(result.status).toBe(1);
  expect(result.calls).toEqual([]);
  expect(result.stderr).toBe('::error::Unable to run cleanup with a sanitized database URL.\n');
});

test.each(['#fragment', '?options=reference%3Dabcdefghijklmnopqrst'])(
  'remaining guard refusals still stop apply after sanitization: %s', suffix => {
    const result = run('apply', expected, false, url + suffix);
    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(1);
    expect(result.stderr).toContain('DB_WRITE_REFUSED');
  },
);

test.each([['apply', ''], ['unexpected', expected]])('invalid request %s refuses before invoking cleanup', (mode, expectedInput) => {
  const result = run(mode, expectedInput);
  expect(result.status).toBe(1);
  expect(result.calls).toEqual([]);
});

test('shell metacharacters in expect remain one literal argument and never execute', () => {
  const marker = join(directory, 'injected');
  const input = `${expected}'; touch "${marker}"; #\n$(touch "${marker}")\n\`touch "${marker}"\``;
  const result = run('apply', input);
  expect(result.status).toBe(0);
  expect(result.calls[1]!.args.at(-1)).toBe('--expect=' + input);
  expect(() => parseOptions(result.calls[1]!.args.slice(2))).toThrow(/JSON/);
  expect(existsSync(marker)).toBe(false);
});
