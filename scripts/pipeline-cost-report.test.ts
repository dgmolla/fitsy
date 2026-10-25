import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

it.each([false, true])('reports measured tokens and costs for a hex filter: %s', hex => {
  const dir = mkdtempSync(join(tmpdir(), 'preload-report-'));
  try {
    const queryPath = join(dir, 'queries.txt');
    const result = spawnSync(process.execPath, [
      '--require', join(__dirname, 'test-fixtures/axiom-cost-report.cjs'), '--import', 'tsx',
      'scripts/pipeline-report.ts', '--run-id', 'test-cost', ...(hex ? ['--hex', 'hex-a'] : []),
    ], { cwd: resolve(__dirname, '..'), encoding: 'utf8', timeout: 30_000,
      env: { PATH: process.env.PATH, AXIOM_TOKEN: 'test-token', PRELOAD_TEST_QUERIES: queryPath } });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${hex ? 'Hex total' : 'Cumulative'}: $0.011`);
    expect(result.stdout).toContain('Input/output tokens: 1000/2000');
    expect(result.stdout).toContain('Cost per 1k AI item attempts: $5.500000');
    const queries = readFileSync(queryPath, 'utf8');
    expect(queries).toContain(hex ? 'measuredCost=hexCost' : 'measuredCost=coalesce(costTotal, cumulativeCost)');
    expect(queries).toContain(hex ? 'measuredUsage=hexUsage' : 'measuredUsage=coalesce(aiUsage, cumulativeUsage)');
    expect(queries).toContain('inputTokens=max(tolong(measuredUsage.inputTokens))');
    if (!hex) expect(queries).toContain('(type == "cost_checkpoint" or type == "run")');
    if (!hex) {
      expect(queries).toContain('sort by _time desc | take 1 | project durationTotal');
      expect(result.stdout).toContain('Status:     spend_cap');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('keeps the cost-spike monitor tied to a hex rather than cumulative run spend', () => {
  const dir = mkdtempSync(join(tmpdir(), 'preload-monitors-'));
  try {
    const queryPath = join(dir, 'requests.jsonl');
    const result = spawnSync(process.execPath, [
      '--require', join(__dirname, 'test-fixtures/axiom-cost-report.cjs'), '--import', 'tsx', 'scripts/axiom-setup.ts',
    ], { cwd: resolve(__dirname, '..'), encoding: 'utf8', timeout: 30_000,
      env: { PATH: process.env.PATH, AXIOM_TOKEN: 'test-token', SLACK_WEBHOOK_URL: 'https://example.test/webhook',
        PRELOAD_TEST_QUERIES: queryPath, PRELOAD_TEST_SETUP: '1' } });
    expect(result.status).toBe(0);
    const requests = readFileSync(queryPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const monitors = requests.filter(request => request.url.endsWith('/monitors') && request.method === 'POST').map(request => request.body);
    expect(monitors.find(monitor => monitor.name === 'Pipeline: Cost checkpoint spike')).toMatchObject({
      aplQuery: '[\'fitsy-pipeline\'] | where type == "cost_checkpoint" and hexCost > 5', operator: 'MatchEvent',
    });
    expect(monitors.find(monitor => monitor.name === 'Pipeline: Cost overrun')?.aplQuery).toContain('costTotal > 200');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
