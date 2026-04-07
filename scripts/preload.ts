/**
 * Fitsy Preload Script — S-71 (refactored)
 *
 * Thin orchestrator. External API logic lives in service modules:
 *   - googlePlacesService      → restaurant discovery
 *   - MenuSourceResolver       → phased menu/macro lookup (FatSecret → UberEats)
 *   - WebScraperSource         → generic web scraper fallback (Jina or Firecrawl)
 *   - UESitemapIndex           → free UberEats URL discovery via sitemaps
 *   - macroEstimationService   → Haiku macro estimation for structured items
 *
 * Two-path estimation strategy:
 *   Path 1 (chains): FatSecret returns official macros → skip Haiku entirely
 *   Path 2 (indies): UberEats/WebScraper return structured items → Haiku estimates WITH descriptions
 *
 * Flow per restaurant:
 *   1. resolver.resolve()                      → FatSecret (direct macros) | UberEats
 *   2. fallback: webScraperSource.lookupByUrl() if website URI known
 *   3. fallback: webScraperSource.lookup()      for web search
 *   4. fallback: name-only Haiku estimation
 *   5. persist: chain items with official macros, indie items via Haiku estimation
 *
 * Usage:
 *   npx tsx scripts/preload.ts
 *   npm run preload
 *
 * Environment variables:
 *   POSTGRES_PRISMA_URL       — Prisma pooled connection string (required)
 *   POSTGRES_URL_NON_POOLING  — Prisma direct connection for migrations (required)
 *   GOOGLE_PLACES_API_KEY     — Google Places Nearby Search (required)
 *   ANTHROPIC_API_KEY         — Claude Haiku API (required)
 *   FIRECRAWL_API_KEY         — Firecrawl search/map/scrape (optional — used by UE discovery fallback)
 *   TARGET_LAT                — Target latitude (default: 34.0928)
 *   TARGET_LNG                — Target longitude (default: -118.3086)
 *   TARGET_RADIUS             — Search radius in meters (default: 3000)
 *   MAX_RESTAURANTS           — Max restaurants to process (default: 100)
 */

import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";

import {
  discoverRestaurants,
  type PlaceResult,
} from "../apps/api/services/googlePlacesService.js";
import { MenuSourceResolver } from "../apps/api/services/menuSources/resolver.js";
import { FatSecretSource } from "../apps/api/services/menuSources/fatSecretSource.js";
import { UberEatsSource } from "../apps/api/services/menuSources/uberEatsSource.js";
// UESitemapIndex + JinaScraper available as free alternatives
import { FirecrawlScraper } from "../apps/api/services/scrapers/firecrawlScraper.js";
import { WebScraperSource } from "../apps/api/services/menuSources/webScraperSource.js";
import { estimateMacros } from "../apps/api/services/macroEstimationService.js";
import type {
  MacroData,
  StructuredMenuItem,
} from "../apps/api/services/menuSources/types.js";
import { aggregateDietaryOptions } from "./constants.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const REQUIRED_ENV_VARS = [
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
  "GOOGLE_PLACES_API_KEY",
  "ANTHROPIC_API_KEY",
  "FIRECRAWL_API_KEY",
] as const;

const CONFIG = {
  targetLat: parseFloat(process.env["TARGET_LAT"] ?? "34.0928"),
  targetLng: parseFloat(process.env["TARGET_LNG"] ?? "-118.3086"),
  targetRadius: parseInt(process.env["TARGET_RADIUS"] ?? "3000", 10),
  maxRestaurants: parseInt(process.env["MAX_RESTAURANTS"] ?? "100", 10),
  rateLimitDelayMs: 500,
};

// ─── Stats ────────────────────────────────────────────────────────────────────

interface PipelineStats {
  discovered: number;
  persisted: number;
  skippedNoMenu: number;
  skippedHaikuFailed: number;
  skippedDbError: number;
  anthropicCalls: number;
  googlePlacesCalls: number;
  sourceBreakdown: Record<string, number>; // sourceId → count
}

// ─── Cuisine tag / chain detection ────────────────────────────────────────────

