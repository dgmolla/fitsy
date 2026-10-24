/**
 * Shared pipeline utilities used by preload.ts and rerun.ts.
 *
 * Extracted to avoid duplication across pipeline scripts (S-130).
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  MacroData,
  StructuredMenuItem,
} from "../apps/api/services/menuSources/types.js";
import { aggregateDietaryOptions, DIETARY_TAG_THRESHOLD } from "./constants.js";
// Keep offline persistence independent of the shared barrel's environment initialization.
import { macroWinnerSqlOrder } from "../packages/shared/src/utils/macroProvenance";
import { validateReviewedChainWrites } from '../apps/api/services/chainWriteGuard';
import { chainTransaction } from '../apps/api/services/chainTransaction';
import { decodeMenuText, menuItemIdentity, sourceItemId } from '../apps/api/services/menuSources/menuItemIdentity';
import { resolveMenuItemIds, retireMissingMenuItems } from './menu-item-identity';

// ─── Item validation (S-111, S-112) ─────────────────────────────────────────

export const NON_FOOD_PATTERNS = /\b(t-?shirt|tee|hoodie|sweatshirt|hat|cap|beanie|mug|tumbler|bag|tote|merch|sticker|poster|gift\s*card|apron)\b/i;
// A counted cookie order uses "tote" as its package; merchandise sections still reject it.
const COUNTED_COOKIE_TOTE_PATTERN = /^\s*[1-9]\d*\s+cookies?\s+tote\s*$/i;
export const UTENSIL_PATTERNS = /\b(chopsticks?|forks?|spoons?|knife|knives|napkins?|straws?|containers?|lids?|cup\s*sleeves?|utensils?|stir\s*sticks?|stirrers?)\b/i;
// Match standalone contributions, not meals whose names or descriptions mention charity.
const DONATION_PATTERN = /^\s*(?:round[\s-]+up\s+)?(?:toy\s+)?donation(?:\s+\$\s*\d+(?:\.\d{1,2})?)?\s*$/i;
const NON_FOOD_SECTION_CATEGORY = "(?:utensils?|cutlery|paper\\s+(?:goods|supplies)|merchandise|drinkware|apparel)";
// Require the entire section to describe non-food goods; mixed food sections stay eligible.
const NON_FOOD_SECTION_PATTERN = new RegExp(`^\\s*${NON_FOOD_SECTION_CATEGORY}(?:\\s*(?:and|[&/+,|])\\s*${NON_FOOD_SECTION_CATEGORY})*\\s*$`, "i");
export const CONDIMENT_PATTERNS = /\b(packet|sauce\s*cup|dressing\s*packet|ketchup|mustard|mayo|soy\s*sauce|hot\s*sauce|salt|pepper|sugar|cream|sweetener|butter\s*pat|jam|jelly|syrup|relish|vinegar|dipping\s*sauce)\b/i;
const CONDIMENT_SECTION_EXCEPTIONS = /\b(sauce|butter|mayonnaise)\b/i;
const BEVERAGE_PATTERNS = /\b(water|soda|juice|tea|coffee|lemonade|drink|beverage|sparkling|kombucha|milk|shake|smoothie)\b/i;
// Brand-only drink titles need a complete match so branded food or merchandise is not exempted.
const PEPSI_BEVERAGE_PATTERN = /^\s*(?:\d+(?:\.\d+)?\s*(?:fl\.?\s*)?oz\.?\s*)?(?:diet\s+pepsi|pepsi(?:\s+zero(?:\s+sugar)?)?)[®™]?(?:\s+(?:can|bottle))?\s*$/i;

export interface RejectedItem {
  name: string;
  reason: string;
}

export interface ValidatedPair {
  item: StructuredMenuItem;
  macro: MacroData;
}

export interface MacroMismatchItem {
  name: string;
  calories: number;
  calculatedCalories: number;
  percentDelta: number;
}

/**
 * Check if a macro estimate has a significant calorie mismatch (S-121).
 * |calories - (p*4 + c*4 + f*9)| > 20% of calories.
 */
