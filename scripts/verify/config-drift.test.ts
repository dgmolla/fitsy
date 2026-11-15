import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root = resolve(__dirname, '../..');
const DEV_URL = 'https://kegycybiruksmrzvniha.supabase.co';
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fitsy-config-drift-'));
  mkdirSync(join(directory, 'bin'));
  for (const name of ['dirname', 'cat', 'jq']) {
    symlinkSync(execFileSync('which', [name], { encoding: 'utf8' }).trim(), join(directory, 'bin', name));
  }
});
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
function run(env: Record<string, string | undefined>, settingsResponse?: string, curlExit = 0) {
  writeFileSync(join(directory, 'bin/curl'), `#!/bin/sh
${curlExit !== 0 ? `exit ${curlExit}` : `cat <<'EOF'\n${settingsResponse ?? ''}\nEOF`}
`, { mode: 0o755 });
  return spawnSync('/bin/bash', [join(root, 'scripts/verify/config-drift.sh')],
    { env: { PATH: join(directory, 'bin'), LANG: process.env['LANG'], LC_ALL: process.env['LC_ALL'], ...env }, encoding: 'utf8' });
}
const settings = (anonymous: boolean) => JSON.stringify({ external: { anonymous_users: anonymous, apple: false }, disable_signup: false });

test('passes when live anonymous sign-in matches the checked-in expected state (ON)', () => {
  const result = run({ SUPABASE_URL: DEV_URL, SUPABASE_ANON_KEY: 'anon-fixture' }, settings(true));
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ name: 'config-drift', status: 'pass', summary: expect.stringContaining('anonymous sign-in: ON') });
});

test('fails with a clear expected-vs-actual message when anonymous sign-in drifts OFF', () => {
  const result = run({ SUPABASE_URL: DEV_URL, SUPABASE_ANON_KEY: 'anon-fixture' }, settings(false));
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fail', summary: 'anonymous sign-in: expected ON, actual OFF' });
});

test('is skipped locally (not a hard failure) when SUPABASE_URL/SUPABASE_ANON_KEY are unset', () => {
  const result = run({ SUPABASE_URL: undefined, SUPABASE_ANON_KEY: undefined });
  expect(result.status).toBe(2);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'skipped' });
});

test('fails (does not skip) when unset in CI or scheduled context', () => {
  for (const context of [{ CI: 'true' }, { FITSY_RUNS: 'scheduled' }]) {
    const result = run({ SUPABASE_URL: undefined, SUPABASE_ANON_KEY: undefined, ...context });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fail' });
  }
});

test('refuses to run against a non-DEV Supabase project', () => {
  const result = run({ SUPABASE_URL: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co', SUPABASE_ANON_KEY: 'anon-fixture' }, settings(true));
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fail', summary: expect.stringContaining('not the DEV project') });
});

test('reports a read failure distinctly from a drift mismatch', () => {
  const result = run({ SUPABASE_URL: DEV_URL, SUPABASE_ANON_KEY: 'anon-fixture' }, undefined, 7);
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fail', summary: expect.stringContaining('could not read Supabase auth settings') });
});

test('reports a malformed response distinctly, never crashing on unexpected JSON shape', () => {
  const result = run({ SUPABASE_URL: DEV_URL, SUPABASE_ANON_KEY: 'anon-fixture' }, JSON.stringify({ unexpected: true }));
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fail', summary: expect.stringContaining('did not include external.anonymous_users') });
});

test('never prints the anon key value', () => {
  const result = run({ SUPABASE_URL: DEV_URL, SUPABASE_ANON_KEY: 'super-secret-anon-fixture-value' }, settings(true));
  expect(result.stdout + result.stderr).not.toContain('super-secret-anon-fixture-value');
});
