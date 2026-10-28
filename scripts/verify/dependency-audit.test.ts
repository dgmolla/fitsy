import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const npm = spawnSync('which', ['npm'], { encoding: 'utf8' }).stdout.trim();
let directory: string;

beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'fitsy-dependency-audit-')));
  mkdirSync(join(directory, 'scripts/verify'), { recursive: true });
  mkdirSync(join(directory, 'bin'));
  copyFileSync(join(root, 'scripts/verify/dependency-audit.mjs'), join(directory, 'scripts/verify/dependency-audit.mjs'));
  writeFileSync(join(directory, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n');
  const script = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts['verify:dependencies'];
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, scripts: { 'verify:dependencies': script } }));
  // Only npm's external advisory transport is replaced. Run the real public
  // entrypoint and inspect its retained files and exit status.
  writeFileSync(join(directory, 'bin/npm'), `#!${process.execPath}
const fs = require('node:fs');
if (process.argv.includes('--version')) { process.stdout.write('11.4.2\\n'); process.exit(0); }
const scope = process.argv.includes('--omit=dev') ? 'production' : 'full';
fs.appendFileSync('calls.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');
const response = JSON.parse(fs.readFileSync(scope + '-fixture.json', 'utf8'));
if (response.changeLock) fs.appendFileSync('package-lock.json', ' ');
process.stdout.write(response.stdout);
process.stderr.write(response.stderr ?? '');
process.exit(response.exitCode);
`);
  chmodSync(join(directory, 'bin/npm'), 0o700);
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function response(scope: string, stdout: string, exitCode = 0, extra = {}) {
  writeFileSync(join(directory, `${scope}-fixture.json`), JSON.stringify({ stdout, exitCode, ...extra }));
}

function report(findings = false) {
  return JSON.stringify({ auditReportVersion: 2,
    vulnerabilities: findings ? { fixture: { name: 'fixture', severity: 'high', via: [{ title: 'fixture advisory' }], nodes: ['node_modules/fixture'] } } : {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: findings ? 1 : 0, critical: 0, total: findings ? 1 : 0 } } });
}

function audit() {
  const result = spawnSync(npm, ['run', '--silent', 'verify:dependencies'], {
    cwd: directory, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}` },
  });
  expect(result.error).toBeUndefined();
  return { result, receipt: JSON.parse(result.stdout) };
}

test('captures both complete live audit scopes and exact lockfile without overwriting prior runs', () => {
  response('full', report());
  response('production', report());
  const first = audit();
  const second = audit();
  expect(first.result.status).toBe(0);
  expect(first.receipt).toMatchObject({ status: 'clean', complete: true, lockfileUnchanged: true });
  expect(second.receipt.evidence).not.toBe(first.receipt.evidence);
  expect(readFileSync(join(directory, first.receipt.lockfile), 'utf8')).toBe(readFileSync(join(directory, 'package-lock.json'), 'utf8'));
  const calls: string[][] = readFileSync(join(directory, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(calls[0]).toEqual(expect.arrayContaining(['--include=dev', '--include=optional', '--include=peer', '--workspaces', '--include-workspace-root', '--package-lock-only', '--offline=false']));
  expect(calls[1]).toEqual(expect.arrayContaining(['--omit=dev', '--include=optional', '--include=peer']));
  expect(calls[1]).not.toContain('--include=dev');
  expect(readFileSync(join(directory, first.receipt.scans[0].stdout), 'utf8')).toBe(report());
});

test('a valid nonzero audit retains all findings for reachability triage and still runs production', () => {
  response('full', report(true), 1);
  response('production', report());
  const { result, receipt } = audit();
  expect(result.status).toBe(1);
  expect(receipt).toMatchObject({ status: 'findings', complete: true });
  expect(receipt.scans.map((scan: { complete: boolean }) => scan.complete)).toEqual([true, true]);
  expect(receipt.scans[0].counts.high).toBe(1);
});

test('retains reports and diagnostics larger than a subprocess output buffer', () => {
  const large = JSON.parse(report(true));
  large.vulnerabilities.fixture.via[0].title = 'advisory detail '.repeat(100_000);
  const stdout = JSON.stringify(large);
  const stderr = 'diagnostic\n'.repeat(100_000);
  response('full', stdout, 1, { stderr });
  response('production', report());
  const { result, receipt } = audit();
  expect(result.status).toBe(1);
  expect(readFileSync(join(directory, receipt.scans[0].stdout), 'utf8')).toBe(stdout);
  expect(readFileSync(join(directory, receipt.scans[0].stderr), 'utf8')).toBe(stderr);
});

test.each([
  ['DNS error', JSON.stringify({ message: 'ENOTFOUND registry.npmjs.org', error: { summary: '' } }), 1],
  ['truncated JSON', '{"auditReportVersion":2,', 1],
  ['empty success', '', 0],
  ['partial report', JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }), 0],
  ['malformed vulnerability map', report().replace('"vulnerabilities":{}', '"vulnerabilities":1'), 0],
  ['inconsistent counts', report(true).replace('"total":1', '"total":0'), 1],
  ['unexpected exit', report(), 7],
])('%s is incomplete, preserves raw failure bytes, and does not skip the production scan', (_label, stdout, exit) => {
  response('full', stdout, exit, { stderr: 'transport diagnostic\n' });
  response('production', report());
  const { result, receipt } = audit();
  expect(result.status).toBe(2);
  expect(receipt).toMatchObject({ status: 'incomplete', complete: false });
  expect(receipt.scans[1]).toMatchObject({ scope: 'production', complete: true });
  expect(readFileSync(join(directory, receipt.scans[0].stdout), 'utf8')).toBe(stdout);
  expect(readFileSync(join(directory, receipt.scans[0].stderr), 'utf8')).toBe('transport diagnostic\n');
});

test('a failed production scan cannot be hidden by a clean full scan', () => {
  response('full', report());
  response('production', '{"message":"registry unavailable","error":{}}', 1);
  const { result, receipt } = audit();
  expect(result.status).toBe(2);
  expect(receipt).toMatchObject({ status: 'incomplete', complete: false });
  expect(receipt.scans[1]).toMatchObject({ complete: false, error: 'registry unavailable' });
});

test('lockfile drift during scanning cannot establish a complete audit', () => {
  response('full', report(), 0, { changeLock: true });
  response('production', report());
  const { result, receipt } = audit();
  expect(result.status).toBe(2);
  expect(receipt).toMatchObject({ status: 'incomplete', complete: false, lockfileUnchanged: false });
});
