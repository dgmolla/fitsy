import {
  GRAY_MATCH_THRESHOLD,
  HIGH_MATCH_THRESHOLD,
  matchPct,
  matchTier,
} from "./landingDemo";

// Default per-meal targets from the app screenshots used on the landing page.
const TARGET = { p: 49, c: 73, f: 18 };

describe("matchPct", () => {
  it("reproduces the app's percentages for the landing demo dishes", () => {
    // Values the mobile app shows for these dishes at 49/73/18
    // (computeMatchPct in apps/mobile/app/restaurant/[id].tsx).
    expect(matchPct({ p: 45, c: 67, f: 16 }, TARGET)).toBe(91);
    expect(matchPct({ p: 14, c: 63, f: 18 }, TARGET)).toBe(72);
  });

  it("is 100 for an exact fit", () => {
    expect(matchPct(TARGET, TARGET)).toBe(100);
  });

  it("clamps to 0 when a dish is wildly off target", () => {
    expect(matchPct({ p: 400, c: 600, f: 200 }, TARGET)).toBe(0);
  });

  it("ignores dimensions whose target is unset (0)", () => {
    // Only protein counts: 45 vs 49 → 1 - 4/49 = 91.8 → 92
    expect(matchPct({ p: 45, c: 999, f: 999 }, { p: 49, c: 0, f: 0 })).toBe(92);
  });

  it("returns 0 when no target dimension is set", () => {
    expect(matchPct({ p: 45, c: 67, f: 16 }, { p: 0, c: 0, f: 0 })).toBe(0);
  });
});

describe("matchTier", () => {
  it("uses the app's badge thresholds", () => {
    expect(matchTier(HIGH_MATCH_THRESHOLD)).toBe("high");
    expect(matchTier(HIGH_MATCH_THRESHOLD - 1)).toBe("mid");
    expect(matchTier(GRAY_MATCH_THRESHOLD)).toBe("mid");
    expect(matchTier(GRAY_MATCH_THRESHOLD - 1)).toBe("low");
  });
});
