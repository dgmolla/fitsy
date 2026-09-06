/**
 * Scoring for the landing page's interactive macro demo. Mirrors the mobile
 * app so the numbers a visitor sees on the site are the numbers the app would
 * show for the same dish and targets:
 *   - computeMatchPct in apps/mobile/app/restaurant/[id].tsx (mean relative
 *     error across the set target dimensions, 100 = perfect fit)
 *   - HIGH / GRAY thresholds in apps/mobile/components/MenuItemCard.tsx
 *
 * Kept as a local copy because apps/api and apps/mobile are separate
 * ownership domains; lifting this into packages/shared is the follow-up.
 */

export type Macros = { p: number; c: number; f: number };

export const HIGH_MATCH_THRESHOLD = 80;
export const GRAY_MATCH_THRESHOLD = 40;

/** Per-dish fit against per-meal protein / carb / fat targets, 0..100. */
export function matchPct(dish: Macros, target: Macros): number {
  const pairs: Array<{ t: number; a: number }> = [
    { t: target.p, a: dish.p },
    { t: target.c, a: dish.c },
    { t: target.f, a: dish.f },
  ];
  const dims = pairs.filter((d) => d.t > 0);
  if (dims.length === 0) return 0;
  const avgError =
    dims.reduce((sum, d) => sum + Math.abs(d.a - d.t) / d.t, 0) / dims.length;
  return Math.max(0, Math.min(100, Math.round((1 - avgError) * 100)));
}

export function matchTier(pct: number): "high" | "mid" | "low" {
  if (pct >= HIGH_MATCH_THRESHOLD) return "high";
  if (pct >= GRAY_MATCH_THRESHOLD) return "mid";
  return "low";
}