const CUISINE_TYPE_MAP: Record<string, string> = {
  american_restaurant: "american",
  asian_restaurant: "asian",
  bakery: "bakery",
  barbecue_restaurant: "bbq",
  breakfast_restaurant: "breakfast",
  brunch_restaurant: "brunch",
  cafe: "cafe",
  chinese_restaurant: "chinese",
  coffee_shop: "coffee",
  fast_food_restaurant: "fast_food",
  french_restaurant: "french",
  hamburger_restaurant: "burgers",
  indian_restaurant: "indian",
  italian_restaurant: "italian",
  japanese_restaurant: "japanese",
  korean_restaurant: "korean",
  mediterranean_restaurant: "mediterranean",
  mexican_restaurant: "mexican",
  pizza_restaurant: "pizza",
  sandwich_shop: "sandwiches",
  seafood_restaurant: "seafood",
  sushi_restaurant: "sushi",
  thai_restaurant: "thai",
  vegan_restaurant: "vegan",
  vietnamese_restaurant: "vietnamese",
};

const KNOWN_CHAIN_NAMES = [
  "mcdonald",
  "subway",
  "starbucks",
  "chipotle",
  "taco bell",
  "burger king",
  "pizza hut",
  "domino",
  "panda express",
  "in-n-out",
  "in n out",
  "wendy",
  "chick-fil-a",
];

const CHAIN_INDICATOR_TYPES = new Set([
  "fast_food_restaurant",
  "hamburger_restaurant",
  "pizza_restaurant",
]);

function extractCuisineTags(types: string[]): string[] {
  const tags = types.map((t) => CUISINE_TYPE_MAP[t]).filter(Boolean) as string[];
  return tags.length > 0 ? tags : ["restaurant"];
}

function isChain(name: string, types: string[]): boolean {
  const hasChainType = types.some((t) => CHAIN_INDICATOR_TYPES.has(t));
  const nameLower = name.toLowerCase();
  const isKnownChain = KNOWN_CHAIN_NAMES.some((chain) => nameLower.includes(chain));
  return hasChainType || isKnownChain;
}

// ─── Persistence helpers ──────────────────────────────────────────────────────

async function upsertMenuItem(
  restaurantId: string,
  item: StructuredMenuItem,
  prisma: PrismaClient,
  dietaryTags?: string[],
): Promise<string> {
  const existing = await prisma.menuItem.findFirst({
    where: { restaurantId, name: item.name },
    select: { id: true },
  });

  const data = {
    ...(item.description !== undefined ? { description: item.description } : {}),
    ...(item.category !== undefined ? { category: item.category } : {}),
    ...(item.section !== undefined ? { section: item.section } : {}),
    ...(item.price !== undefined ? { price: item.price } : {}),
    ...(dietaryTags !== undefined ? { dietaryTags } : {}),
  };

  if (existing) {
    await prisma.menuItem.update({ where: { id: existing.id }, data });
    return existing.id;
  }

  const created = await prisma.menuItem.create({
    data: { restaurantId, name: item.name, ...data },
  });
  return created.id;
}

async function persistItems(
  restaurantId: string,
  items: StructuredMenuItem[],
  macros: (MacroData | null)[],
  prisma: PrismaClient,
): Promise<number> {
  const validPairs: { item: StructuredMenuItem; macro: MacroData }[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const macro = macros[i];
    if (item && macro) validPairs.push({ item, macro });
  }
  if (validPairs.length === 0) return 0;

  // Step 1: Delete existing data for this restaurant (2 queries)
  const existingItems = await prisma.menuItem.findMany({
    where: { restaurantId },
    select: { id: true },
  });
  if (existingItems.length > 0) {
    const ids = existingItems.map((i) => i.id);
    await prisma.macroEstimate.deleteMany({ where: { menuItemId: { in: ids } } });
    await prisma.menuItem.deleteMany({ where: { restaurantId } });
  }

  // Step 2: Bulk create menu items (1 query for all items)
  const createdItems = await prisma.menuItem.createManyAndReturn({
    data: validPairs.map(({ item, macro }) => ({
      restaurantId,
      name: item.name,
      ...(item.description !== undefined ? { description: item.description } : {}),
      ...(item.category !== undefined ? { category: item.category } : {}),
      ...(item.section !== undefined ? { section: item.section } : {}),
      ...(item.price !== undefined ? { price: item.price } : {}),
      ...(macro.dietaryTags !== undefined ? { dietaryTags: macro.dietaryTags } : {}),
    })),
    select: { id: true },
  });

  // Step 3: Bulk create macro estimates (1 query for all estimates)
  await prisma.macroEstimate.createMany({
    data: createdItems.map((menuItem, i) => {
      const macro = validPairs[i]!.macro;
      return {
        menuItemId: menuItem.id,
        calories: Math.round(macro.calories),
        proteinG: macro.proteinG,
        carbsG: macro.carbsG,
        fatG: macro.fatG,
        confidence: macro.confidence,
        source: macro.source,
        hadPhoto: false,
      };
    }),
  });

  return createdItems.length;
}

