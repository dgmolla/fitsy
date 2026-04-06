import type {
  EvalItemResult,
  MacroAggregateMetrics,
  MacroEstimateResult,
  GroundTruthItem,
  RedFlagItem,
  RedFlagDiagnosis,
  ConfidenceCalibration,
  ChainBreakdown,
} from "./types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function pctError(estimated: number, official: number): number {
  if (official === 0) return estimated > 0 ? 100 : 0;
  return (Math.abs(estimated - official) / official) * 100;
}

function signedPctError(estimated: number, official: number): number {
  if (official === 0) return estimated > 0 ? 100 : 0;
  return ((estimated - official) / official) * 100;
}

function computeMacroError(
  estimated: number,
  official: number,
): { absolute: number; pct: number; signed: number } {
  return {
    absolute: Math.abs(estimated - official),
    pct: pctError(estimated, official),
    signed: signedPctError(estimated, official),
  };
}

// ─── Item Metrics ────────────────────────────────────────────────────────────

export function computeItemMetrics(
  estimated: MacroEstimateResult,
  groundTruth: GroundTruthItem,
): EvalItemResult {
  const official = groundTruth.officialMacros;
  return {
    groundTruth,
    estimated,
    errors: {
      calories: computeMacroError(estimated.calories, official.calories),
      proteinG: computeMacroError(estimated.proteinG, official.proteinG),
      carbsG: computeMacroError(estimated.carbsG, official.carbsG),
      fatG: computeMacroError(estimated.fatG, official.fatG),
    },
  };
}

// ─── Aggregate Metrics ───────────────────────────────────────────────────────

function computeSingleAggregate(
  values: { pct: number; signed: number }[],
): MacroAggregateMetrics {
  const absPcts = values.map((v) => v.pct);
  const signedPcts = values.map((v) => v.signed);
  const sorted = [...absPcts].sort((a, b) => a - b);
  const p90Index = Math.floor(sorted.length * 0.9);
  return {
    medianAbsPctError: median(absPcts),
    meanAbsPctError:
      absPcts.length > 0
        ? absPcts.reduce((a, b) => a + b, 0) / absPcts.length
        : 0,
    p90AbsPctError: sorted[Math.min(p90Index, sorted.length - 1)]!,
    medianSignedPctError: median(signedPcts),
  };
}

export function computeAggregateMetrics(
  items: EvalItemResult[],
): {
  calories: MacroAggregateMetrics;
  proteinG: MacroAggregateMetrics;
  carbsG: MacroAggregateMetrics;
  fatG: MacroAggregateMetrics;
} {
  return {
    calories: computeSingleAggregate(items.map((i) => i.errors.calories)),
    proteinG: computeSingleAggregate(items.map((i) => i.errors.proteinG)),
    carbsG: computeSingleAggregate(items.map((i) => i.errors.carbsG)),
    fatG: computeSingleAggregate(items.map((i) => i.errors.fatG)),
  };
}

// ─── Confidence Calibration ──────────────────────────────────────────────────

export function computeConfidenceCalibration(
  items: EvalItemResult[],
): ConfidenceCalibration[] {
  const groups = new Map<
    "HIGH" | "MEDIUM" | "LOW",
    EvalItemResult[]
  >();

  for (const item of items) {
    const conf = item.estimated.confidence;
    if (!groups.has(conf)) groups.set(conf, []);
    groups.get(conf)!.push(item);
  }

  const result: ConfidenceCalibration[] = [];
  for (const level of ["HIGH", "MEDIUM", "LOW"] as const) {
    const group = groups.get(level);
    if (!group || group.length === 0) continue;
    result.push({
      confidence: level,
      count: group.length,
      medianCalError: median(group.map((i) => i.errors.calories.pct)),
    });
  }

  return result;
}

// ─── Per-Chain Breakdown ─────────────────────────────────────────────────────

export function computePerChainBreakdown(
  items: EvalItemResult[],
): ChainBreakdown[] {
  const groups = new Map<string, EvalItemResult[]>();

  for (const item of items) {
    const chain = item.groundTruth.chain;
    if (!groups.has(chain)) groups.set(chain, []);
    groups.get(chain)!.push(item);
  }

  const result: ChainBreakdown[] = [];
  for (const [chain, group] of groups) {
    result.push({
      chain,
      count: group.length,
      medianCalError: median(group.map((i) => i.errors.calories.pct)),
    });
  }

  return result.sort((a, b) => a.chain.localeCompare(b.chain));
}

