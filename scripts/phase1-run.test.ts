import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('real batch CLI includes source-less chains and emits an actionable manual-source queue', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-498-phase1-'));
  const script = resolve(__dirname, 'phase1-run.ts');
  const discover = join(dir, 'discover.json');
  try {
    writeFileSync(discover, JSON.stringify({ results: [{ slug: 'kfc', display: 'KFC', official: null,
      artifactType: null, outcome: 'no-official' }] }));
    // Old checkpoints must not hide the fixed classification or a changed source URL.
    const run = join(dir, 'scripts/phase1-out/run'); mkdirSync(run, { recursive: true });
    writeFileSync(join(run, 'kfc.result.json'), JSON.stringify({ slug: 'kfc', official: 'https://example.com/obsolete',
      status: 'official', route: 'pdf', rows: 100, valid: 100 }));
    execFileSync(process.execPath, ['--import', require.resolve('tsx'), script, discover, '20'], {
      cwd: dir, env: { ...process.env, ANTHROPIC_API_KEY: '' }, encoding: 'utf8' });
    const coverage = JSON.parse(readFileSync(join(run, '_coverage.json'), 'utf8'));
    expect(coverage.results).toHaveLength(1);
    expect(coverage.results[0]).toMatchObject({ slug: 'kfc', status: 'deferred-no-official', valid: 0 });
    expect(JSON.parse(readFileSync(join(run, '_manual-sources.json'), 'utf8')).chains[0].action).toContain('official US nutrition');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
