import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { coverageSnapshotFixture as snapshot } from '../apps/api/tests/fixtures/chainCoverage';

test('actual offline CLI writes a private proposal report and rejects overwrite, apply and an unpinned live target', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-498-audit-'));
  const source = join(dir, 'snapshot.json'), report = join(dir, 'report.json');
  const script = resolve(__dirname, 'chain-coverage-audit.ts');
  const run = (...args: string[]) => execFileSync(process.execPath, ['--import', require.resolve('tsx'), script, ...args], {
    encoding: 'utf8', env: { ...process.env, PROD_DATABASE_URL: 'postgresql://fixture:fixture@localhost/fixture' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    writeFileSync(source, JSON.stringify(snapshot()));
    expect(JSON.parse(run('snapshot', source, report, '--target=0.8'))).toMatchObject({ origin: 'fixture', applied: false, chains: 2 });
    expect(JSON.parse(readFileSync(report, 'utf8')).chains).toHaveLength(2);
    expect(() => run('snapshot', source, report)).toThrow('EEXIST');
    expect(() => run('snapshot', source, join(dir, 'bad.json'), '--apply')).toThrow('Usage');
    expect(() => run('live', source, join(dir, 'bad.json'))).toThrow('does not look like the prod project');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
