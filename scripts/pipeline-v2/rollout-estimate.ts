import { z } from 'zod';
import * as input from './rollout-input.json';
import type { RolloutPhase } from './rollout-priority';

const nonnegative = z.number().finite().nonnegative();
const count = nonnegative.int();
export const baselineSchema = z.object({
  restaurants: count.positive(), uniqueItems: count.positive(), officialItems: count, jevItems: count.positive(),
  uberEatsCalls: count.positive(), jevCalls: count.positive(), costUsd: nonnegative, wallMs: nonnegative.positive(),
}).refine(b => b.officialItems + b.jevItems === b.uniqueItems, 'Incomplete baseline item accounting');
export type RolloutBaseline = z.infer<typeof baselineSchema>;

/** Read the actual #591 report, refusing incomplete time, unknown bills and failed/partial hexes. */
export function baselineFromPoc(raw: unknown): RolloutBaseline {
  const report = z.object({
    version: z.literal(2), environment: z.literal('dev'), status: z.literal('completed'),
    source: z.object({ head: z.string().regex(/^[a-f0-9]{40}$/), sourceHash: z.string().regex(/^[a-f0-9]{64}$/) }),
    wallTimeComplete: z.literal(true), unknownUsage: z.literal(false), interruptedAttempts: z.literal(0),
    costUsd: nonnegative, wallMs: nonnegative.positive(),
    coverage: z.object({ restaurants: count.positive(), uniqueItems: count.positive(), officialItems: count,
      jevItems: count.positive(), persistedItems: count.positive(), rejectedItems: count }),
    calls: z.object({ uberEats: count.positive(), jev: count.positive() }),
  }).parse(raw);
  if (report.coverage.persistedItems + report.coverage.rejectedItems !== report.coverage.uniqueItems) throw new Error('POC persisted coverage is incomplete');
  return baselineSchema.parse({ ...report.coverage, uberEatsCalls: report.calls.uberEats,
    jevCalls: report.calls.jev, costUsd: report.costUsd, wallMs: report.wallMs });
}

export function estimatePhase(phase: RolloutPhase, hexes: number, probes: number, baseline: RolloutBaseline,
  eligible?: { hexes: number; restaurants: number }) {
  baselineSchema.parse(baseline);
  const { capacity } = input, settings = input.phases[phase];
  const occupiedHexes = eligible?.hexes ?? Math.ceil(hexes * settings.occupiedFraction);
  const workloadHexes = eligible ? eligible.restaurants / baseline.restaurants : occupiedHexes;
  const ueCalls = Math.ceil(workloadHexes * baseline.uberEatsCalls * capacity.retryFactor);
  const discoveryCalls = Math.ceil(probes * capacity.discoveryPagesPerProbe * capacity.retryFactor);
  const jevCalls = Math.ceil(workloadHexes * baseline.jevCalls * capacity.retryFactor);
  const jevUsd = workloadHexes * baseline.costUsd * capacity.retryFactor;
  const effectiveRps = capacity.ueCapRps * capacity.ueUtilization;
  // Discovery precedes enrichment. Replicas share one UE ceiling and one UTC-day budget.
  const discoveryHours = discoveryCalls / effectiveRps / 3600;
  const enrichmentHours = Math.max(ueCalls / effectiveRps / 3600,
    workloadHexes * baseline.wallMs * capacity.retryFactor / capacity.workers / 3_600_000,
    jevCalls / capacity.jevDailyCalls * 24, jevUsd / capacity.jevDailyUsd * 24);
  const hours = discoveryHours + enrichmentHours;
  const workerUsd = hours * capacity.workers * capacity.workerUsdPerHour;
  const pdfUsd = occupiedHexes ? settings.newPdfBrands * capacity.pdfUsdPerBrand : 0;
  const totalUsd = jevUsd + workerUsd + pdfUsd;
  // Existing reviewed facts avoid estimation; location menus are still fetched separately.
  const officialSavingsUsd = jevUsd * baseline.officialItems / baseline.jevItems;
  return { phase, hexes, probes, occupiedHexes, ueCalls, discoveryCalls, jevCalls,
    hours, jevUsd, workerUsd, pdfUsd, totalUsd, officialSavingsUsd,
    budgetUsd: settings.budgetUsd, withinBudget: totalUsd <= settings.budgetUsd };
}
