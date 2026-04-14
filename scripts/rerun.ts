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
import type { MacroData } from "../apps/api/services/menuSources/types.js";
import {
  validateItems,
  persistItems,
  computeAndStoreDietaryOptions,
} from "./pipeline-utils.js";

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
