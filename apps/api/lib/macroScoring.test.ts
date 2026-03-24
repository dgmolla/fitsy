import {
  computeMatchScore,
  bestScoredItem,
  hasTargets,
  type MacroTargets,
  type ItemMacros,
  type ScoredItem,
} from "./macroScoring";
import type { ConfidenceLevel } from "@fitsy/shared";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const HIGH: ConfidenceLevel = "HIGH";
const MEDIUM: ConfidenceLevel = "MEDIUM";
const LOW: ConfidenceLevel = "LOW";

function makeMacros(
  overrides: Partial<ItemMacros> = {},
): ItemMacros {
  return {
    calories: 600,
    proteinG: 40,
    carbsG: 60,
    fatG: 20,
    confidence: HIGH,
    ...overrides,
  };
}

// ─── computeMatchScore ────────────────────────────────────────────────────────

describe("computeMatchScore", () => {
  describe("happy path", () => {
    it("returns correct score for all four dimensions", () => {
      const targets: MacroTargets = {
        calories: 600,
        proteinG: 40,
        carbsG: 60,
        fatG: 20,
      };
      // item: cal=660, p=44, c=66, f=22
      // normalized diffs: 0.1, 0.1, 0.1, 0.1
      // score = sqrt(4 * 0.01) = sqrt(0.04) = 0.2
      const macros = makeMacros({
        calories: 660,
        proteinG: 44,
        carbsG: 66,
        fatG: 22,
      });
      const score = computeMatchScore(targets, macros);
      expect(score).not.toBeNull();
      expect(score).toBeCloseTo(0.2, 5);
    });

    it("returns a non-negative number", () => {
      const targets: MacroTargets = { calories: 500, proteinG: 30 };
      const macros = makeMacros({ calories: 400, proteinG: 20 });
      const score = computeMatchScore(targets, macros);
      expect(score).not.toBeNull();
      expect(score!).toBeGreaterThanOrEqual(0);
    });
  });

  describe("perfect match", () => {
    it("returns 0 when item exactly matches all specified targets", () => {
      const targets: MacroTargets = {
        calories: 600,
        proteinG: 40,
        carbsG: 60,
        fatG: 20,
      };
      const macros = makeMacros(); // defaults match targets exactly
      const score = computeMatchScore(targets, macros);
      expect(score).toBe(0);
    });

    it("returns 0 for single dimension perfect match", () => {
      const targets: MacroTargets = { proteinG: 40 };
      const macros = makeMacros({ proteinG: 40 });
      const score = computeMatchScore(targets, macros);
      expect(score).toBe(0);
    });
  });

  describe("only specified dimensions are used", () => {
    it("ignores calories when only protein is specified", () => {
      const targets: MacroTargets = { proteinG: 40 };
      // calories differ wildly — should not affect score
      const macrosA = makeMacros({ calories: 200, proteinG: 40 });
      const macrosB = makeMacros({ calories: 1000, proteinG: 40 });
      const scoreA = computeMatchScore(targets, macrosA);
      const scoreB = computeMatchScore(targets, macrosB);
      expect(scoreA).toBe(scoreB);
    });

    it("uses only two dimensions when two targets specified", () => {
      const targets: MacroTargets = { calories: 600, proteinG: 40 };
      // cal_diff = 60/600 = 0.1; p_diff = 4/40 = 0.1
      // score = sqrt(0.01 + 0.01) = sqrt(0.02)
      const macros = makeMacros({ calories: 660, proteinG: 44 });
      const score = computeMatchScore(targets, macros);
      expect(score).toBeCloseTo(Math.sqrt(0.02), 5);
    });

    it("single dimension only — calories", () => {
      const targets: MacroTargets = { calories: 500 };
      const macros = makeMacros({ calories: 600 });
      // diff = 100/500 = 0.2; score = sqrt(0.04) = 0.2
      const score = computeMatchScore(targets, macros);
      expect(score).toBeCloseTo(0.2, 5);
    });
  });

  describe("returns null when no targets specified", () => {
    it("returns null for empty targets object", () => {
      const targets: MacroTargets = {};
      const macros = makeMacros();
      expect(computeMatchScore(targets, macros)).toBeNull();
    });

    it("returns null when no target fields are set (empty object)", () => {
      // exactOptionalPropertyTypes: can't assign undefined to optional number keys
      const targets: MacroTargets = {};
      const macros = makeMacros();
      expect(computeMatchScore(targets, macros)).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("handles item macros all zero (target > 0)", () => {
      const targets: MacroTargets = { calories: 600, proteinG: 40 };
      const macros = makeMacros({ calories: 0, proteinG: 0 });
      // diff = -600/600 = -1; p_diff = -40/40 = -1
      // score = sqrt(1 + 1) = sqrt(2)
      const score = computeMatchScore(targets, macros);
      expect(score).toBeCloseTo(Math.sqrt(2), 5);
    });

    it("ignores target dimensions where target value is 0", () => {
      // A target of 0 would cause division by zero — should be skipped
      const targets: MacroTargets = { calories: 0, proteinG: 40 };
      const macros = makeMacros({ calories: 999, proteinG: 40 });
      // Only proteinG used; perfect match → score = 0
      const score = computeMatchScore(targets, macros);
      expect(score).toBe(0);
    });

    it("lower score is a better match than higher score", () => {
      const targets: MacroTargets = { calories: 600 };
      const closeItem = makeMacros({ calories: 620 }); // diff = 20/600 ≈ 0.033
      const farItem = makeMacros({ calories: 900 }); // diff = 300/600 = 0.5
      const closeScore = computeMatchScore(targets, closeItem);
      const farScore = computeMatchScore(targets, farItem);
      expect(closeScore).not.toBeNull();
      expect(farScore).not.toBeNull();
      expect(closeScore!).toBeLessThan(farScore!);
    });
  });
});

// ─── bestScoredItem ───────────────────────────────────────────────────────────

describe("bestScoredItem", () => {
  function makeScored(
    id: string,
    score: number,
    confidence: ConfidenceLevel = HIGH,
  ): ScoredItem {
    return {
      menuItemId: id,
      name: `Item ${id}`,
      macros: makeMacros({ confidence }),
      score,
    };
  }

  it("returns null for empty array", () => {
    expect(bestScoredItem([])).toBeNull();
  });

  it("returns the single item in a single-element array", () => {
    const item = makeScored("a", 0.5);
    expect(bestScoredItem([item])).toBe(item);
  });

  it("returns the item with the lowest score", () => {
    const items = [
      makeScored("a", 0.8),
      makeScored("b", 0.2),
      makeScored("c", 0.5),
    ];
    const best = bestScoredItem(items);
    expect(best?.menuItemId).toBe("b");
  });

  it("returns the first encountered item on tie (stable)", () => {
    const items = [
      makeScored("a", 0.3),
      makeScored("b", 0.3),
    ];
    const best = bestScoredItem(items);
    expect(best?.menuItemId).toBe("a");
  });

  it("returns item with score 0 (perfect match)", () => {
    const items = [makeScored("perfect", 0), makeScored("good", 0.1)];
    const best = bestScoredItem(items);
    expect(best?.menuItemId).toBe("perfect");
  });
});

// ─── hasTargets ───────────────────────────────────────────────────────────────

describe("hasTargets", () => {
  it("returns false for empty targets", () => {
    expect(hasTargets({})).toBe(false);
  });

  it("returns false for object with no set fields", () => {
    // exactOptionalPropertyTypes prevents explicit undefined assignment
    const targets: MacroTargets = {};
    expect(hasTargets(targets)).toBe(false);
  });

  it("returns true when calories is set", () => {
    expect(hasTargets({ calories: 600 })).toBe(true);
  });

  it("returns true when proteinG is set", () => {
    expect(hasTargets({ proteinG: 40 })).toBe(true);
  });

  it("returns true when carbsG is set", () => {
    expect(hasTargets({ carbsG: 60 })).toBe(true);
  });

  it("returns true when fatG is set", () => {
    expect(hasTargets({ fatG: 20 })).toBe(true);
  });

  it("returns true when multiple targets set", () => {
    expect(hasTargets({ calories: 500, proteinG: 30 })).toBe(true);
  });
});

// ─── ConfidenceLevel enum values ──────────────────────────────────────────────

describe("ConfidenceLevel handling", () => {
  const confidenceLevels: ConfidenceLevel[] = [HIGH, MEDIUM, LOW];

  it("all ConfidenceLevel values are preserved through makeMacros", () => {
    for (const confidence of confidenceLevels) {
      const macros = makeMacros({ confidence });
      expect(macros.confidence).toBe(confidence);
    }
  });

  it("ConfidenceLevel does not affect match score computation", () => {
    const targets: MacroTargets = { calories: 600, proteinG: 40 };
    const scores = confidenceLevels.map((confidence) => {
      const macros = makeMacros({ calories: 660, proteinG: 44, confidence });
      return computeMatchScore(targets, macros);
    });
    // All scores should be identical regardless of confidence
    expect(scores[0]).toBeCloseTo(scores[1]!, 10);
    expect(scores[1]).toBeCloseTo(scores[2]!, 10);
  });

  it("HIGH confidence is a valid ConfidenceLevel", () => {
    expect(HIGH).toBe("HIGH");
  });

  it("MEDIUM confidence is a valid ConfidenceLevel", () => {
    expect(MEDIUM).toBe("MEDIUM");
  });

  it("LOW confidence is a valid ConfidenceLevel", () => {
    expect(LOW).toBe("LOW");
  });
});
