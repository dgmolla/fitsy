import type { ConfidenceLevel } from "@fitsy/shared";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MacroTargets {
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
}

export interface ItemMacros {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: ConfidenceLevel;
}

export interface BestMatchResult {
  menuItemId: string;
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: ConfidenceLevel;
  matchScore: number;
}

export interface ScoredItem {
  menuItemId: string;
  name: string;
  macros: ItemMacros;
  score: number;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Compute the macro match score for a single menu item against user targets.
 *
 * Only dimensions where the user supplied a target are included in the score.
 * Score is a weighted Euclidean distance normalized by target values:
 *
 *   sqrt( (cal_diff/target_cal)^2 + (p_diff/target_p)^2 + ... )
 *
 * Lower score = better match. Perfect match = 0.
 *
 * Returns null when no targets are specified (caller should sort by distance).
 */
export function computeMatchScore(
  targets: MacroTargets,
  macros: ItemMacros,
): number | null {
  const dimensions: Array<{
    target: number | undefined;
    actual: number;
  }> = [
    { target: targets.calories, actual: macros.calories },
    { target: targets.proteinG, actual: macros.proteinG },
    { target: targets.carbsG, actual: macros.carbsG },
    { target: targets.fatG, actual: macros.fatG },
  ];

  const activeDimensions = dimensions.filter(
    (d): d is { target: number; actual: number } =>
      d.target !== undefined && d.target !== null && d.target > 0,
  );

  if (activeDimensions.length === 0) {
    return null;
  }

  const sumOfSquares = activeDimensions.reduce((sum, { target, actual }) => {
    const normalizedDiff = (actual - target) / target;
    return sum + normalizedDiff * normalizedDiff;
  }, 0);

  return Math.sqrt(sumOfSquares);
}

/**
 * Given a list of scored items, return the one with the lowest score.
 * Returns null if the list is empty.
 */
export function bestScoredItem(items: ScoredItem[]): ScoredItem | null {
  if (items.length === 0) return null;

  return items.reduce((best, item) =>
    item.score < best.score ? item : best,
  );
}

/**
 * Check whether any macro targets have been specified by the user.
 */
export function hasTargets(targets: MacroTargets): boolean {
  return (
    targets.calories !== undefined ||
    targets.proteinG !== undefined ||
    targets.carbsG !== undefined ||
    targets.fatG !== undefined
  );
}