export function checkMacroMismatch(macro: MacroData): MacroMismatchItem | null {
  if (macro.calories === 0) return null;
  const calculated = macro.proteinG * 4 + macro.carbsG * 4 + macro.fatG * 9;
  const delta = Math.abs(macro.calories - calculated);
  const percentDelta = (delta / macro.calories) * 100;
  if (percentDelta > 20) {
    return { name: "", calories: macro.calories, calculatedCalories: Math.round(calculated), percentDelta: Math.round(percentDelta) };
  }
  return null;
}

export function validateItems(
  items: StructuredMenuItem[],
  macros: (MacroData | null)[],
): { valid: ValidatedPair[]; rejected: RejectedItem[]; macroMismatches: MacroMismatchItem[] } {
  const valid: ValidatedPair[] = [];
  const rejected: RejectedItem[] = [];
  const macroMismatches: MacroMismatchItem[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const macro = macros[i];
    if (!item || !macro) continue;

    const name = item.name;
    const isPepsiBeverage = PEPSI_BEVERAGE_PATTERN.test(name);

    // S-111: Non-food items
    if (DONATION_PATTERN.test(name)) {
      rejected.push({ name, reason: "non-food: donation" });
      continue;
    }
    if (NON_FOOD_PATTERNS.test(name) && !COUNTED_COOKIE_TOTE_PATTERN.test(name)) {
      rejected.push({ name, reason: "non-food: merchandise" });
      continue;
    }
    if (UTENSIL_PATTERNS.test(name)) {
      rejected.push({ name, reason: "non-food: utensil" });
      continue;
    }
    // Some menus place edible condiments under Utensils; preserve their calorie-based rule below.
    if (NON_FOOD_SECTION_PATTERN.test(item.section ?? "")
      && !CONDIMENT_PATTERNS.test(name) && !CONDIMENT_SECTION_EXCEPTIONS.test(name)) {
      rejected.push({ name, reason: "non-food: supply or merchandise section" });
      continue;
    }

    // S-111: Zero-cal non-beverage items
    if (macro.calories === 0 && !BEVERAGE_PATTERNS.test(name) && !isPepsiBeverage) {
      rejected.push({ name, reason: "non-food: zero calories" });
      continue;
    }

    // S-112: Condiments (cal < 30 AND condiment pattern)
    if (macro.calories < 30 && CONDIMENT_PATTERNS.test(name) && !isPepsiBeverage) {
      rejected.push({ name, reason: "condiment" });
      continue;
    }

    // S-121: Macro math validation (flag only, do not reject)
    const mismatch = checkMacroMismatch(macro);
    if (mismatch) {
      mismatch.name = name;
      macroMismatches.push(mismatch);
    }

    valid.push({ item, macro });
  }

  return { valid, rejected, macroMismatches };
}

// ─── Name mismatch detection (S-118) ────────────────────────────────────────

/**
 * Fuzzy check whether two restaurant names are a match.
 * Returns true if the names are sufficiently similar.
 *
 * Strategy: compare significant words (length > 2). If at least half of
 * the expected words appear in the found name, consider it a match.
 * Also handles exact substring containment.
 */
export function namesMatch(expected: string, found: string): boolean {
  const e = expected.toLowerCase().trim();
  const f = found.toLowerCase().trim();

  // Exact match
  if (e === f) return true;

  // Substring containment
  if (f.includes(e) || e.includes(f)) return true;

  // Word overlap: at least half of significant words match
  const expectedWords = e.split(/\s+/).filter((w) => w.length > 2);
  if (expectedWords.length === 0) return true;
  const matchCount = expectedWords.filter((w) => f.includes(w)).length;
  return matchCount >= Math.ceil(expectedWords.length / 2);
}

// ─── HTML entity decode ─────────────────────────────────────────────────────

export const decodeHtml = decodeMenuText;

// ─── Dedup (S-133) ─────────────────────────────────────────────────────────