// ─── Dietary summary ──────────────────────────────────────────────────────────

async function computeAndStoreDietaryOptions(
  restaurantId: string,
  prisma: PrismaClient,
): Promise<void> {
  const items = await prisma.menuItem.findMany({
    where: { restaurantId },
    select: { dietaryTags: true },
  });

  const dietaryOptions = aggregateDietaryOptions(items.map((i) => i.dietaryTags));

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: { dietaryOptions },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(`[preload] Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string): void {
  console.log(`[preload] ${message}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  validateEnv();
  const startTime = Date.now();

  log(
    `Starting preload (lat: ${CONFIG.targetLat}, lng: ${CONFIG.targetLng}, radius: ${CONFIG.targetRadius}m)`,
  );
  log(`Max restaurants: ${CONFIG.maxRestaurants}`);

  const prisma = new PrismaClient();
  const anthropic = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });

  // Create the web scraper (Firecrawl for speed + reliability)
  const scraper = new (await import("../apps/api/services/scrapers/firecrawlScraper.js")).FirecrawlScraper();
  const webScraperSource = new WebScraperSource(scraper, anthropic);

  // Two-path resolver: chains get official macros (FatSecret),
  // indies get structured menus for Haiku estimation (UberEats via Firecrawl discovery)
  const resolver = new MenuSourceResolver([
    new FatSecretSource(),                         // Path 1: ~1,060 chains, official macros, $0
    new UberEatsSource(undefined, undefined, scraper), // Path 2: indie menus, Firecrawl for UE URL discovery
  ]);

  const stats: PipelineStats = {
    discovered: 0,
    persisted: 0,
    skippedNoMenu: 0,
    skippedHaikuFailed: 0,
    skippedDbError: 0,
    anthropicCalls: 0,
    googlePlacesCalls: 0,
    sourceBreakdown: {},
  };

  try {
    // Stage 1: Discover restaurants
    log("Discovering restaurants via Google Places...");
    let places: PlaceResult[];
    try {
      places = await discoverRestaurants({
        lat: CONFIG.targetLat,
        lng: CONFIG.targetLng,
        radiusMeters: CONFIG.targetRadius,
        maxRestaurants: CONFIG.maxRestaurants,
        rateLimitDelayMs: CONFIG.rateLimitDelayMs,
      });
      stats.googlePlacesCalls = Math.ceil(places.length / 20) || 1;
    } catch (err) {
      log(`Google Places API error: ${String(err)}`);
      process.exit(1);
    }

    stats.discovered = places.length;
    log(`Discovered ${places.length} restaurants`);

    if (places.length === 0) {
      log("No restaurants found. Exiting.");
      process.exit(0);
    }

    // Stage 2: Process each restaurant
    let index = 0;
    for (const place of places) {
      index++;
      log(`Processing ${place.name} (${index}/${places.length})...`);

      // Resolver: FatSecret → UberEats (with sitemap index)
      let menuResult = await resolver.resolve(place.name, place.address);

      // Phase 3a: Web scraper website scrape if resolver found nothing and website known
      if (!menuResult.found && place.websiteUri) {
        log(`  Trying ${scraper.id} website: ${place.websiteUri}`);
        menuResult = await webScraperSource.lookupByUrl(place.name, place.websiteUri);
      }

      // Phase 3b: Web scraper search fallback (searches the web for menu)
      if (!menuResult.found) {
        log(`  Trying ${scraper.id} search: "${place.name} menu"`);
        menuResult = await webScraperSource.lookup(place.name, place.address);
      }

      // Phase 4: Name-only Haiku estimation (last resort)
      if (!menuResult.found) {
        log(`  No menu source found — using name-only Haiku estimation`);
        menuResult = {
          found: true,
          items: [{ name: `${place.name} - Popular Items` }],
          sourceId: "name-only",
        };
      }

      log(`  Source: ${menuResult.sourceId}, ${menuResult.items.length} items`);
      stats.sourceBreakdown[menuResult.sourceId] = (stats.sourceBreakdown[menuResult.sourceId] ?? 0) + 1;

      // Upsert restaurant
      let restaurantId: string;
      try {
        const restaurant = await prisma.restaurant.upsert({
          where: { externalPlaceId: place.placeId },
          create: {
            externalPlaceId: place.placeId,
            name: place.name,
            address: place.address,
            lat: place.lat,
            lng: place.lng,
            cuisineTags: extractCuisineTags(place.types),
            chainFlag: isChain(place.name, place.types),
            source: "google_places",
            menuSourceId: menuResult.sourceId,
            rating: place.rating,
            userRatingCount: place.userRatingCount,
            priceLevel: place.priceLevel,
          },
          update: {
            name: place.name,
            address: place.address,
            cuisineTags: extractCuisineTags(place.types),
            chainFlag: isChain(place.name, place.types),
            menuSourceId: menuResult.sourceId,
            rating: place.rating,
            userRatingCount: place.userRatingCount,
            priceLevel: place.priceLevel,
          },
        });
        restaurantId = restaurant.id;
      } catch (err) {
        log(`  DB error: ${String(err)}`);
        stats.skippedDbError++;
        await delay(CONFIG.rateLimitDelayMs);
        continue;
      }

      // Two-path estimation:
      // Path 1 (chains): FatSecret provides official macros — skip Haiku entirely
      // Path 2 (indies): UberEats/Firecrawl provide structured items — Haiku estimates
      //   with description context (descriptions help indie items, hurt chain items)
      let macros: (MacroData | null)[];

      if (menuResult.macros && menuResult.macros.size > 0) {
        // Path 1: official chain macros — convert map to positional array matching items
        macros = menuResult.items.map((item) => {
          const macro = menuResult.macros?.get(item.name.toLowerCase());
          return macro ?? null;
        });
      } else {
        // Path 2: indie estimation — Haiku receives structured items with descriptions
        try {
          macros = await estimateMacros(menuResult.items, anthropic);
          stats.anthropicCalls++;
        } catch (err) {
          log(`  Haiku failed: ${String(err)}`);
          stats.skippedHaikuFailed++;
          await delay(CONFIG.rateLimitDelayMs);
          continue;
        }
      }

      const persisted = await persistItems(restaurantId, menuResult.items, macros, prisma);
      log(`  Persisted ${persisted} items`);
      stats.persisted++;

      await computeAndStoreDietaryOptions(restaurantId, prisma);

      await delay(CONFIG.rateLimitDelayMs);
    }
  } finally {
    await prisma.$disconnect();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  log("Done.");
  log(
    `Summary: ${stats.discovered} discovered / ${stats.persisted} persisted / ` +
      `${stats.skippedNoMenu} skipped (no menu) / ` +
      `${stats.skippedHaikuFailed} skipped (Haiku failed) / ` +
      `${stats.skippedDbError} skipped (DB error)`,
  );
  log(
    `Source breakdown: ${Object.entries(stats.sourceBreakdown).map(([k, v]) => `${k}: ${v}`).join(", ") || "none"}`,
  );
  log(
    `API calls: ${stats.googlePlacesCalls} Google Places / ${stats.anthropicCalls} Haiku`,
  );
  log(`Total time: ${elapsed}s`);
}

main().catch((err) => {
  console.error("[preload] Fatal error:", err);
  process.exit(1);
});
