import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { computeItemMetrics, median } from '../lib/metrics';
import { repository, sha256, sourcePaths, type TruthRow } from './truth';

export const macroNames = ['calories', 'protein', 'carbs', 'fat'] as const;
export type Macros = Record<typeof macroNames[number], number>;
export interface ItemResult {
  id: string;
  estimate: Macros | null;
  failure: string | null;
  costUsd: number | null;
  latencyMs: number | null;
  model: string | null;
}
const finiteMedian = (values: number[]) => values.length && Number.isFinite(median(values)) ? median(values) : null;
export function latencyStats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { measured: values.length, medianMs: finiteMedian(values), p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null };
}

export function score(rows: TruthRow[], results: ItemResult[]) {
  const byId = new Map(results.map(result => [result.id, result]));
  if (byId.size !== results.length || results.some(result => !rows.some(row => row.id === result.id))) throw new Error('Duplicate or unknown scored item');
  const perItem = rows.map(row => {
    const result = byId.get(row.id), estimate = result?.estimate;
    if (!estimate) return { id: row.id, absolutePctError: null, catastrophic: true, failure: result?.failure ?? 'Not attempted or interrupted' };
    // Reuse April's zero-truth convention: truth=0 => 0% if estimate=0, otherwise 100%.
    const measured = computeItemMetrics({ calories: estimate.calories, proteinG: estimate.protein,
      carbsG: estimate.carbs, fatG: estimate.fat, confidence: 'LOW', inputTokens: 0, outputTokens: 0, latencyMs: 0, costUsd: 0 },
    { id: row.id, chain: row.chain, itemName: row.itemName, source: row.source.file,
      officialMacros: { calories: row.calories, proteinG: row.protein_g, carbsG: row.carbs_g, fatG: row.fat_g } });
    const absolutePctError: Macros = { calories: measured.errors.calories.pct, protein: measured.errors.proteinG.pct,
      carbs: measured.errors.carbsG.pct, fat: measured.errors.fatG.pct };
    // scripts/eval/hero-eval/run.ts:235-237: strictly >50% CALORIE error, not any-macro error.
    return { id: row.id, absolutePctError, catastrophic: absolutePctError.calories > 50, failure: null };
  });
  const failures = perItem.filter(item => item.failure !== null).length;
  const knownCostUsd = results.reduce((sum, result) => sum + (result.costUsd ?? 0), 0);
  const unknownUsageCount = results.filter(result => result.costUsd === null).length;
  const totalCostUsd = unknownUsageCount ? null : knownCostUsd;
  const medians = (includeFailures: boolean) => Object.fromEntries(macroNames.map(macro => [macro,
    finiteMedian(perItem.filter(item => includeFailures || item.absolutePctError !== null)
      .map(item => item.absolutePctError?.[macro] ?? Infinity))])) as Record<keyof Macros, number | null>;
  const catastrophicMisses = perItem.filter(item => item.catastrophic).length;
  return { total: rows.length, attempted: results.length, successful: rows.length - failures, failures,
    medianAbsolutePctError: medians(true), successfulOnlyMedianAbsolutePctError: medians(false),
    catastrophicMisses, catastrophicMissRate: catastrophicMisses / rows.length,
    knownCostUsd, unknownUsageCount, totalCostUsd,
    costUsdPer1000Items: totalCostUsd === null || !results.length ? null : totalCostUsd / results.length * 1000,
    latency: latencyStats(results.flatMap(result => result.latencyMs === null ? [] : [result.latencyMs])), perItem };
}

const historicalSchema = z.object({ caseName: z.string(), model: z.string(), timestamp: z.string(), itemCount: z.number().int().positive(),
  aggregate: z.object({ calories: z.object({ medianAbsPctError: z.number() }), proteinG: z.object({ medianAbsPctError: z.number() }),
    carbsG: z.object({ medianAbsPctError: z.number() }), fatG: z.object({ medianAbsPctError: z.number() }) }),
  totalCostUsd: z.number(), items: z.array(z.object({ errors: z.object({ calories: z.object({ pct: z.number() }) }),
    estimated: z.object({ latencyMs: z.number() }) })) });

/** Read archived results only. Never import or execute the historic model adapters. */
export function historicalStats(root = repository) {
  return [sourcePaths.historicalBaseline, sourcePaths.historicalHints, sourcePaths.historicalServing].map(file => {
    const bytes = readFileSync(resolve(root, file)), archived = historicalSchema.parse(JSON.parse(bytes.toString()));
    const catastrophicMisses = archived.items.filter(item => item.errors.calories.pct > 50).length;
    return { file, sha256: sha256(bytes), model: archived.model, caseName: archived.caseName, timestamp: archived.timestamp,
      total: archived.itemCount, scored: archived.items.length,
      medianAbsolutePctError: { calories: archived.aggregate.calories.medianAbsPctError, protein: archived.aggregate.proteinG.medianAbsPctError,
        carbs: archived.aggregate.carbsG.medianAbsPctError, fat: archived.aggregate.fatG.medianAbsPctError },
      catastrophicMisses, catastrophicMissRate: catastrophicMisses / archived.itemCount,
      costUsdPer1000Items: archived.totalCostUsd / archived.itemCount * 1000,
      latency: latencyStats(archived.items.map(item => item.estimated.latencyMs)) };
  });
}

