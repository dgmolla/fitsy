import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const parent = join(root, '.evidence/dependency-audit');
mkdirSync(parent, { recursive: true });
const evidence = mkdtempSync(join(parent, `${new Date().toISOString().replaceAll(':', '-')}-`));
const lockfile = readFileSync(join(root, 'package-lock.json'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
writeFileSync(join(evidence, 'package-lock.json'), lockfile);

// Audit errors can also be JSON and exit 1. Only an actual complete npm v2
// advisory report establishes coverage, including when it contains findings.
function countsFrom(report, exitCode) {
  if (report.error || report.auditReportVersion !== 2 || !report.vulnerabilities || typeof report.vulnerabilities !== 'object' ||
      Array.isArray(report.vulnerabilities) || !report.metadata?.vulnerabilities) return null;
  const counts = report.metadata.vulnerabilities;
  const severities = ['info', 'low', 'moderate', 'high', 'critical'];
  if (![...severities, 'total'].every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0)) return null;
  const entries = Object.values(report.vulnerabilities);
  if (entries.length !== counts.total || severities.reduce((sum, key) => sum + counts[key], 0) !== counts.total ||
      severities.some(key => entries.filter(entry => entry.severity === key).length !== counts[key]) ||
      entries.some(entry => !Array.isArray(entry.via) || !Array.isArray(entry.nodes)) ||
      exitCode !== (counts.total ? 1 : 0)) return null;
  return counts;
}

const npmVersion = spawnSync('npm', ['--version'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
const tree = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
const scans = [];
for (const scope of ['full', 'production']) {
  const args = ['audit', '--json', '--package-lock-only', '--workspaces', '--include-workspace-root',
    '--include=optional', '--include=peer', scope === 'full' ? '--include=dev' : '--omit=dev',
    '--audit-level=info', '--registry=https://registry.npmjs.org', '--offline=false',
    '--prefer-offline=false', '--fetch-retries=0', '--fetch-timeout=30000'];
  const stdout = join(evidence, `${scope}.json`);
  const stderr = join(evidence, `${scope}.stderr`);
  const streams = [openSync(stdout, 'wx'), openSync(stderr, 'wx')];
  const started = Date.now();
  let result;
  try {
    result = spawnSync('npm', args, { cwd: root, stdio: ['ignore', ...streams], timeout: 120_000 });
  } finally {
    streams.forEach(closeSync);
  }
  let counts = null;
  let error = result.error?.message ?? null;
  try {
    const report = JSON.parse(readFileSync(stdout, 'utf8'));
    counts = countsFrom(report, result.status);
    if (!counts && !error) error = report?.message || 'npm did not return a consistent complete v2 audit report';
  } catch (failure) {
    error = failure.message;
  }
  scans.push({ scope, command: ['npm', ...args], exitCode: result.status, signal: result.signal,
    elapsedMs: Date.now() - started, complete: !error && !result.signal && counts !== null, counts, error,
    stdout: relative(root, stdout), stderr: relative(root, stderr) });
}

const lockfileUnchanged = digest(readFileSync(join(root, 'package-lock.json'))) === digest(lockfile);
const complete = lockfileUnchanged && scans.every(scan => scan.complete);
const status = !complete ? 'incomplete' : scans.some(scan => scan.counts.total) ? 'findings' : 'clean';
const receipt = { name: 'dependency-audit', status, complete, createdAt: new Date().toISOString(),
  source: head.status === 0 ? head.stdout.trim() : null,
  sourceDirty: tree.status === 0 ? tree.stdout.trim() !== '' : null, nodeVersion: process.version,
  npmVersion: npmVersion.status === 0 ? npmVersion.stdout.trim() : null,
  lockfileSha256: digest(lockfile), lockfileUnchanged, lockfile: relative(root, join(evidence, 'package-lock.json')),
  scans };
writeFileSync(join(evidence, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ...receipt, evidence: relative(root, evidence) })}\n`);
process.exitCode = status === 'incomplete' ? 2 : status === 'findings' ? 1 : 0;
