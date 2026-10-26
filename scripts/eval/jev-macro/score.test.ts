import { historicalStats, latencyStats, score, type ItemResult, type Macros } from './score';
import { loadTruth, type TruthRow } from './truth';

const base = loadTruth().truth.rows[0]!;
const row = (id: string): TruthRow => ({ ...base, id, calories: 100, protein_g: 10, carbs_g: 20, fat_g: 5 });
const result = (id: string, estimate: Macros | null): ItemResult => ({ id, estimate,
  costUsd: 0.0001, latencyMs: 100, model: 'jev-test', failure: estimate ? null : 'Invalid output' });

test('April catastrophic boundary is calorie-only and strictly greater than 50%', () => {
  const metrics = score([row('a'), row('b'), row('c'), row('d')], [
    result('a', { calories: 150, protein: 100, carbs: 200, fat: 50 }),
    result('b', { calories: 151, protein: 10, carbs: 20, fat: 5 }),
    result('c', { calories: 49, protein: 10, carbs: 20, fat: 5 }), result('d', null),
  ]);
  expect(metrics.catastrophicMisses).toBe(3);
  expect(metrics.catastrophicMissRate).toBe(0.75);
  expect(metrics.failures).toBe(1);
  expect(metrics.medianAbsolutePctError.calories).toBe(51);
  expect(metrics.successfulOnlyMedianAbsolutePctError.calories).toBe(51);
});

test('missing results remain misses and cannot lower cost or remove full-set failures', () => {
  const m = score([row('a'), row('b'), row('c')], [result('a', { calories: 100, protein: 10, carbs: 20, fat: 5 })]);
  expect(m).toMatchObject({ total: 3, attempted: 1, successful: 1, failures: 2, catastrophicMisses: 2,
    totalCostUsd: 0.0001, costUsdPer1000Items: 0.1 });
  expect(m.medianAbsolutePctError).toEqual({ calories: null, protein: null, carbs: null, fat: null });
  expect(m.successfulOnlyMedianAbsolutePctError).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  const unknown = score([row('a')], [{ ...result('a', null), costUsd: null }]);
  expect(unknown.totalCostUsd).toBeNull();
  expect(unknown.costUsdPer1000Items).toBeNull();
  expect(unknown.unknownUsageCount).toBe(1);
});

test('zero truth follows the April metrics convention for all four macros', () => {
  const zero = { ...row('z'), calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  expect(score([zero], [result('z', { calories: 0, protein: 0, carbs: 0, fat: 0 })]).medianAbsolutePctError)
    .toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  const positive = score([zero], [result('z', { calories: 1, protein: 1, carbs: 1, fat: 1 })]);
  expect(positive.medianAbsolutePctError).toEqual({ calories: 100, protein: 100, carbs: 100, fat: 100 });
  expect(positive.catastrophicMisses).toBe(1);
});

test('latency uses arithmetic median and nearest-rank p95, with no fabricated empty timings', () => {
  expect(latencyStats([400, 100, 200, 300])).toEqual({ measured: 4, medianMs: 250, p95Ms: 400 });
  expect(latencyStats(Array.from({ length: 100 }, (_, n) => n + 1)).p95Ms).toBe(95);
  expect(latencyStats([])).toEqual({ measured: 0, medianMs: null, p95Ms: null });
});

test('archived April Haiku comparisons are read without executing a model', () => {
  const historical = historicalStats();
  expect(historical.map(run => run.catastrophicMisses)).toEqual([8, 7, 9]);
  expect(historical.every(run => run.total === 60 && run.scored === 60)).toBe(true);
  expect(historical[0]!.medianAbsolutePctError.calories).toBeCloseTo(12.982108294387007);
  expect(historical[0]!.medianAbsolutePctError.protein).toBeCloseTo(15.476190476190474);
  expect(historical[1]!.medianAbsolutePctError.fat).toBeCloseTo(16.666666666666664);
});
