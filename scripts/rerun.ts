/**
 * Selective Restaurant Rerun Script (S-130)
 *
 * Reruns the full pipeline for specific restaurants without re-running
 * full discovery. Looks up existing restaurants in DB, runs:
 *   resolve → fetch → estimate → validate → persist
 *
 * Usage:
 *   npx tsx scripts/rerun.ts --restaurants "Sqirl,Pine & Crane"
 *   npx tsx scripts/rerun.ts --place-ids "ChIJ_abc,ChIJ_def"
 *   npx tsx scripts/rerun.ts --restaurants "Sqirl" --force
 */

import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";

import { MenuSourceResolver } from "../apps/api/services/menuSources/resolver.js";
import { FatSecretSource } from "../apps/api/services/menuSources/fatSecretSource.js";
import { UberEatsSource } from "../apps/api/services/menuSources/uberEatsSource.js";
import { UESitemapIndex } from "../apps/api/services/menuSources/ueSitemapIndex.js";
import { FirecrawlScraper } from "../apps/api/services/scrapers/firecrawlScraper.js";
import { WebScraperSource } from "../apps/api/services/menuSources/webScraperSource.js";
import { YelpSource } from "../apps/api/services/menuSources/yelpSource.js";
import { readFileSync } from "fs";
import { join } from "path";
import { estimateMacros } from "../apps/api/services/macroEstimationService.js";
import type {
  MacroData,
  StructuredMenuItem,
} from "../apps/api/services/menuSources/types.js";
import { aggregateDietaryOptions } from "./constants.js";

// ─── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(): { restaurants: string[]; placeIds: string[]; force: boolean } {
  const args = process.argv.slice(2);
  const restaurants: string[] = [];
  const placeIds: string[] = [];
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--restaurants" && args[i + 1]) {
      restaurants.push(...args[i + 1]!.split(",").map((s) => s.trim()).filter(Boolean));
      i++;
    } else if (args[i] === "--place-ids" && args[i + 1]) {
      placeIds.push(...args[i + 1]!.split(",").map((s) => s.trim()).filter(Boolean));
      i++;
    } else if (args[i] === "--force") {
      force = true;
    }
  }

  if (restaurants.length === 0 && placeIds.length === 0) {
    console.error("Usage: npx tsx scripts/rerun.ts --restaurants \"Name1,Name2\" [--force]");
    console.error("   or: npx tsx scripts/rerun.ts --place-ids \"ChIJ_abc,ChIJ_def\" [--force]");
    process.exit(1);
  }

  return { restaurants, placeIds, force };
}

// ─── Item validation (same as preload.ts) ───────────────────────────────────

const NON_FOOD_PATTERNS = /\b(t-?shirt|tee|hoodie|sweatshirt|hat|cap|beanie|mug|tumbler|bag|tote|merch|sticker|poster|gift\s*card|apron)\b/i;
const UTENSIL_PATTERNS = /\b(chopstick|fork|spoon|knife|napkin|plate|bowl|straw|container|lid|cup\s*sleeve|utensil)\b/i;
const CONDIMENT_PATTERNS = /\b(packet|sauce\s*cup|dressing\s*packet|ketchup|mustard|mayo|soy\s*sauce|hot\s*sauce|salt|pepper|sugar|cream|sweetener|butter\s*pat|jam|jelly|syrup|relish|vinegar|dipping\s*sauce)\b/i;

function validateItems(
  items: StructuredMenuItem[],
  macros: (MacroData | null)[],
): { valid: { item: StructuredMenuItem; macro: MacroData }[]; rejected: { name: string; reason: string }[] } {
  const valid: { item: StructuredMenuItem; macro: MacroData }[] = [];
  const rejected: { name: string; reason: string }[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const macro = macros[i];
    if (!item || !macro) continue;

    const name = item.name;

    if (NON_FOOD_PATTERNS.test(name)) { rejected.push({ name, reason: "non-food: merchandise" }); continue; }
    if (UTENSIL_PATTERNS.test(name)) { rejected.push({ name, reason: "non-food: utensil" }); continue; }

    const isBeverage = /\b(water|soda|juice|tea|coffee|lemonade|drink|beverage|sparkling|kombucha|milk|shake|smoothie)\b/i.test(name);
    if (macro.calories === 0 && !isBeverage) { rejected.push({ name, reason: "non-food: zero calories" }); continue; }
    if (macro.calories < 30 && CONDIMENT_PATTERNS.test(name)) { rejected.push({ name, reason: "condiment" }); continue; }

    valid.push({ item, macro });
  }

  return { valid, rejected };
}

// ─── Persistence (same as preload.ts — transactional) ───────────────────────

