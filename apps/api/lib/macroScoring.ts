import type { ConfidenceLevel } from "@fitsy/shared";

// ─── Types ────────────────────────────────────────────────────────────────────

export { computeMatchScore, hasTargets } from "@fitsy/shared";
export type { MacroTargets } from "@fitsy/shared";

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
 * Given a list of scored items, return the one with the lowest score.
 * Returns null if the list is empty.
 */
export function bestScoredItem(items: ScoredItem[]): ScoredItem | null {
  if (items.length === 0) return null;

  return items.reduce((best, item) =>
    item.score < best.score ? item : best,
  );
}