// ─── Red Flag Diagnosis ──────────────────────────────────────────────────────

const COUNTABLE_WORDS =
  /\b(nuggets?|pieces?|wings?|tacos?|cookies?|sliders?|strips?|tenders?|bites?|rolls?|pc|pcs)\b/i;

const CLEAN_FRACTIONS = [0.25, 0.33, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12];

export function diagnoseRedFlag(
  estimated: MacroEstimateResult,
  official: GroundTruthItem,
  itemName: string,
): { diagnosis: RedFlagDiagnosis; detail: string } {
  const om = official.officialMacros;
  const calRatio = om.calories > 0 ? estimated.calories / om.calories : 0;
  const calError = pctError(estimated.calories, om.calories);

  // Compute macro ratios (avoid division by zero)
  const ratios: number[] = [];
  if (om.proteinG > 0) ratios.push(estimated.proteinG / om.proteinG);
  if (om.carbsG > 0) ratios.push(estimated.carbsG / om.carbsG);
  if (om.fatG > 0) ratios.push(estimated.fatG / om.fatG);

  // SERVING_TYPE: >100% cal error, all macro ratios scaled similarly (within 30%)
  if (calError > 100 && ratios.length >= 2) {
    const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const allSimilar = ratios.every(
      (r) => Math.abs(r - avgRatio) / avgRatio <= 0.3,
    );
    if (allSimilar) {
      const direction = avgRatio > 1 ? "condiment\u2192meal" : "meal\u2192condiment";
      return { diagnosis: "SERVING_TYPE", detail: direction };
    }
  }

  // PORTION_COUNT: countable item name AND ratio close to clean fraction/multiple
  if (COUNTABLE_WORDS.test(itemName) && calRatio > 0) {
    for (const frac of CLEAN_FRACTIONS) {
      if (Math.abs(calRatio - frac) / frac <= 0.15) {
        const estCount = frac;
        const officialCount = 1;
        return {
          diagnosis: "PORTION_COUNT",
          detail: `estimated as ${estCount}x instead of ${officialCount}x`,
        };
      }
    }
  }

  // SERVING_SIZE: 30-100% cal error, macro ratios roughly proportional (within 40%)
  if (calError >= 30 && calError <= 100 && ratios.length >= 2) {
    const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const allProportional = ratios.every(
      (r) => Math.abs(r - avgRatio) / avgRatio <= 0.4,
    );
    if (allProportional) {
      const scale = Math.round(avgRatio * 10) / 10;
      const direction = scale > 1 ? "overestimate" : "underestimate";
      return {
        diagnosis: "SERVING_SIZE",
        detail: `${scale}x ${direction}`,
      };
    }
  }

  // MACRO_RATIO: cal error <15% but some individual macro >40% off
  if (calError < 15) {
    const macroErrors: { name: string; pct: number }[] = [
      { name: "protein", pct: pctError(estimated.proteinG, om.proteinG) },
      { name: "carbs", pct: pctError(estimated.carbsG, om.carbsG) },
      { name: "fat", pct: pctError(estimated.fatG, om.fatG) },
    ];
    const worst = macroErrors.sort((a, b) => b.pct - a.pct)[0]!;
    if (worst.pct > 40) {
      return {
        diagnosis: "MACRO_RATIO",
        detail: `${worst.name} off by ${Math.round(worst.pct)}%`,
      };
    }
  }

  return { diagnosis: "UNKNOWN", detail: "unclassified divergence" };
}

// ─── Find Red Flags ──────────────────────────────────────────────────────────

export function findRedFlags(
  items: EvalItemResult[],
  threshold: number = 15,
): RedFlagItem[] {
  return items
    .filter((item) => item.errors.calories.pct > threshold)
    .map((item) => {
      const { diagnosis, detail } = diagnoseRedFlag(
        item.estimated,
        item.groundTruth,
        item.groundTruth.itemName,
      );
      return {
        id: item.groundTruth.id,
        chain: item.groundTruth.chain,
        itemName: item.groundTruth.itemName,
        officialCalories: item.groundTruth.officialMacros.calories,
        estimatedCalories: item.estimated.calories,
        pctError: item.errors.calories.pct,
        diagnosis,
        diagnosisDetail: detail,
        ...(item.estimated.reasoning !== undefined
          ? { modelReasoning: item.estimated.reasoning }
          : {}),
      };
    })
    .sort((a, b) => b.pctError - a.pctError);
}
