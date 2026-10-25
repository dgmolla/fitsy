import { median } from '../lib/metrics';
import type { Benchmark } from './fixture';

export interface DecisionResult {
  id: string;
  decision: boolean | null;
  latencyMs: number;
  costUsd: number | null;
}
export function scoreDecisions(labels: { id: string; match: boolean }[], results: DecisionResult[]) {
  if (!labels.length || new Set(labels.map(l => l.id)).size !== labels.length) throw new Error('Invalid labels');
  const known = new Set(labels.map(l => l.id)), byId = new Map<string, DecisionResult>();
  for (const result of results) {
    if (!known.has(result.id) || byId.has(result.id) || !Number.isFinite(result.latencyMs) || result.latencyMs < 0
      || (result.costUsd !== null && (!Number.isFinite(result.costUsd) || result.costUsd < 0))
      || ![true, false, null].includes(result.decision)) throw new Error('Invalid, duplicate or unexpected result');
    byId.set(result.id, result);
  }
  let tp = 0, tn = 0, fp = 0, fn = 0, abstained = 0;
  for (const label of labels) {
    const result = byId.get(label.id);
    if (!result || result.decision === null) { abstained++; continue; }
    if (label.match) { if (result.decision) tp++; else fn++; }
    else { if (result.decision) fp++; else tn++; }
  }
  const positive = labels.filter(l => l.match).length, negative = labels.length - positive;
  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const costKnown = results.length === labels.length && results.every(r => r.costUsd !== null);
  const totalCostUsd = costKnown ? results.reduce((sum, r) => sum + r.costUsd!, 0) : null;
  return { total: labels.length, attempted: results.length, positive, negative, tp, tn, fp, fn, abstained,
    accuracy: (tp + tn) / labels.length,
    falsePositiveRate: negative ? fp / negative : null,
    falseDiscoveryRate: tp + fp ? fp / (tp + fp) : null,
    recall: positive ? tp / positive : null,
    coverage: (labels.length - abstained) / labels.length,
    totalCostUsd, costUsdPer1000: totalCostUsd === null ? null : totalCostUsd / labels.length * 1000,
    medianLatencyMs: latencies.length ? median(latencies) : null,
    p95LatencyMs: latencies.length ? latencies[Math.ceil(latencies.length * 0.95) - 1]! : null };
}
export type DecisionMetrics = ReturnType<typeof scoreDecisions>;
export function recommend(benchmark: Benchmark, baseline: DecisionMetrics, jev: DecisionMetrics | null) {
  if (!jev) return { decision: 'NO-GO', reasons: ['Jev has not been evaluated; no production adoption evidence'] };
  const t = benchmark.thresholds;
  const checks = {
    complete: jev.attempted === jev.total && jev.coverage === 1,
    accuracy: jev.accuracy >= Math.max(t.accuracy, baseline.accuracy),
    falsePositiveRate: jev.falsePositiveRate !== null && jev.falsePositiveRate <= t.falsePositiveRate,
    falseDiscoveryRate: jev.falseDiscoveryRate !== null && jev.falseDiscoveryRate <= t.falseDiscoveryRate,
    recall: jev.recall !== null && jev.recall >= t.recall,
    recallGain: jev.recall !== null && baseline.recall !== null && jev.recall - baseline.recall >= t.recallGain,
    cost: jev.costUsdPer1000 !== null && jev.costUsdPer1000 <= t.costUsdPer1000,
    latency: jev.p95LatencyMs !== null && jev.p95LatencyMs <= t.p95LatencyMs,
  };
  const reasons = Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => `Failed frozen threshold: ${name}`);
  return { decision: reasons.length ? 'NO-GO' : 'GO: larger offline evaluation only', reasons };
}

export function formatReport(report: { digest: string; frozenCommit: string | null; baseline: DecisionMetrics;
  jev: DecisionMetrics | null; recommendation: ReturnType<typeof recommend>; stopReason: string | null; modelsReturned?: string[] }) {
  const pct = (n: number | null) => n === null ? 'not measured' : `${(n * 100).toFixed(2)}%`;
  const num = (n: number | null) => n === null ? 'not measured' : n.toFixed(4);
  const row = (name: string, m: DecisionMetrics | null) => m
    ? `| ${name} | ${pct(m.accuracy)} | ${pct(m.falsePositiveRate)} | ${pct(m.falseDiscoveryRate)} | ${pct(m.recall)} | ${m.costUsdPer1000 === null ? 'not measured' : '$' + num(m.costUsdPer1000)} | ${num(m.medianLatencyMs)} / ${num(m.p95LatencyMs)} | ${m.attempted}/${m.total} |`
    : `| ${name} | not measured | not measured | not measured | not measured | not measured | not measured | 0/${report.baseline.total} |`;
  return [
    `**TL;DR:** ${report.recommendation.decision}; ${report.jev ? 'see the frozen threshold verdict below.' : 'live Jev evaluation is pending the required commit.'}`,
    '', '| Method | Accuracy | FP / negatives | FP / predicted matches | Recall | USD / 1k pairs | Median / p95 ms | Attempted |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |', row('Exact alias', report.baseline), row('Jev', report.jev), '',
    `Benchmark SHA-256: \`${report.digest}\`.`, `Frozen execution commit: ${report.frozenCommit ?? 'uncommitted; model calls prohibited'}.`,
    `Jev models returned: ${report.modelsReturned?.join(', ') || 'not measured'}.`,
    `Verdict: ${report.recommendation.reasons.join('; ') || 'All frozen thresholds passed; production changes require a separate issue.'}`,
    ...(report.stopReason ? [`Execution stopped: ${report.stopReason}.`] : []),
    'Abstentions and missing results count as incorrect; failures never disappear from denominators.',
    'Cost uses reported input tokens at the frozen vendor price; unknown usage is never free.',
    'Pairs are contextual LA menu variants, not independent restaurants or a random LA population sample.',
    'This measures a supplied candidate decision, not candidate retrieval, end-to-end macro accuracy or production coverage.',
    'Raw baseline decisions are retained in baseline.json alongside summary.json.',
    'Live and replay outputs also contain the append-only Jev request/response journal.', '',
  ].join('\n');
}