/** Keep one occurrence per source product, falling back to decoded, case-insensitive names. */
export function dedupByIdentity(pairs: ValidatedPair[]): ValidatedPair[] {
  const seen = new Set<string>();
  return pairs.filter(p => {
    const key = menuItemIdentity(p.item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Transactional persistence (S-113) ──────────────────────────────────────

/** Minimal type for Prisma interactive transaction client. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TxClient = any;

/**
 * Persist a restaurant's items inside an existing transaction context.
 * Single-restaurant writer; the bulk hex writer uses the same identity resolver.
 *
 * Resolve source product identity (or name fallback) to a stable Fitsy ID.
 * Unique exact legacy serving contexts are adopted in place; ambiguity is retired,
 * preserving saved/logged references without guessing a source binding.
 * Change 2 (provenance): upsert MacroEstimate by (menuItemId, source) so each
 * source keeps its own row. After upserting, recompute MenuItem macro columns
 * from the winning estimate so a lower-trust run never clobbers a higher-trust
 * one.
 */
export async function persistItemsInTx(
  restaurantId: string,
  inputPairs: ValidatedPair[],
  tx: TxClient,
): Promise<number> {
  if (inputPairs.length === 0) return 0;

  // Repeated placements of one source product share a row; distinct products do not.
  const validPairs = dedupByIdentity(inputPairs);
  await validateReviewedChainWrites(tx, [{ restaurantId, items: validPairs }]);
  if (validPairs.length < inputPairs.length) {
    console.log(`[persist] Deduped ${inputPairs.length - validPairs.length} duplicate product identities for restaurant ${restaurantId}`); // eslint-disable-line no-console
  }

  // Build all input arrays upfront.
  const names = validPairs.map((p) => decodeHtml(p.item.name)!);
  const descriptions = validPairs.map((p) => decodeHtml(p.item.description) ?? null);
  const categories = validPairs.map((p) => decodeHtml(p.item.category) ?? null);
  const sections = validPairs.map((p) => decodeHtml(p.item.section) ?? null);
  const prices = validPairs.map((p) => p.item.price ?? null);
  const dietaryTagsJson = validPairs.map((p) => JSON.stringify(p.macro.dietaryTags ?? []));
  const calories = validPairs.map((p) => Math.round(p.macro.calories));
  const proteins = validPairs.map((p) => p.macro.proteinG);
  const carbs = validPairs.map((p) => p.macro.carbsG);
  const fats = validPairs.map((p) => p.macro.fatG);
  const confidences = validPairs.map((p) => p.macro.confidence);
  // COALESCE source to 'llm' defensively for any legacy NULL values.
  const sources = validPairs.map((p) => p.macro.source ?? "llm");
  const reasonings = validPairs.map(p => p.macro.reasoning ?? null);
  // Candidate IDs for new rows — on conflict the existing id is preserved.
  const candidateIds = await resolveMenuItemIds(validPairs.map(p => ({ restaurantId, item: p.item })), tx);
  const sourceItemIds = validPairs.map(p => sourceItemId(p.item));
  // Retire unclaimed fallback names before an adopted row can take that display name.
  // The caller's transaction rolls this back together with a failed item write.
  await retireMissingMenuItems([restaurantId], candidateIds, tx);

  // Established source products and safely adopted legacy rows retain their Fitsy IDs.
  // Official facts preserve dietary tags; winner recomputation follows every upsert.
  const menuItemRows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "MenuItem" (
      "id", "restaurantId", "sourceItemId", "name", "description", "category", "section",
      "price", "dietaryTags", "calories", "proteinG", "carbsG", "fatG",
      "createdAt", "updatedAt"
    )
    SELECT
      id, ${restaurantId}, "sourceItemId",
      name, description, category, section, price,
      ARRAY(SELECT jsonb_array_elements_text(tags::jsonb)),
      calories, "proteinG", "carbsG", "fatG",
      now(), now()
    FROM UNNEST(
      ${candidateIds}::text[],
      ${sourceItemIds}::text[],
      ${names}::text[],
      ${descriptions}::text[],
      ${categories}::text[],
      ${sections}::text[],
      ${prices}::float[],
      ${dietaryTagsJson}::text[],
      ${calories}::int[],
      ${proteins}::float[],
      ${carbs}::float[],
      ${fats}::float[]
    ) AS t(id, "sourceItemId", name, description, category, section, price, tags, calories, "proteinG", "carbsG", "fatG")
    ON CONFLICT ("id") DO UPDATE SET
      "sourceItemId" = EXCLUDED."sourceItemId",
      "name"        = EXCLUDED."name",
      "retiredAt"   = NULL,
      "description" = EXCLUDED."description",
      "category"    = EXCLUDED."category",
      "section"     = EXCLUDED."section",
      "price"       = EXCLUDED."price",
      "dietaryTags" = CASE WHEN EXCLUDED.id = ANY(${candidateIds.filter((_, i) => sources[i] === "official")}::text[])
        THEN "MenuItem"."dietaryTags" ELSE EXCLUDED."dietaryTags" END,
      "calories"    = EXCLUDED."calories",
      "proteinG"    = EXCLUDED."proteinG",
      "carbsG"      = EXCLUDED."carbsG",
      "fatG"        = EXCLUDED."fatG",
      "updatedAt"   = now()
    RETURNING "id"
  `;

  if (menuItemRows.length !== candidateIds.length) throw new Error('Menu product write count mismatch');
  const menuItemIds = candidateIds;

  // A changed/unmatched serving must not keep an older official binding as its winner.
  await tx.$executeRaw`DELETE FROM "MacroEstimate" e USING UNNEST(${menuItemIds}::text[], ${sources}::text[]) incoming(id, source)
    WHERE e."menuItemId" = incoming.id AND e.source = 'official' AND e.reasoning LIKE '{"kind":"reviewed-chain-v1",%' AND incoming.source <> 'official'`;

  // Query 3: UPSERT MacroEstimate by (menuItemId, source). Each source gets
  // its own row; re-running the pipeline for the same source updates macros.
  await tx.$executeRaw`
    INSERT INTO "MacroEstimate" (
      "id", "menuItemId", "calories", "proteinG", "carbsG", "fatG",
      "confidence", "source", "reasoning", "hadPhoto", "estimatedAt"
    )
    SELECT
      gen_random_uuid(),
      "menuItemId", calories, "proteinG", "carbsG", "fatG",
      confidence::"ConfidenceLevel", COALESCE(source, 'llm'), reasoning, false, now()
    FROM UNNEST(
      ${menuItemIds}::text[],
      ${calories}::int[],
      ${proteins}::float[],
      ${carbs}::float[],
      ${fats}::float[],
      ${confidences}::text[],
      ${sources}::text[],
      ${reasonings}::text[]
    ) AS t("menuItemId", calories, "proteinG", "carbsG", "fatG", confidence, source, reasoning)
    ON CONFLICT ("menuItemId", "source") DO UPDATE SET
      "calories"    = EXCLUDED."calories",
      "proteinG"    = EXCLUDED."proteinG",
      "carbsG"      = EXCLUDED."carbsG",
      "fatG"        = EXCLUDED."fatG",
      "confidence"  = EXCLUDED."confidence",
      "hadPhoto"    = EXCLUDED."hadPhoto",
      "reasoning"   = EXCLUDED."reasoning",
      "ingredientBreakdown" = CASE WHEN EXCLUDED.source = 'official' THEN NULL ELSE "MacroEstimate"."ingredientBreakdown" END,
      "estimatedAt" = now()
  `;

  // Query 4: Recompute denormalized MenuItem macro columns from the WINNING
  // estimate so a lower-trust pipeline run never clobbers a higher-trust one.
  // DISTINCT ON requires the leading ORDER BY column to be menuItemId.
  await tx.$queryRaw`
    UPDATE "MenuItem" m
    SET "calories"  = w.calories,
        "proteinG"  = w."proteinG",
        "carbsG"    = w."carbsG",
        "fatG"      = w."fatG",
        "updatedAt" = now()
    FROM (
      SELECT DISTINCT ON (e."menuItemId")
        e."menuItemId", e.calories, e."proteinG", e."carbsG", e."fatG"
      FROM "MacroEstimate" e
      WHERE e."menuItemId" = ANY(${menuItemIds}::text[])
      ORDER BY e."menuItemId", ${Prisma.raw(macroWinnerSqlOrder("e"))}
    ) w
    WHERE m.id = w."menuItemId"
  `;

  return menuItemRows.length;
}

export async function persistItems(
  restaurantId: string,
  inputPairs: ValidatedPair[],
  prisma: PrismaClient,
): Promise<number> {
  return chainTransaction(prisma, async (tx) => {
    return persistItemsInTx(restaurantId, inputPairs, tx);
  }, 5_000);
}

// ─── Dietary summary ────────────────────────────────────────────────────────

export async function computeAndStoreDietaryOptionsInTx(
  restaurantId: string,
  tx: TxClient,
): Promise<void> {
  const items = await tx.$queryRaw<{ dietaryTags: string[] }[]>`
    SELECT "dietaryTags" FROM "MenuItem" WHERE "restaurantId" = ${restaurantId} AND "retiredAt" IS NULL
  `;
  const dietaryOptions = aggregateDietaryOptions(items.map((i: { dietaryTags: string[] }) => i.dietaryTags));

  await tx.$executeRaw`
    UPDATE "Restaurant" SET "dietaryOptions" = ${dietaryOptions}::text[], "updatedAt" = now()
    WHERE "id" = ${restaurantId}
  `;
}

export async function computeAndStoreDietaryOptions(
  restaurantId: string,
  prisma: PrismaClient,
): Promise<void> {
  return computeAndStoreDietaryOptionsInTx(restaurantId, prisma);
}

// ─── Bulk hex-level persist (eliminates N+1 round trips) ────────────────────

export interface BulkRestaurantPersist {
  restaurantId: string;
  brandId?: string;
  items: ValidatedPair[];
  /** Menu hash for incremental update tracking (S-127). */
  menuHash: string;
}

/**
 * Persist ALL restaurants in a hex with a fixed number of SQL statements,
 * regardless of restaurant count.
 *
 * Both writers use the same source identity resolver and ordered restaurant locks.
 * Missing products are retired so saved/logged references and estimate history survive.
 * Change 2 (provenance): UPSERT MacroEstimate by (menuItemId, source). After
 * upserting estimates, recompute MenuItem macro columns from the winning
 * estimate so a lower-trust run never clobbers a higher-trust one.
 *
 * Atomicity is preserved — caller must wrap in `$transaction`.
 * Returns total items upserted.
 */
export async function persistHexBulkInTx(
  restaurants: BulkRestaurantPersist[],
  tx: TxClient,
): Promise<number> {
  if (restaurants.length === 0) return 0;
  await validateReviewedChainWrites(tx, restaurants.map(r => ({ ...r, items: dedupByIdentity(r.items) })));

  const restaurantIds = restaurants.map((r) => r.restaurantId);
  const menuHashes = restaurants.map((r) => r.menuHash);
  const restaurantIdsWithItems: string[] = [];

  // Flatten items across restaurants. Dedup by source identity within each restaurant
  // candidateIds are used for new rows; on conflict the existing id is kept.
  const flatItems: { restaurantId: string; item: StructuredMenuItem }[] = [];
  const flatSourceItemIds: (string | null)[] = [];
  const flatRestaurantIds: string[] = [];
  const flatNames: string[] = [];
  const flatDescriptions: (string | null)[] = [];
  const flatCategories: (string | null)[] = [];
  const flatSections: (string | null)[] = [];
  const flatPrices: (number | null)[] = [];
  const flatDietaryTagsJson: string[] = [];
  const flatCalories: number[] = [];
  const flatProteins: number[] = [];
  const flatCarbs: number[] = [];
  const flatFats: number[] = [];
  const flatConfidences: string[] = [];
  const flatSources: string[] = [];
  const flatReasonings: (string | null)[] = [];

  for (const { restaurantId, items } of restaurants) {
    if (items.length === 0) continue;
    const deduped = dedupByIdentity(items);
    if (deduped.length < items.length) {
      console.log(`[persist] Deduped ${items.length - deduped.length} duplicate product identities for restaurant ${restaurantId}`); // eslint-disable-line no-console
    }
    if (deduped.length === 0) continue;
    restaurantIdsWithItems.push(restaurantId);
    for (const pair of deduped) {
      const name = decodeHtml(pair.item.name)!;
      flatItems.push({ restaurantId, item: pair.item });
      flatSourceItemIds.push(sourceItemId(pair.item));
      flatRestaurantIds.push(restaurantId);
      flatNames.push(name);
      flatDescriptions.push(decodeHtml(pair.item.description) ?? null);
      flatCategories.push(decodeHtml(pair.item.category) ?? null);
      flatSections.push(decodeHtml(pair.item.section) ?? null);
      flatPrices.push(pair.item.price ?? null);
      flatDietaryTagsJson.push(JSON.stringify(pair.macro.dietaryTags ?? []));
      flatCalories.push(Math.round(pair.macro.calories));
      flatProteins.push(pair.macro.proteinG);
      flatCarbs.push(pair.macro.carbsG);
      flatFats.push(pair.macro.fatG);
      flatConfidences.push(pair.macro.confidence);
      // COALESCE source to 'llm' defensively for any legacy NULL values.
      flatSources.push(pair.macro.source ?? "llm");
      flatReasonings.push(pair.macro.reasoning ?? null);
    }
  }

  // Source identities resolve before writing; no name-based RETURNING map can mix variant macros.
  const flatCandidateIds = await resolveMenuItemIds(flatItems, tx);
  const flatMenuItemIds = flatCandidateIds;

  if (flatCandidateIds.length > 0) {
    await retireMissingMenuItems(restaurantIdsWithItems, flatMenuItemIds, tx);
    const menuItemRows = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "MenuItem" (
        "id", "restaurantId", "sourceItemId", "name", "description", "category", "section",
        "price", "dietaryTags", "calories", "proteinG", "carbsG", "fatG",
        "createdAt", "updatedAt"
      )
      SELECT
        id, "restaurantId", "sourceItemId", name, description, category, section, price,
        ARRAY(SELECT jsonb_array_elements_text(tags::jsonb)),
        calories, "proteinG", "carbsG", "fatG",
        now(), now()
      FROM UNNEST(
        ${flatCandidateIds}::text[],
        ${flatRestaurantIds}::text[],
        ${flatSourceItemIds}::text[],
        ${flatNames}::text[],
        ${flatDescriptions}::text[],
        ${flatCategories}::text[],
        ${flatSections}::text[],
        ${flatPrices}::float[],
        ${flatDietaryTagsJson}::text[],
        ${flatCalories}::int[],
        ${flatProteins}::float[],
        ${flatCarbs}::float[],
        ${flatFats}::float[]
      ) AS t(id, "restaurantId", "sourceItemId", name, description, category, section, price, tags, calories, "proteinG", "carbsG", "fatG")
      ON CONFLICT ("id") DO UPDATE SET
        "sourceItemId" = EXCLUDED."sourceItemId",
        "name"        = EXCLUDED."name",
        "retiredAt"   = NULL,
        "description" = EXCLUDED."description",
        "category"    = EXCLUDED."category",
        "section"     = EXCLUDED."section",
        "price"       = EXCLUDED."price",
        "dietaryTags" = CASE WHEN EXCLUDED.id = ANY(${flatCandidateIds.filter((_, i) => flatSources[i] === "official")}::text[])
          THEN "MenuItem"."dietaryTags" ELSE EXCLUDED."dietaryTags" END,
        "calories"    = EXCLUDED."calories",
        "proteinG"    = EXCLUDED."proteinG",
        "carbsG"      = EXCLUDED."carbsG",
        "fatG"        = EXCLUDED."fatG",
        "updatedAt"   = now()
      RETURNING "id"
    `;

    if (menuItemRows.length !== flatCandidateIds.length) throw new Error('Menu product write count mismatch');
  }

  // Q3: UPSERT MacroEstimate by (menuItemId, source). Each source gets its own
  // row; re-running the pipeline for the same source updates macros in-place.
  if (flatMenuItemIds.length > 0) {
    await tx.$executeRaw`DELETE FROM "MacroEstimate" e USING UNNEST(${flatMenuItemIds}::text[], ${flatSources}::text[]) incoming(id, source)
      WHERE e."menuItemId" = incoming.id AND e.source = 'official' AND e.reasoning LIKE '{"kind":"reviewed-chain-v1",%' AND incoming.source <> 'official'`;
    await tx.$executeRaw`
      INSERT INTO "MacroEstimate" (
        "id", "menuItemId", "calories", "proteinG", "carbsG", "fatG",
        "confidence", "source", "reasoning", "hadPhoto", "estimatedAt"
      )
      SELECT
        gen_random_uuid(),
        "menuItemId", calories, "proteinG", "carbsG", "fatG",
        confidence::"ConfidenceLevel", COALESCE(source, 'llm'), reasoning, false, now()
      FROM UNNEST(
        ${flatMenuItemIds}::text[],
        ${flatCalories}::int[],
        ${flatProteins}::float[],
        ${flatCarbs}::float[],
        ${flatFats}::float[],
        ${flatConfidences}::text[],
        ${flatSources}::text[],
        ${flatReasonings}::text[]
      ) AS t("menuItemId", calories, "proteinG", "carbsG", "fatG", confidence, source, reasoning)
      ON CONFLICT ("menuItemId", "source") DO UPDATE SET
        "calories"    = EXCLUDED."calories",
        "proteinG"    = EXCLUDED."proteinG",
        "carbsG"      = EXCLUDED."carbsG",
        "fatG"        = EXCLUDED."fatG",
        "confidence"  = EXCLUDED."confidence",
        "hadPhoto"    = EXCLUDED."hadPhoto",
        "reasoning"   = EXCLUDED."reasoning",
        "ingredientBreakdown" = CASE WHEN EXCLUDED.source = 'official' THEN NULL ELSE "MacroEstimate"."ingredientBreakdown" END,
        "estimatedAt" = now()
    `;

    // Q4: Recompute denormalized MenuItem macro columns from the WINNING
    // estimate so a lower-trust pipeline run never clobbers a higher-trust one.
    // DISTINCT ON requires the leading ORDER BY column to be menuItemId.
    await tx.$queryRaw`
      UPDATE "MenuItem" m
      SET "calories"  = w.calories,
          "proteinG"  = w."proteinG",
          "carbsG"    = w."carbsG",
          "fatG"      = w."fatG",
          "updatedAt" = now()
      FROM (
        SELECT DISTINCT ON (e."menuItemId")
          e."menuItemId", e.calories, e."proteinG", e."carbsG", e."fatG"
        FROM "MacroEstimate" e
        WHERE e."menuItemId" = ANY(${flatMenuItemIds}::text[])
        ORDER BY e."menuItemId", ${Prisma.raw(macroWinnerSqlOrder("e"))}
      ) w
      WHERE m.id = w."menuItemId"
    `;
  }

  // Q5: recompute dietaryOptions for every restaurant in the batch.
  // LEFT JOIN ensures restaurants with no qualifying tags get [] (not NULL).
  // Threshold + per-item dedup match aggregateDietaryOptions semantics.
  await tx.$executeRaw`
    UPDATE "Restaurant" r
    SET "dietaryOptions" = COALESCE(q.options, ARRAY[]::text[]),
        "updatedAt" = now()
    FROM UNNEST(${restaurantIds}::text[]) AS input(id)
    LEFT JOIN (
      SELECT "restaurantId", ARRAY_AGG('has_' || tag) AS options
      FROM (
        SELECT mi."restaurantId", t.tag, COUNT(DISTINCT mi."id") AS cnt
        FROM "MenuItem" mi
        CROSS JOIN LATERAL UNNEST(mi."dietaryTags") AS t(tag)
        WHERE mi."restaurantId" = ANY(${restaurantIds}::text[]) AND mi."retiredAt" IS NULL
        GROUP BY mi."restaurantId", t.tag
      ) c
      WHERE cnt >= ${DIETARY_TAG_THRESHOLD}
      GROUP BY "restaurantId"
    ) q ON q."restaurantId" = input.id
    WHERE r.id = input.id
  `;

  // Q6: bulk UPDATE menuHash + lastScrapedAt.
  await tx.$executeRaw`
    UPDATE "Restaurant" r
    SET "menuHash" = u.hash,
        "lastScrapedAt" = now(),
        "updatedAt" = now()
    FROM UNNEST(${restaurantIds}::text[], ${menuHashes}::text[]) AS u(id, hash)
    WHERE r.id = u.id
  `;

  // Q7: preserve a bound chain identity; FatSecret and current verified handoff can establish new ones.
  if (restaurantIdsWithItems.length > 0) {
    await tx.$executeRaw`
      UPDATE "Restaurant" r
      SET "chainFlag" = (r."brandId" IS NOT NULL AND r."chainFlag") OR EXISTS (
        SELECT 1 FROM "MenuItem" mi
        JOIN "MacroEstimate" me ON me."menuItemId" = mi.id
        WHERE mi."restaurantId" = r.id AND mi."retiredAt" IS NULL AND me.source = 'fatsecret'
      ),
      "updatedAt" = now()
      WHERE r.id = ANY(${restaurantIdsWithItems}::text[])
    `;
  }

  return flatCandidateIds.length;
}