function decodeHtml(s: string | null | undefined): string | null {
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

async function persistItems(
  restaurantId: string,
  validPairs: { item: StructuredMenuItem; macro: MacroData }[],
  prisma: PrismaClient,
): Promise<number> {
  if (validPairs.length === 0) return 0;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM "MacroEstimate" WHERE "menuItemId" IN (
        SELECT "id" FROM "MenuItem" WHERE "restaurantId" = ${restaurantId}
      )
    `;
    await tx.$executeRaw`
      DELETE FROM "MenuItem" WHERE "restaurantId" = ${restaurantId}
    `;

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

async function computeAndStoreDietaryOptions(
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(message: string): void {
  console.log(`[rerun] ${message}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { restaurants, placeIds, force } = parseArgs();

  const required = ["POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING", "ANTHROPIC_API_KEY"];
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const anthropic = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });

  const scraper = new FirecrawlScraper();
  const webScraperSource = new WebScraperSource(scraper, anthropic);

  const sitemapIndex = new UESitemapIndex();
  await sitemapIndex.load();
  log(`UE sitemap index loaded`);

  // Load URL cache
  const URL_CACHE_PATH = join(process.cwd(), "scripts", "cache", "ue-discovered-urls.json");
  const urlCache = new Map<string, string>();
  try {
    const cached = JSON.parse(readFileSync(URL_CACHE_PATH, "utf-8")) as Record<string, string>;
    for (const [k, v] of Object.entries(cached)) urlCache.set(k, v);
    log(`UE URL cache loaded (${urlCache.size} entries)`);
  } catch {
    log(`UE URL cache: starting fresh`);
  }

  const ueSource = new UberEatsSource(undefined, sitemapIndex, scraper);
  ueSource.urlCache = urlCache;
  const resolver = new MenuSourceResolver([
    new FatSecretSource(),
    ueSource,
    new YelpSource(anthropic),
  ]);

  // Look up target restaurants in DB
  type DBRestaurant = { id: string; name: string; externalPlaceId: string; address: string };
  let targets: DBRestaurant[];

  if (placeIds.length > 0) {
    targets = await prisma.$queryRaw<DBRestaurant[]>`
      SELECT "id", "name", "externalPlaceId", "address"
      FROM "Restaurant"
      WHERE "externalPlaceId" = ANY(${placeIds}::text[])
    `;
  } else {
    targets = await prisma.$queryRaw<DBRestaurant[]>`
      SELECT "id", "name", "externalPlaceId", "address"
      FROM "Restaurant"
      WHERE "name" = ANY(${restaurants}::text[])
    `;
  }

  if (targets.length === 0) {
    log("No matching restaurants found in DB. Exiting.");
    await prisma.$disconnect();
    process.exit(1);
  }

  log(`Found ${targets.length} restaurants to reprocess`);

  const results: { name: string; status: string; itemsBefore: number; itemsAfter: number }[] = [];

  try {
    for (const restaurant of targets) {
      log(`\n========== ${restaurant.name} ==========`);

      const beforeCount = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint as count FROM "MenuItem" WHERE "restaurantId" = ${restaurant.id}
      `;
      const itemsBefore = Number(beforeCount[0]?.count ?? 0);
      log(`  Current items: ${itemsBefore}`);

      // Resolve menu source
      let menuResult = await resolver.resolve(restaurant.name, restaurant.address);

      // Web scraper fallback (no websiteUri available from DB, use search)
      if (!menuResult.found) {
        log(`  [${restaurant.name}] Trying ${scraper.id} search`);
        menuResult = await webScraperSource.lookup(restaurant.name, restaurant.address);
      }

      if (!menuResult.found) {
        log(`  [${restaurant.name}] All sources missed — skipping`);
        results.push({ name: restaurant.name, status: "NO_SOURCE", itemsBefore, itemsAfter: itemsBefore });
        continue;
      }

      log(`  Source: ${menuResult.sourceId}, ${menuResult.items.length} raw items`);

      // Estimate macros
      let macros: (MacroData | null)[];
      if (menuResult.macros && menuResult.macros.size > 0) {
        macros = menuResult.items.map((item) => {
          const macro = menuResult.macros?.get(item.name.toLowerCase());
          return macro ?? null;
        });
      } else {
        try {
          macros = await estimateMacros(menuResult.items, anthropic);
        } catch (err) {
          log(`  Haiku failed: ${String(err)}`);
          results.push({ name: restaurant.name, status: "HAIKU_FAILED", itemsBefore, itemsAfter: itemsBefore });
          continue;
        }
      }

      // Validate
      const { valid: validPairs, rejected } = validateItems(menuResult.items, macros);
      if (rejected.length > 0) {
        log(`  Rejected ${rejected.length} items: ${rejected.map((r) => `${r.name} (${r.reason})`).join(", ")}`);
      }

      if (validPairs.length === 0) {
        log(`  All items rejected — skipping`);
        results.push({ name: restaurant.name, status: "ALL_REJECTED", itemsBefore, itemsAfter: itemsBefore });
        continue;
      }

      // Regression guard
      if (!force && itemsBefore > 5 && validPairs.length < itemsBefore * 0.5) {
        log(`  Regression guard: ${validPairs.length} new < 50% of ${itemsBefore} existing — skipping (use --force)`);
        results.push({ name: restaurant.name, status: "REGRESSION_GUARD", itemsBefore, itemsAfter: itemsBefore });
        continue;
      }

      // Persist
      const persisted = await persistItems(restaurant.id, validPairs, prisma);
      await computeAndStoreDietaryOptions(restaurant.id, prisma);

      log(`  Persisted ${persisted} items (was ${itemsBefore})`);
      results.push({ name: restaurant.name, status: "OK", itemsBefore, itemsAfter: persisted });
    }

    // Summary
    log(`\n========== SUMMARY ==========`);
    for (const r of results) {
      log(`  ${r.name}: ${r.status} (${r.itemsBefore} → ${r.itemsAfter} items)`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[rerun] Fatal error:", err);
  process.exit(1);
});
