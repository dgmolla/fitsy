import {
  computeItemMetrics,
  computeAggregateMetrics,
  computeConfidenceCalibration,
  computePerChainBreakdown,
  findRedFlags,
  diagnoseRedFlag,
  median,
} from "./metrics";
import {
  EvalItemResult,
  MacroEstimateResult,
  GroundTruthItem,
} from "./types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeEstimate(
  overrides: Partial<MacroEstimateResult> = {},
): MacroEstimateResult {
  return {
    calories: 500,
    proteinG: 30,
    carbsG: 50,
    fatG: 20,
    confidence: "HIGH",
    reasoning: "test reasoning",
    inputTokens: 100,
    outputTokens: 50,
    latencyMs: 200,
    costUsd: 0.001,
    ...overrides,
  };
}

function makeGroundTruth(
  overrides: {
    id?: string;
    chain?: string;
    itemName?: string;
    description?: string;
    category?: string;
    servingSize?: string;
    source?: string;
    tags?: string[];
    officialMacros?: {
      calories?: number;
      proteinG?: number;
      carbsG?: number;
      fatG?: number;
    };
  } = {},
): GroundTruthItem {
  const { officialMacros, ...rest } = overrides;
  return {
    id: "test-1",
    chain: "TestChain",
    itemName: "Test Burger",
    source: "website",
    ...rest,
    officialMacros: {
      calories: 500,
      proteinG: 30,
      carbsG: 50,
      fatG: 20,
      ...(officialMacros ?? {}),
    },
  };
}

function makeItem(
  estimateOverrides: Partial<MacroEstimateResult> = {},
  gtOverrides: Parameters<typeof makeGroundTruth>[0] = {},
): EvalItemResult {
  return computeItemMetrics(
    makeEstimate(estimateOverrides),
    makeGroundTruth(gtOverrides),
  );
}

// ─── median helper ───────────────────────────────────────────────────────────

