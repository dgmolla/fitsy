/**
 * Shared pipeline utilities used by preload.ts and rerun.ts.
 *
 * Extracted to avoid duplication across pipeline scripts (S-130).
 */

import type { PrismaClient } from "@prisma/client";
import type {
  MacroData,
  StructuredMenuItem,
} from "../apps/api/services/menuSources/types.js";
import { aggregateDietaryOptions } from "./constants.js";

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

// ─── Transactional persistence (S-113) ──────────────────────────────────────

export async function persistItems(
  restaurantId: string,
  validPairs: ValidatedPair[],
  prisma: PrismaClient,
): Promise<number> {
  if (validPairs.length === 0) return 0;

  return prisma.$transaction(async (tx) => {
    // Query 1: Delete existing items (cascade deletes estimates via FK)
    await tx.$executeRaw`
      DELETE FROM "MacroEstimate" WHERE "menuItemId" IN (
        SELECT "id" FROM "MenuItem" WHERE "restaurantId" = ${restaurantId}
      )
    `;
    await tx.$executeRaw`
      DELETE FROM "MenuItem" WHERE "restaurantId" = ${restaurantId}
    `;

    // Query 2: Bulk insert menu items
    const names = validPairs.map((p) => decodeHtml(p.item.name)!);
    const descriptions = validPairs.map((p) => decodeHtml(p.item.description) ?? null);
    const categories = validPairs.map((p) => decodeHtml(p.item.category) ?? null);
    const sections = validPairs.map((p) => decodeHtml(p.item.section) ?? null);
    const prices = validPairs.map((p) => p.item.price ?? null);
    const dietaryTagsJson = validPairs.map((p) => JSON.stringify(p.macro.dietaryTags ?? []));

    const menuItemRows = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "MenuItem" (
        "id", "restaurantId", "name", "description", "category", "section", "price", "dietaryTags", "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(),
        ${restaurantId},
        name, description, category, section, price,
        ARRAY(SELECT jsonb_array_elements_text(tags::jsonb)),
        now(), now()
      FROM UNNEST(
        ${names}::text[],
        ${descriptions}::text[],
        ${categories}::text[],
        ${sections}::text[],
        ${prices}::float[],
        ${dietaryTagsJson}::text[]
      ) AS t(name, description, category, section, price, tags)
      RETURNING "id"
    `;

    // Query 3: Bulk insert macro estimates
    const menuItemIds = menuItemRows.map((r) => r.id);
    const calories = validPairs.map((p) => Math.round(p.macro.calories));
    const proteins = validPairs.map((p) => p.macro.proteinG);
    const carbs = validPairs.map((p) => p.macro.carbsG);
    const fats = validPairs.map((p) => p.macro.fatG);
    const confidences = validPairs.map((p) => p.macro.confidence);
    const sources = validPairs.map((p) => p.macro.source);

    await tx.$executeRaw`
      INSERT INTO "MacroEstimate" (
        "id", "menuItemId", "calories", "proteinG", "carbsG", "fatG",
        "confidence", "source", "hadPhoto", "estimatedAt"
      )
      SELECT
        gen_random_uuid(),
        "menuItemId", calories, "proteinG", "carbsG", "fatG",
        confidence::"ConfidenceLevel", source, false, now()
      FROM UNNEST(
        ${menuItemIds}::text[],
        ${calories}::int[],
        ${proteins}::float[],
        ${carbs}::float[],
        ${fats}::float[],
        ${confidences}::text[],
        ${sources}::text[]
      ) AS t("menuItemId", calories, "proteinG", "carbsG", "fatG", confidence, source)
    `;

    return menuItemRows.length;
  });
}

// ─── Dietary summary ────────────────────────────────────────────────────────

export async function computeAndStoreDietaryOptions(
  restaurantId: string,
  prisma: PrismaClient,
): Promise<void> {
  const items = await prisma.$queryRaw<{ dietaryTags: string[] }[]>`
    SELECT "dietaryTags" FROM "MenuItem" WHERE "restaurantId" = ${restaurantId}
  `;
  const dietaryOptions = aggregateDietaryOptions(items.map((i) => i.dietaryTags));

  await prisma.$executeRaw`
    UPDATE "Restaurant" SET "dietaryOptions" = ${dietaryOptions}::text[], "updatedAt" = now()
    WHERE "id" = ${restaurantId}
  `;
}
