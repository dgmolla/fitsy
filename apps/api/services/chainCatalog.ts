import { createHash } from "node:crypto";
import { z } from "zod";
import type { StructuredMenuItem } from "./menuSources/types";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1);
const defaultServing = z.object({
  calorieRange: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  sourceUrl: z.string().url().startsWith("https://"), sourceHash: hash, locator: text,
  selections: z.array(text).min(1),
}).strict().refine(d => d.calorieRange[0] < d.calorieRange[1], "Default range must increase");
const alias = z.object({ name: text, section: z.string().optional(), description: z.string().optional(),
  defaultServing: defaultServing.optional() }).strict();
export const chainReviewSchema = z.object({ version: z.literal(1), sourceHash: hash, locator: z.string().trim().min(1),
  reviewedBy: z.string().trim().min(1), dataHash: hash, aliases: z.array(alias) }).strict();
export type ChainReview = z.infer<typeof chainReviewSchema>;
export interface ChainCatalogRow {
  id: string; brandId: string; canonicalKey: string; servingSize: string | null;
  calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null;
  source: string; confidence: string; officialUrl: string | null; review: unknown;
}
export type ApprovedChainRow = ChainCatalogRow & { calories: number; proteinG: number; carbsG: number; fatG: number; review: ChainReview };
const normalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Preserve parentheses, sizes, components and serving context; only whitespace/case are cosmetic. */
export function chainMenuFingerprint(item: ChainReview["aliases"][number]): string {
  return digest([item.name, item.section ?? "", item.description ?? ""].map(normalize));
}
/** Binds the approval to the complete facts AND aliases, not merely a mutable row ID. */
export function chainReviewHash(row: ChainCatalogRow, review: Omit<ChainReview, "dataHash">): string {
  return digest([row.brandId, row.canonicalKey, row.servingSize, row.calories, row.proteinG, row.carbsG, row.fatG,
    row.source, row.confidence, row.officialUrl, review.version, review.sourceHash, review.locator.trim(), review.reviewedBy.trim(),
    // Keep existing version-1 hashes stable; new option approvals bind every evidence field.
    review.aliases.map(a => a.defaultServing ? digest([chainMenuFingerprint(a), a.defaultServing.calorieRange,
      a.defaultServing.sourceUrl, a.defaultServing.sourceHash, a.defaultServing.locator.trim(), a.defaultServing.selections.map(s => s.trim())]) : chainMenuFingerprint(a)).sort()]);
}
export function approvedChainRow(row: ChainCatalogRow): ApprovedChainRow | null {
  const parsed = chainReviewSchema.safeParse(row.review);
  if (!parsed.success || row.source !== "official" || row.confidence !== "HIGH" || !row.servingSize?.trim()) return null;
  if (!z.string().url().startsWith("https://").safeParse(row.officialUrl).success) return null;
  const macros = [row.calories, row.proteinG, row.carbsG, row.fatG];
  if (macros.some(n => n === null || !Number.isFinite(n) || n < 0) || !Number.isInteger(row.calories)) return null;
  const calories = row.calories!, energy = 4 * row.proteinG! + 4 * row.carbsG! + 9 * row.fatG!;
  if (Math.abs(calories - energy) > Math.max(60, .2 * calories)) return null;
  const aliases = parsed.data.aliases;
  const defaults = new Map<string, string>();
  for (const a of aliases) {
    const key = chainMenuFingerprint(a), evidence = digest(a.defaultServing ?? null);
    // Historical reviews may repeat identical aliases; only contradictory approvals are unsafe.
    if (defaults.has(key) && defaults.get(key) !== evidence) return null;
    defaults.set(key, evidence);
    if (a.defaultServing && (calories < a.defaultServing.calorieRange[0] || calories > a.defaultServing.calorieRange[1])) return null;
  }
  if (chainReviewHash(row, parsed.data) !== parsed.data.dataHash) return null;
  return { ...row, calories, proteinG: row.proteinG!, carbsG: row.carbsG!, fatG: row.fatG!, review: parsed.data };
}
export type ChainMatch = { status: "matched"; row: ApprovedChainRow } | { status: "unmatched" | "ambiguous" };
/** Build once per run. Matching makes no DB, model or network calls. */
export function buildChainMatcher(rows: ChainCatalogRow[]): (brandId: string | undefined, item: StructuredMenuItem) => ChainMatch {
  const index = new Map<string, Map<string, ApprovedChainRow>>();
  for (const input of rows) {
    const row = approvedChainRow(input);
    if (!row) continue;
    for (const inputAlias of row.review.aliases) {
      const key = row.brandId + ":" + chainMenuFingerprint(inputAlias);
      const candidates = index.get(key) ?? new Map<string, ApprovedChainRow>();
      candidates.set(row.id, row); index.set(key, candidates);
    }
  }
  return (brandId, item) => {
    const candidates = index.get(brandId + ":" + chainMenuFingerprint(item));
    if (!candidates?.size) return { status: "unmatched" };
    if (candidates.size !== 1) return { status: "ambiguous" };
    const row = candidates.values().next().value!;
    // Source calorie labels corroborate a serving; estimated DB columns must
    // not be passed as source labels by the April adapter.
    if (item.calorieRange) {
      const approvedDefault = row.review.aliases.find(a => chainMenuFingerprint(a) === chainMenuFingerprint(item))?.defaultServing;
      // A range alone never establishes a default. Approve the exact observed range offline.
      if (!approvedDefault || item.calories !== undefined || item.calorieRange.length !== 2
        || !item.calorieRange.every((n, i) => n === approvedDefault.calorieRange[i])) return { status: "unmatched" };
    } else if ((item.calorieLabel && item.calories === undefined) || (item.calories !== undefined && (!Number.isFinite(item.calories)
      || item.calories < 0 || Math.abs(item.calories - row.calories) > Math.max(30, .05 * row.calories)))) return { status: "unmatched" };
    return { status: "matched", row };
  };
}
