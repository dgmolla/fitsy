import { loadBenchmark } from './fixture';
import { formatReport, recommend, scoreDecisions, type DecisionResult } from './score';

const labels = [{ id: 'positive', match: true }, { id: 'negative', match: false }, { id: 'missing', match: true }, { id: 'abstain', match: false }];
const result = (id: string, decision: boolean | null, latencyMs = 10, costUsd: number | null = 0.001): DecisionResult => ({ id, decision, latencyMs, costUsd });

test('confusion matrix, abstentions, missing responses and costs keep the full denominator', () => {
  const m = scoreDecisions(labels, [result('positive', true), result('negative', true), result('abstain', null)]);
  expect(m).toMatchObject({ total: 4, attempted: 3, positive: 2, negative: 2, tp: 1, tn: 0, fp: 1, fn: 0,
    abstained: 2, accuracy: 0.25, recall: 0.5, coverage: 0.5, falsePositiveRate: 0.5, falseDiscoveryRate: 0.5,
    totalCostUsd: null, costUsdPer1000: null });
});

test('no-match on every pair has no claimed precision and fails recall', () => {
  const m = scoreDecisions(labels, labels.map(l => result(l.id, false)));
  expect(m).toMatchObject({ tp: 0, tn: 2, fp: 0, fn: 2, accuracy: 0.5, recall: 0, falseDiscoveryRate: null });
  expect(recommend(loadBenchmark().benchmark, m, m).decision).toBe('NO-GO');
});

test('latencies use all attempts, nearest-rank p95, and existing median helper', () => {
  const m = scoreDecisions(labels, [result('positive', true, 10), result('negative', false, 20), result('missing', true, 30), result('abstain', false, 40)]);
  expect(m).toMatchObject({ accuracy: 1, medianLatencyMs: 25, p95LatencyMs: 40, totalCostUsd: 0.004, costUsdPer1000: 1 });
  expect(scoreDecisions(labels, []).medianLatencyMs).toBeNull();
  expect(scoreDecisions(labels, [result('positive', null, 10, null)]).costUsdPer1000).toBeNull();
});

test('duplicate or foreign IDs and invalid accounting are rejected', () => {
  for (const results of [[result('foreign', true)], [result('positive', true), result('positive', false)],
    [result('positive', true, -1)], [result('positive', true, Number.NaN)], [result('positive', true, 1, -1)]]) {
    expect(() => scoreDecisions(labels, results)).toThrow();
  }
});

test('GO requires every frozen threshold, completeness, measured spend and improvement over the baseline', () => {
  const f = loadBenchmark(), perfect = f.cases.map(c => result(c.id, c.match, 100, 0.00003));
  const baselineResults = perfect.map(r => ['la-021', 'la-023'].includes(r.id) ? { ...r, decision: false } : r);
  const baseline = scoreDecisions(f.cases, baselineResults), good = scoreDecisions(f.cases, perfect);
  expect(recommend(f.benchmark, baseline, good).decision).toBe('GO: larger offline evaluation only');
  for (const patch of [{ accuracy: 0.94 }, { falsePositiveRate: 0.02 }, { falseDiscoveryRate: 0.02 },
    { recall: 0.94 }, { recall: baseline.recall }, { costUsdPer1000: null }, { costUsdPer1000: 0.11 },
    { p95LatencyMs: 1001 }, { coverage: 0.99 }, { attempted: 199 }]) {
    expect(recommend(f.benchmark, baseline, { ...good, ...patch }).decision).toBe('NO-GO');
  }
  expect(recommend(f.benchmark, baseline, null)).toEqual({ decision: 'NO-GO', reasons: expect.arrayContaining([expect.stringContaining('not been evaluated')]) });
});

test('pending report never invents Jev accuracy, zero spend or latency', () => {
  const f = loadBenchmark(), baseline = scoreDecisions(f.cases, f.cases.map(c => result(c.id, c.match)));
  const report = formatReport({ digest: f.digest, frozenCommit: null, baseline, jev: null,
    recommendation: recommend(f.benchmark, baseline, null), stopReason: 'Required commit pending' });
  expect(report).toContain('**TL;DR:** NO-GO');
  expect(report).toContain('| Jev | not measured | not measured | not measured | not measured | not measured | not measured | 0/200 |');
  expect(report).toContain('uncommitted; model calls prohibited');
});
