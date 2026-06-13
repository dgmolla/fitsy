/**
 * Macro estimate provenance ranking — the single source of truth for which
 * MacroEstimate "wins" when an item has several.
 *
 * A MenuItem can now have multiple MacroEstimate rows, one per source, since
 * MacroEstimate is keyed by (menuItemId, source). The winner is the
 * highest-trust source available, and its macros are what get denormalized
 * onto MenuItem.{calories,proteinG,carbsG,fatG} and surfaced to users.
 *
 * Trust order (most → least): merchant-verified > FatSecret (structured
 * chain data) > FFN > Haiku (LLM estimate) > anything else / legacy NULL.
 *
 * Two consumers, one ranking:
 *   - TS read paths (getRestaurantMenu, saved-items) call `pickWinningEstimate`.
 *   - Raw SQL (pipeline denormalize, drift audit, backfill) uses
 *     `macroWinnerSqlOrder(alias)` so SQL and TS can never disagree.
 *
 * To add a source, add it here and nowhere else.
 */

/** Lower rank = higher trust = wins. */
export const MACRO_SOURCE_RANK: Readonly<Record<string, number>> = {
  merchant: 0,
  fatsecret: 1,
  ffn: 2,
  haiku: 3,
};

/** Fallback rank for unknown or legacy-NULL sources — always loses. */
export const UNKNOWN_SOURCE_RANK = 99;

export function macroSourceRank(source: string | null | undefined): number {
  if (!source) return UNKNOWN_SOURCE_RANK;
  return MACRO_SOURCE_RANK[source] ?? UNKNOWN_SOURCE_RANK;
}

/**
 * Pick the winning estimate from a list: lowest source rank wins, with the
 * most recent `estimatedAt` breaking ties. Returns null for an empty list.
 * Pure — does not mutate the input.
 */
export function pickWinningEstimate<
  T extends { source?: string | null; estimatedAt?: Date | string | null },
>(estimates: readonly T[]): T | null {
  if (estimates.length === 0) return null;
  return estimates.reduce((best, cur) => {
    const rankBest = macroSourceRank(best.source);
    const rankCur = macroSourceRank(cur.source);
    if (rankCur !== rankBest) return rankCur < rankBest ? cur : best;
    const timeBest = best.estimatedAt ? new Date(best.estimatedAt).getTime() : 0;
    const timeCur = cur.estimatedAt ? new Date(cur.estimatedAt).getTime() : 0;
    return timeCur > timeBest ? cur : best;
  });
}

/**
 * Canonical ORDER BY fragment mirroring `pickWinningEstimate` for raw SQL.
 *
 * Use inside a winner-picking subquery, e.g.:
 *   SELECT DISTINCT ON (e."menuItemId") ...
 *   FROM "MacroEstimate" e
 *   ORDER BY e."menuItemId", ${Prisma.raw(macroWinnerSqlOrder("e"))}
 *
 * `alias` is the table alias for the MacroEstimate row. It is developer-
 * supplied (never user input), so it is safe to interpolate. Keep this
 * CASE list in lockstep with MACRO_SOURCE_RANK above.
 */
export function macroWinnerSqlOrder(alias = "e"): string {
  return (
    `CASE ${alias}.source ` +
    `WHEN 'merchant' THEN 0 ` +
    `WHEN 'fatsecret' THEN 1 ` +
    `WHEN 'ffn' THEN 2 ` +
    `WHEN 'haiku' THEN 3 ` +
    `ELSE ${UNKNOWN_SOURCE_RANK} END ASC, ` +
    `${alias}."estimatedAt" DESC`
  );
}
