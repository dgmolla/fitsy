/**
 * Shared pipeline utilities used by preload.ts and rerun.ts.
 *
 * Extracted to avoid duplication across pipeline scripts (S-130).
 */

import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  MacroData,
  StructuredMenuItem,
} from "../apps/api/services/menuSources/types.js";
import { aggregateDietaryOptions, DIETARY_TAG_THRESHOLD } from "./constants.js";
import { macroWinnerSqlOrder } from "@fitsy/shared";

// ─── Item validation (S-111, S-112) ─────────────────────────────────────────

export const NON_FOOD_PATTERNS = /\b(t-?shirt|tee|hoodie|sweatshirt|hat|cap|beanie|mug|tumbler|bag|tote|merch|sticker|poster|gift\s*card|apron)\b/i;
export const UTENSIL_PATTERNS = /\b(chopstick|fork|spoon|knife|napkin|straw|container|lid|cup\s*sleeve|utensil)\b/i;
export const CONDIMENT_PATTERNS = /\b(packet|sauce\s*cup|dressing\s*packet|ketchup|mustard|mayo|soy\s*sauce|hot\s*sauce|salt|pepper|sugar|cream|sweetener|butter\s*pat|jam|jelly|syrup|relish|vinegar|dipping\s*sauce)\b/i;
const BEVERAGE_PATTERNS = /\b(water|soda|juice|tea|coffee|lemonade|drink|beverage|sparkling|kombucha|milk|shake|smoothie)\b/i;

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

    // S-111: Non-food items
    if (NON_FOOD_PATTERNS.test(name)) {
      rejected.push({ name, reason: "non-food: merchandise" });
      continue;
    }
    if (UTENSIL_PATTERNS.test(name)) {
      rejected.push({ name, reason: "non-food: utensil" });
      continue;
    }

    // S-111: Zero-cal non-beverage items
    if (macro.calories === 0 && !BEVERAGE_PATTERNS.test(name)) {
      rejected.push({ name, reason: "non-food: zero calories" });
      continue;
    }

    // S-112: Condiments (cal < 30 AND condiment pattern)
    if (macro.calories < 30 && CONDIMENT_PATTERNS.test(name)) {
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

export function decodeHtml(s: string | null | undefined): string | null {
  if (!s) return s ?? null;
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

// ─── Dedup (S-133) ─────────────────────────────────────────────────────────

/**
 * Deduplicate validated pairs by normalized item name (case-insensitive).
 * Keeps the first occurrence when duplicates exist. Source data (esp. FatSecret)
 * can have duplicate names which violate the @@unique([restaurantId, name]) constraint.
 */
export function dedupByName(pairs: ValidatedPair[]): ValidatedPair[] {
  const seen = new Set<string>();
  return pairs.filter((p) => {
    const key = p.item.name.toLowerCase();
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
 * This is the shared core — both `persistItems` (single-restaurant wrapper)
 * and `persistHex` (hex-level wrapper in hex-persist.ts) delegate here.
 *
 * Change 1 (stable IDs): upsert MenuItem by (restaurantId, name) so existing
 * rows keep their id (SavedItem.menuItemId never orphaned). Stale items absent
 * from the incoming set are deleted afterward.
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

  // S-133: Dedup by item name — source data (esp. FatSecret) can have
  // duplicate names which violate the @@unique([restaurantId, name]) constraint.
  const validPairs = dedupByName(inputPairs);
  if (validPairs.length < inputPairs.length) {
    console.log(`[persist] Deduped ${inputPairs.length - validPairs.length} duplicate item names for restaurant ${restaurantId}`); // eslint-disable-line no-console
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
  // Candidate IDs for new rows — on conflict the existing id is preserved.
  const candidateIds = validPairs.map(() => randomUUID());

  // Query 1: UPSERT MenuItem by (restaurantId, name). New rows get a fresh
  // UUID; existing rows keep their id (stable for SavedItem FK). Macro columns
  // are written here for brand-new rows; the winner-recompute step (Query 3)
  // will correct them for existing rows regardless of trust order.
  const menuItemRows = await tx.$queryRaw<{ id: string; name: string }[]>`
    INSERT INTO "MenuItem" (
      "id", "restaurantId", "name", "description", "category", "section",
      "price", "dietaryTags", "calories", "proteinG", "carbsG", "fatG",
      "createdAt", "updatedAt"
    )
    SELECT
      id, ${restaurantId},
      name, description, category, section, price,
      ARRAY(SELECT jsonb_array_elements_text(tags::jsonb)),
      calories, "proteinG", "carbsG", "fatG",
      now(), now()
    FROM UNNEST(
      ${candidateIds}::text[],
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
    ) AS t(id, name, description, category, section, price, tags, calories, "proteinG", "carbsG", "fatG")
    ON CONFLICT ("restaurantId", "name") DO UPDATE SET
      "description" = EXCLUDED."description",
      "category"    = EXCLUDED."category",
      "section"     = EXCLUDED."section",
      "price"       = EXCLUDED."price",
      "dietaryTags" = EXCLUDED."dietaryTags",
      "calories"    = EXCLUDED."calories",
      "proteinG"    = EXCLUDED."proteinG",
      "carbsG"      = EXCLUDED."carbsG",
      "fatG"        = EXCLUDED."fatG",
      "updatedAt"   = now()
    RETURNING "id", "name"
  `;

  // Build (restaurantId,name) → stable persisted id map.
  // RETURNING order is NOT guaranteed to match input order, so map by name.
  const idByName = new Map<string, string>(
    (menuItemRows as { id: string; name: string }[]).map((r) => [r.name, r.id]),
  );

  // Resolve the stable persisted id for each pair (fall back to a fresh UUID
  // if somehow the row is missing — should never happen but is safe).
  const menuItemIds = validPairs.map((p) => {
    const decodedName = decodeHtml(p.item.name)!;
    return idByName.get(decodedName) ?? randomUUID();
  });

  // Query 2: Delete stale items for this restaurant — those whose name is NOT
  // in the incoming set. Cascades drop their MacroEstimates via FK.
  await tx.$executeRaw`
    DELETE FROM "MenuItem"
    WHERE "restaurantId" = ${restaurantId}
      AND "name" <> ALL(${names}::text[])
  `;

  // Query 3: UPSERT MacroEstimate by (menuItemId, source). Each source gets
  // its own row; re-running the pipeline for the same source updates macros.
  await tx.$executeRaw`
    INSERT INTO "MacroEstimate" (
      "id", "menuItemId", "calories", "proteinG", "carbsG", "fatG",
      "confidence", "source", "hadPhoto", "estimatedAt"
    )
    SELECT
      gen_random_uuid(),
      "menuItemId", calories, "proteinG", "carbsG", "fatG",
      confidence::"ConfidenceLevel", COALESCE(source, 'llm'), false, now()
    FROM UNNEST(
      ${menuItemIds}::text[],
      ${calories}::int[],
      ${proteins}::float[],
      ${carbs}::float[],
      ${fats}::float[],
      ${confidences}::text[],
      ${sources}::text[]
    ) AS t("menuItemId", calories, "proteinG", "carbsG", "fatG", confidence, source)
    ON CONFLICT ("menuItemId", "source") DO UPDATE SET
      "calories"    = EXCLUDED."calories",
      "proteinG"    = EXCLUDED."proteinG",
      "carbsG"      = EXCLUDED."carbsG",
      "fatG"        = EXCLUDED."fatG",
      "confidence"  = EXCLUDED."confidence",
      "hadPhoto"    = EXCLUDED."hadPhoto",
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
  return prisma.$transaction(async (tx) => {
    return persistItemsInTx(restaurantId, inputPairs, tx);
  });
}

// ─── Dietary summary ────────────────────────────────────────────────────────

export async function computeAndStoreDietaryOptionsInTx(
  restaurantId: string,
  tx: TxClient,
): Promise<void> {
  const items = await tx.$queryRaw<{ dietaryTags: string[] }[]>`
    SELECT "dietaryTags" FROM "MenuItem" WHERE "restaurantId" = ${restaurantId}
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
  items: ValidatedPair[];
  /** Menu hash for incremental update tracking (S-127). */
  menuHash: string;
}

/**
 * Persist ALL restaurants in a hex with a fixed number of SQL statements,
 * regardless of restaurant count.
 *
 * Change 1 (stable IDs): UPSERT MenuItem by (restaurantId, name) so existing
 * rows keep their id (SavedItem.menuItemId never orphaned). Delete stale items
 * (absent from incoming set) at the end. RETURNING is mapped by (restaurantId,
 * name) — NOT by array position — to build a stable id lookup.
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

  const restaurantIds = restaurants.map((r) => r.restaurantId);
  const menuHashes = restaurants.map((r) => r.menuHash);
  const restaurantIdsWithItems: string[] = [];

  // Flatten items across restaurants. Dedup by name within each restaurant
  // (source data can have duplicate names — violates @@unique constraint).
  // candidateIds are used for new rows; on conflict the existing id is kept.
  const flatCandidateIds: string[] = [];
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

  // Keep track of per-restaurant incoming names for stale-item deletion.
  const incomingNamesByRestaurant = new Map<string, string[]>();

  for (const { restaurantId, items } of restaurants) {
    if (items.length === 0) continue;
    const deduped = dedupByName(items);
    if (deduped.length < items.length) {
      console.log(`[persist] Deduped ${items.length - deduped.length} duplicate item names for restaurant ${restaurantId}`); // eslint-disable-line no-console
    }
    if (deduped.length === 0) continue;
    restaurantIdsWithItems.push(restaurantId);
    const namesForRestaurant: string[] = [];
    for (const pair of deduped) {
      const name = decodeHtml(pair.item.name)!;
      flatCandidateIds.push(randomUUID());
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
      namesForRestaurant.push(name);
    }
    incomingNamesByRestaurant.set(restaurantId, namesForRestaurant);
  }

  // Q1: UPSERT MenuItem by (restaurantId, name). New rows get a fresh UUID
  // (candidateId); existing rows keep their id. Macro columns are written for
  // brand-new rows; the winner-recompute step (Q4) corrects existing rows.
  // RETURNING includes restaurantId + name so we can map to stable ids.
  let flatMenuItemIds: string[] = [];

  if (flatCandidateIds.length > 0) {
    const menuItemRows = await tx.$queryRaw<{ id: string; restaurantId: string; name: string }[]>`
      INSERT INTO "MenuItem" (
        "id", "restaurantId", "name", "description", "category", "section",
        "price", "dietaryTags", "calories", "proteinG", "carbsG", "fatG",
        "createdAt", "updatedAt"
      )
      SELECT
        id, "restaurantId", name, description, category, section, price,
        ARRAY(SELECT jsonb_array_elements_text(tags::jsonb)),
        calories, "proteinG", "carbsG", "fatG",
        now(), now()
      FROM UNNEST(
        ${flatCandidateIds}::text[],
        ${flatRestaurantIds}::text[],
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
      ) AS t(id, "restaurantId", name, description, category, section, price, tags, calories, "proteinG", "carbsG", "fatG")
      ON CONFLICT ("restaurantId", "name") DO UPDATE SET
        "description" = EXCLUDED."description",
        "category"    = EXCLUDED."category",
        "section"     = EXCLUDED."section",
        "price"       = EXCLUDED."price",
        "dietaryTags" = EXCLUDED."dietaryTags",
        "calories"    = EXCLUDED."calories",
        "proteinG"    = EXCLUDED."proteinG",
        "carbsG"      = EXCLUDED."carbsG",
        "fatG"        = EXCLUDED."fatG",
        "updatedAt"   = now()
      RETURNING "id", "restaurantId", "name"
    `;

    // Build (restaurantId, name) → stable persisted id map.
    // RETURNING order is NOT guaranteed to match input order.
    const idByRestaurantAndName = new Map<string, string>(
      (menuItemRows as { id: string; restaurantId: string; name: string }[]).map(
        (r) => [`${r.restaurantId}\0${r.name}`, r.id],
      ),
    );

    // Resolve stable persisted ids for each flat item, in input order.
    flatMenuItemIds = flatRestaurantIds.map((rid, i) => {
      const key = `${rid}\0${flatNames[i]}`;
      return idByRestaurantAndName.get(key) ?? randomUUID();
    });
  }

  // Q2: Delete stale items — MenuItems for touched restaurants whose name is
  // NOT in the incoming set. Uses NOT EXISTS against (restaurantId, name) pairs.
  // Cascades drop their MacroEstimates via FK.
  if (restaurantIdsWithItems.length > 0 && flatCandidateIds.length > 0) {
    await tx.$executeRaw`
      DELETE FROM "MenuItem" mi
      WHERE mi."restaurantId" = ANY(${restaurantIdsWithItems}::text[])
        AND NOT EXISTS (
          SELECT 1
          FROM UNNEST(${flatRestaurantIds}::text[], ${flatNames}::text[]) AS incoming(rid, nm)
          WHERE incoming.rid = mi."restaurantId"
            AND incoming.nm  = mi.name
        )
    `;
  }

  // Q3: UPSERT MacroEstimate by (menuItemId, source). Each source gets its own
  // row; re-running the pipeline for the same source updates macros in-place.
  if (flatMenuItemIds.length > 0) {
    await tx.$executeRaw`
      INSERT INTO "MacroEstimate" (
        "id", "menuItemId", "calories", "proteinG", "carbsG", "fatG",
        "confidence", "source", "hadPhoto", "estimatedAt"
      )
      SELECT
        gen_random_uuid(),
        "menuItemId", calories, "proteinG", "carbsG", "fatG",
        confidence::"ConfidenceLevel", COALESCE(source, 'llm'), false, now()
      FROM UNNEST(
        ${flatMenuItemIds}::text[],
        ${flatCalories}::int[],
        ${flatProteins}::float[],
        ${flatCarbs}::float[],
        ${flatFats}::float[],
        ${flatConfidences}::text[],
        ${flatSources}::text[]
      ) AS t("menuItemId", calories, "proteinG", "carbsG", "fatG", confidence, source)
      ON CONFLICT ("menuItemId", "source") DO UPDATE SET
        "calories"    = EXCLUDED."calories",
        "proteinG"    = EXCLUDED."proteinG",
        "carbsG"      = EXCLUDED."carbsG",
        "fatG"        = EXCLUDED."fatG",
        "confidence"  = EXCLUDED."confidence",
        "hadPhoto"    = EXCLUDED."hadPhoto",
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
        WHERE mi."restaurantId" = ANY(${restaurantIds}::text[])
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

  // Q7: set chainFlag based on macro source — fatsecret means chain data.
  if (restaurantIdsWithItems.length > 0) {
    await tx.$executeRaw`
      UPDATE "Restaurant" r
      SET "chainFlag" = EXISTS (
        SELECT 1 FROM "MenuItem" mi
        JOIN "MacroEstimate" me ON me."menuItemId" = mi.id
        WHERE mi."restaurantId" = r.id AND me.source = 'fatsecret'
      ),
      "updatedAt" = now()
      WHERE r.id = ANY(${restaurantIdsWithItems}::text[])
    `;
  }

  return flatCandidateIds.length;
}