const format = (n: number | null, digits = 2) => n === null ? 'unavailable' : n.toFixed(digits);
export function formatReport(report: {
  mode: string; truthSha256: string; protocolSha256: string; stopReason: string | null; modelsReturned: string[];
  byChain: Record<string, number>; metrics: ReturnType<typeof score>; historical: ReturnType<typeof historicalStats>;
}) {
  const m = report.metrics;
  const tableRow = (name: string, data: { medianAbsolutePctError: Record<keyof Macros, number | null>;
    catastrophicMisses: number; total: number; costUsdPer1000Items: number | null; latency: ReturnType<typeof latencyStats> }) =>
    `| ${name} | ${macroNames.map(macro => format(data.medianAbsolutePctError[macro])).join(' | ')} | ${data.catastrophicMisses}/${data.total} | ${format(data.costUsdPer1000Items, 6)} | ${format(data.latency.medianMs)} | ${format(data.latency.p95Ms)} |`;
  return [
    '# Jev macro accuracy evaluation', '',
    `**TL;DR:** ${m.successful}/${m.total} items scored successfully; ${m.failures} failures or omissions count as catastrophic misses.`, '',
    `Mode: ${report.mode}; returned model(s): ${report.modelsReturned.join(', ') || 'none'}.`,
    `Stop reason: ${report.stopReason ?? 'completed'}.`,
    `Truth SHA-256: \`${report.truthSha256}\`.`,
    `Protocol SHA-256: \`${report.protocolSha256}\`.`, '',
    `Truth set: ${Object.entries(report.byChain).map(([chain, count]) => `${chain}: ${count}`).join('; ')}.`, '',
    '| Run | Cal MdAPE % | Protein MdAPE % | Carb MdAPE % | Fat MdAPE % | Catastrophic misses | $ / 1k attempted | Median ms | p95 ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    tableRow('Jev', m),
    ...report.historical.map(run => tableRow(`April 2026 ${run.caseName}`, run)), '',
    '## Scoring and accounting', '',
    'Catastrophic means strictly greater than 50% absolute calorie error, as defined in `scripts/eval/hero-eval/run.ts:235-237`.',
    'The April zero-truth rule from `scripts/eval/lib/metrics.ts:23-26` is reused directly: zero truth and zero prediction give 0%; zero truth and a positive prediction give 100%.',
    'Every failed, invalid, timed-out, interrupted or unattempted item counts as a catastrophic miss over the full frozen truth denominator.',
    'For full-set MdAPE, failed items contribute positive infinity; an infinite median is serialized as null and shown as unavailable.',
    'The successfulOnlyMedianAbsolutePctError field in summary.json reports the explicitly labeled successful-only statistic.',
    'Latency includes measured failed requests, uses the arithmetic median and nearest-rank p95, and excludes requests with no measured response time.',
    `Known reported spend: $${format(m.knownCostUsd, 8)}; unknown-usage attempts: ${m.unknownUsageCount}.`,
    'A missing or invalid usage record stops the run and leaves total cost and cost per 1k unknown, while retaining the known subtotal.',
    'Cost per 1k uses attempted items, including failures; unattempted items cannot dilute cost.',
    'The frozen price is $0.042 per million input tokens and $0 for output, from docs/engineering/pipeline/jev-chain-match-eval.md (checked there on 2026-10-24).',
    'Live execution has a $1.00 local budget, reserves a bounded request envelope before each attempt, and never retries.', '',
    '## Historical comparison limits', '',
    'These archived claude-haiku-4-5 runs each used 60 items across six different chains, with different prompts and inputs.',
    'Their older truth was curated from fastfoodnutrition.org and chain websites; it is excluded from the new official-only truth set.',
    'The new set includes sides, sauces, drinks and family servings; rows from the same two chains are correlated.',
    'The April prompt variants were evaluated on their own set; these results do not establish a paired model ranking, causal improvement, or production accuracy.',
    'April costs use historical provider accounting, while Jev uses the frozen Typesafe price; latency comes from different dates and environments.',
    'No historic model code is executed to produce this comparison.', '',
    ...report.historical.flatMap(run => [`- ${run.caseName}: \`${run.file}\`; SHA-256 \`${run.sha256}\`; ${run.scored}/${run.total} scored; ${run.timestamp}.`]), '',
  ].join('\n');
}