describe("median", () => {
  it("returns 0 for empty array", () => {
    expect(median([])).toBe(0);
  });

  it("returns the middle value for odd-length array", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("returns the average of two middle values for even-length array", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

// ─── computeItemMetrics ──────────────────────────────────────────────────────

describe("computeItemMetrics", () => {
  it("computes correct errors for known values", () => {
    const estimated = makeEstimate({ calories: 550, proteinG: 36, carbsG: 45, fatG: 22 });
    const gt = makeGroundTruth({
      officialMacros: { calories: 500, proteinG: 30, carbsG: 50, fatG: 20 },
    });

    const result = computeItemMetrics(estimated, gt);

    // Calories: |550-500| = 50, 50/500*100 = 10%, signed = +10%
    expect(result.errors.calories.absolute).toBe(50);
    expect(result.errors.calories.pct).toBe(10);
    expect(result.errors.calories.signed).toBe(10);

    // Protein: |36-30| = 6, 6/30*100 = 20%, signed = +20%
    expect(result.errors.proteinG.absolute).toBe(6);
    expect(result.errors.proteinG.pct).toBe(20);
    expect(result.errors.proteinG.signed).toBe(20);

    // Carbs: |45-50| = 5, 5/50*100 = 10%, signed = -10%
    expect(result.errors.carbsG.absolute).toBe(5);
    expect(result.errors.carbsG.pct).toBe(10);
    expect(result.errors.carbsG.signed).toBe(-10);

    // Fat: |22-20| = 2, 2/20*100 = 10%, signed = +10%
    expect(result.errors.fatG.absolute).toBe(2);
    expect(result.errors.fatG.pct).toBe(10);
    expect(result.errors.fatG.signed).toBe(10);
  });

  it("handles division by zero when official is 0", () => {
    const estimated = makeEstimate({ calories: 50 });
    const gt = makeGroundTruth({ officialMacros: { calories: 0 } });
    const result = computeItemMetrics(estimated, gt);

    expect(result.errors.calories.pct).toBe(100);
    expect(result.errors.calories.signed).toBe(100);
  });

  it("returns 0 pct error when both estimated and official are 0", () => {
    const estimated = makeEstimate({ calories: 0 });
    const gt = makeGroundTruth({ officialMacros: { calories: 0 } });
    const result = computeItemMetrics(estimated, gt);

    expect(result.errors.calories.pct).toBe(0);
    expect(result.errors.calories.signed).toBe(0);
  });
});

// ─── computeAggregateMetrics ─────────────────────────────────────────────────

describe("computeAggregateMetrics", () => {
  it("computes median, mean, P90 for a fixed set of 5 items", () => {
    // Create 5 items with known calorie pct errors: 5%, 10%, 15%, 20%, 25%
    const items: EvalItemResult[] = [
      makeItem(
        { calories: 525 },
        { id: "a1", officialMacros: { calories: 500 } },
      ), // 5%
      makeItem(
        { calories: 550 },
        { id: "a2", officialMacros: { calories: 500 } },
      ), // 10%
      makeItem(
        { calories: 575 },
        { id: "a3", officialMacros: { calories: 500 } },
      ), // 15%
      makeItem(
        { calories: 600 },
        { id: "a4", officialMacros: { calories: 500 } },
      ), // 20%
      makeItem(
        { calories: 625 },
        { id: "a5", officialMacros: { calories: 500 } },
      ), // 25%
    ];

    const agg = computeAggregateMetrics(items);

    // Median of [5,10,15,20,25] = 15
    expect(agg.calories.medianAbsPctError).toBe(15);
    // Mean of [5,10,15,20,25] = 15
    expect(agg.calories.meanAbsPctError).toBe(15);
    // P90: index = floor(5*0.9) = 4 → 25
    expect(agg.calories.p90AbsPctError).toBe(25);
    // All positive signed errors, median = 15
    expect(agg.calories.medianSignedPctError).toBe(15);
  });

  it("computes correct median signed error with mixed signs", () => {
    const items: EvalItemResult[] = [
      makeItem(
        { calories: 450 },
        { id: "b1", officialMacros: { calories: 500 } },
      ), // signed: -10%
      makeItem(
        { calories: 550 },
        { id: "b2", officialMacros: { calories: 500 } },
      ), // signed: +10%
      makeItem(
        { calories: 400 },
        { id: "b3", officialMacros: { calories: 500 } },
      ), // signed: -20%
    ];

    const agg = computeAggregateMetrics(items);

    // signed errors: [-20, -10, 10] → median = -10
    expect(agg.calories.medianSignedPctError).toBe(-10);
  });
});

// ─── diagnoseRedFlag ─────────────────────────────────────────────────────────

describe("diagnoseRedFlag", () => {
  it("classifies SERVING_TYPE when all macros scale uniformly >100% error", () => {
    // All ratios ~3.5x: p=35/10=3.5, c=70/20=3.5, f=28/8=3.5
    const estimated = makeEstimate({
      calories: 350,
      proteinG: 35,
      carbsG: 70,
      fatG: 28,
    });
    const gt = makeGroundTruth({
      officialMacros: { calories: 100, proteinG: 10, carbsG: 20, fatG: 8 },
    });

    const { diagnosis, detail } = diagnoseRedFlag(estimated, gt, "Side Sauce");

    expect(diagnosis).toBe("SERVING_TYPE");
    // estimated > official → condiment→meal
    expect(detail).toContain("condiment");
  });

  it("classifies PORTION_COUNT for countable items near clean fraction", () => {
    // estimated 190 vs official 250 → ratio ~0.76, but we need it close to
    // a clean fraction. Let's use estimated 125 vs official 250 → ratio 0.5
    const estimated = makeEstimate({
      calories: 125,
      proteinG: 8,
      carbsG: 10,
      fatG: 5,
    });
    const gt = makeGroundTruth({
      itemName: "8pc Nuggets",
      officialMacros: { calories: 250, proteinG: 16, carbsG: 20, fatG: 10 },
    });

    const { diagnosis, detail } = diagnoseRedFlag(
      estimated,
      gt,
      "8pc Nuggets",
    );

    expect(diagnosis).toBe("PORTION_COUNT");
    expect(detail).toContain("0.5x");
  });

  it("classifies SERVING_SIZE for 30-100% proportional error", () => {
    // ~1.6x proportional scale: cal error = 60%, ratios all ~1.6x
    const estimated = makeEstimate({
      calories: 480,
      proteinG: 48,
      carbsG: 48,
      fatG: 16,
    });
    const gt = makeGroundTruth({
      officialMacros: { calories: 300, proteinG: 30, carbsG: 30, fatG: 10 },
    });

    const { diagnosis, detail } = diagnoseRedFlag(
      estimated,
      gt,
      "Grilled Chicken Wrap",
    );

    expect(diagnosis).toBe("SERVING_SIZE");
    expect(detail).toContain("overestimate");
  });

  it("classifies MACRO_RATIO when cal matches but a macro is way off", () => {
    const estimated = makeEstimate({
      calories: 420,
      proteinG: 41,
      carbsG: 39,
      fatG: 17,
    });
    const gt = makeGroundTruth({
      officialMacros: { calories: 420, proteinG: 29, carbsG: 41, fatG: 18 },
    });

    const { diagnosis, detail } = diagnoseRedFlag(
      estimated,
      gt,
      "Chicken Bowl",
    );

    expect(diagnosis).toBe("MACRO_RATIO");
    // protein: |41-29|/29*100 = ~41%
    expect(detail).toContain("protein");
  });

  it("classifies UNKNOWN for unstructured divergence", () => {
    // Random divergence: cal error ~33%, but macros not proportional
    const estimated = makeEstimate({
      calories: 400,
      proteinG: 50,
      carbsG: 10,
      fatG: 30,
    });
    const gt = makeGroundTruth({
      officialMacros: { calories: 300, proteinG: 10, carbsG: 50, fatG: 5 },
    });

    const { diagnosis, detail } = diagnoseRedFlag(
      estimated,
      gt,
      "Mystery Platter",
    );

    expect(diagnosis).toBe("UNKNOWN");
    expect(detail).toBe("unclassified divergence");
  });
});

// ─── findRedFlags ────────────────────────────────────────────────────────────

describe("findRedFlags", () => {
  it("filters items above threshold and sorts by error descending", () => {
    const items: EvalItemResult[] = [
      makeItem(
        { calories: 510 },
        { id: "rf1", itemName: "Low Error", officialMacros: { calories: 500 } },
      ), // 2% — below threshold
      makeItem(
        { calories: 600 },
        { id: "rf2", itemName: "Medium Error", officialMacros: { calories: 500 } },
      ), // 20%
      makeItem(
        { calories: 750 },
        { id: "rf3", itemName: "High Error", officialMacros: { calories: 500 } },
      ), // 50%
    ];

    const flags = findRedFlags(items, 15);

    expect(flags).toHaveLength(2);
    // Sorted descending by pctError
    expect(flags[0]!.id).toBe("rf3");
    expect(flags[0]!.pctError).toBe(50);
    expect(flags[1]!.id).toBe("rf2");
    expect(flags[1]!.pctError).toBe(20);
  });

  it("uses default threshold of 15", () => {
    const items: EvalItemResult[] = [
      makeItem(
        { calories: 570 },
        { id: "d1", officialMacros: { calories: 500 } },
      ), // 14% — below default
      makeItem(
        { calories: 580 },
        { id: "d2", officialMacros: { calories: 500 } },
      ), // 16% — above default
    ];

    const flags = findRedFlags(items);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.id).toBe("d2");
  });
});

// ─── computeConfidenceCalibration ────────────────────────────────────────────

describe("computeConfidenceCalibration", () => {
  it("groups items by confidence and computes median cal error", () => {
    const items: EvalItemResult[] = [
      makeItem(
        { calories: 550, confidence: "HIGH" },
        { id: "c1", officialMacros: { calories: 500 } },
      ), // 10%
      makeItem(
        { calories: 575, confidence: "HIGH" },
        { id: "c2", officialMacros: { calories: 500 } },
      ), // 15%
      makeItem(
        { calories: 600, confidence: "MEDIUM" },
        { id: "c3", officialMacros: { calories: 500 } },
      ), // 20%
      makeItem(
        { calories: 400, confidence: "LOW" },
        { id: "c4", officialMacros: { calories: 500 } },
      ), // 20%
    ];

    const cal = computeConfidenceCalibration(items);

    const high = cal.find((c) => c.confidence === "HIGH");
    expect(high).toBeDefined();
    expect(high!.count).toBe(2);
    expect(high!.medianCalError).toBe(12.5); // median of [10, 15]

    const med = cal.find((c) => c.confidence === "MEDIUM");
    expect(med).toBeDefined();
    expect(med!.count).toBe(1);
    expect(med!.medianCalError).toBe(20);

    const low = cal.find((c) => c.confidence === "LOW");
    expect(low).toBeDefined();
    expect(low!.count).toBe(1);
    expect(low!.medianCalError).toBe(20);
  });

  it("omits confidence levels with no items", () => {
    const items: EvalItemResult[] = [
      makeItem(
        { calories: 550, confidence: "HIGH" },
        { id: "c5", officialMacros: { calories: 500 } },
      ),
    ];

    const cal = computeConfidenceCalibration(items);
    expect(cal).toHaveLength(1);
    expect(cal[0]!.confidence).toBe("HIGH");
  });
});

// ─── computePerChainBreakdown ────────────────────────────────────────────────

describe("computePerChainBreakdown", () => {
  it("groups items by chain and computes median cal error", () => {
    const items: EvalItemResult[] = [
      makeItem(
        { calories: 550 },
        { id: "ch1", chain: "McDonalds", officialMacros: { calories: 500 } },
      ), // 10%
      makeItem(
        { calories: 600 },
        { id: "ch2", chain: "McDonalds", officialMacros: { calories: 500 } },
      ), // 20%
      makeItem(
        { calories: 525 },
        { id: "ch3", chain: "Chipotle", officialMacros: { calories: 500 } },
      ), // 5%
    ];

    const chains = computePerChainBreakdown(items);

    expect(chains).toHaveLength(2);

    const chipotle = chains.find((c) => c.chain === "Chipotle");
    expect(chipotle).toBeDefined();
    expect(chipotle!.count).toBe(1);
    expect(chipotle!.medianCalError).toBe(5);

    const mcdonalds = chains.find((c) => c.chain === "McDonalds");
    expect(mcdonalds).toBeDefined();
    expect(mcdonalds!.count).toBe(2);
    expect(mcdonalds!.medianCalError).toBe(15); // median of [10, 20]
  });

  it("sorts chains alphabetically", () => {
    const items: EvalItemResult[] = [
      makeItem({ calories: 550 }, { id: "s1", chain: "Zaxby's" }),
      makeItem({ calories: 550 }, { id: "s2", chain: "Arby's" }),
    ];

    const chains = computePerChainBreakdown(items);
    expect(chains[0]!.chain).toBe("Arby's");
    expect(chains[1]!.chain).toBe("Zaxby's");
  });
});
