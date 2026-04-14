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
 *   4. fallback: skip restaurant (no name-only fallback — S-131)
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
import { UESitemapIndex } from "../apps/api/services/menuSources/ueSitemapIndex.js";
import { FirecrawlScraper } from "../apps/api/services/scrapers/firecrawlScraper.js";
import { WebScraperSource } from "../apps/api/services/menuSources/webScraperSource.js";
import { YelpSource } from "../apps/api/services/menuSources/yelpSource.js";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { estimateMacros } from "../apps/api/services/macroEstimationService.js";
import type {
  MacroData,
  StructuredMenuItem,
} from "../apps/api/services/menuSources/types.js";
import {
  validateItems,
  persistItems,
  computeAndStoreDietaryOptions,
} from "./pipeline-utils.js";

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
  force: process.argv.includes("--force"),
};

// ─── Stats ────────────────────────────────────────────────────────────────────

interface PipelineStats {
  discovered: number;
  persisted: number;
  skippedNoMenu: number;
  skippedNoSource: number;
  skippedHaikuFailed: number;
  skippedDbError: number;
  skippedRegression: number;
  rejectedItems: number;
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

// ─── Raw SQL persistence ─────────────────────────────────────────────────────
// Uses Prisma.$queryRawUnsafe for bulk inserts (3 queries instead of 7+).
// Schema ref: prisma/schema.prisma — MenuItem, MacroEstimate tables.

async function upsertRestaurantRaw(
  place: PlaceResult,
  menuSourceId: string,
  photoUrl: string | null,
  prisma: PrismaClient,
): Promise<string> {
  const cuisineTags = extractCuisineTags(place.types);
  const chainFlag = isChain(place.name, place.types);

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "Restaurant" (
      "id", "externalPlaceId", "name", "address", "lat", "lng",
      "cuisineTags", "chainFlag", "source", "menuSourceId",
      "rating", "userRatingCount", "priceLevel", "photoUrl",
      "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid(), ${place.placeId}, ${place.name}, ${place.address},
      ${place.lat}, ${place.lng}, ${cuisineTags}::text[], ${chainFlag},
      'google_places', ${menuSourceId}, ${place.rating ?? null},
      ${place.userRatingCount ?? null}, ${place.priceLevel ?? null},
      ${photoUrl},
      now(), now()
    )
    ON CONFLICT ("externalPlaceId") DO UPDATE SET
      "name" = EXCLUDED."name",
      "address" = EXCLUDED."address",
      "cuisineTags" = EXCLUDED."cuisineTags",
      "chainFlag" = EXCLUDED."chainFlag",
      "menuSourceId" = EXCLUDED."menuSourceId",
      "rating" = EXCLUDED."rating",
      "userRatingCount" = EXCLUDED."userRatingCount",
      "priceLevel" = EXCLUDED."priceLevel",
      "photoUrl" = COALESCE(EXCLUDED."photoUrl", "Restaurant"."photoUrl"),
      "updatedAt" = now()
    RETURNING "id"
  `;
  return rows[0]!.id;
}

// ─── Google Places Photo ────────────────────────────────────────────────────

async function fetchGooglePlacesPhotoUrl(photoName: string): Promise<string | null> {
  const apiKey = process.env["GOOGLE_PLACES_API_KEY"] ?? "";
  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&skipHttpRedirect=true`,
      { headers: { "X-Goog-Api-Key": apiKey } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { photoUri?: string };
    return data.photoUri ?? null;
  } catch {
    return null;
  }
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

  // Load UE sitemap index for free URL discovery (no Firecrawl needed)
  const sitemapIndex = new UESitemapIndex();
  await sitemapIndex.load();
  log(`UE sitemap index loaded`);

  // Load persistent UE URL cache — survives across runs, avoids re-discovery
  const URL_CACHE_PATH = join(process.cwd(), "scripts", "cache", "ue-discovered-urls.json");
  const urlCache = new Map<string, string>();
  try {
    const cached = JSON.parse(readFileSync(URL_CACHE_PATH, "utf-8")) as Record<string, string>;
    for (const [k, v] of Object.entries(cached)) urlCache.set(k, v);
    log(`UE URL cache loaded (${urlCache.size} entries)`);
  } catch {
    log(`UE URL cache: starting fresh`);
  }

  // Multi-path resolver: chains → UberEats → Yelp
  const ueSource = new UberEatsSource(undefined, sitemapIndex, scraper);
  ueSource.urlCache = urlCache;
  const resolver = new MenuSourceResolver([
    new FatSecretSource(),              // Path 1: ~1,060 chains, official macros, $0
    ueSource,                           // Path 2: UberEats JSON-LD (cached URL → sitemap → Firecrawl)
    new YelpSource(anthropic),          // Path 3: Yelp menu pages (Firecrawl scrape → Haiku extraction)
  ]);

  const stats: PipelineStats = {
    discovered: 0,
    persisted: 0,
    skippedNoMenu: 0,
    skippedNoSource: 0,
    skippedHaikuFailed: 0,
    skippedDbError: 0,
    skippedRegression: 0,
    rejectedItems: 0,
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

    // Stage 2: Process restaurants in parallel batches
    const CONCURRENCY = 5;

    async function processRestaurant(place: PlaceResult, index: number): Promise<void> {
      log(`Processing ${place.name} (${index}/${places.length})...`);

      // Resolver: FatSecret → UberEats → Yelp
      let menuResult = await resolver.resolve(place.name, place.address);

      // Phase 3a: Web scraper website scrape
      if (!menuResult.found && place.websiteUri) {
        log(`  [${place.name}] Trying ${scraper.id} website`);
        menuResult = await webScraperSource.lookupByUrl(place.name, place.websiteUri);
      }

      // Phase 3b: Web scraper search fallback
      if (!menuResult.found) {
        log(`  [${place.name}] Trying ${scraper.id} search`);
        menuResult = await webScraperSource.lookup(place.name, place.address);
      }

      // S-131: Skip restaurant entirely when all sources miss — no fake items
      if (!menuResult.found) {
        log(`  [${place.name}] All sources missed — skipping (no name-only fallback)`);
        stats.skippedNoSource++;
        stats.sourceBreakdown["skipped_no_source"] = (stats.sourceBreakdown["skipped_no_source"] ?? 0) + 1;
        return;
      }

      log(`  [${place.name}] Source: ${menuResult.sourceId}, ${menuResult.items.length} items`);
      stats.sourceBreakdown[menuResult.sourceId] = (stats.sourceBreakdown[menuResult.sourceId] ?? 0) + 1;

      // Get photo: Google Places (higher res, $0.007) → UE JSON-LD fallback (free, low res)
      let photoUrl: string | null = null;
      if (place.photoName) {
        photoUrl = await fetchGooglePlacesPhotoUrl(place.photoName);
      }
      if (!photoUrl) {
        photoUrl = menuResult.restaurant?.imageUrl ?? null;
      }

      // Upsert restaurant (raw SQL)
      let restaurantId: string;
      try {
        restaurantId = await upsertRestaurantRaw(place, menuResult.sourceId, photoUrl, prisma);
      } catch (err) {
        log(`  [${place.name}] DB error: ${String(err)}`);
        stats.skippedDbError++;
        return;
      }

      // Two-path estimation
      let macros: (MacroData | null)[];

      if (menuResult.macros && menuResult.macros.size > 0) {
        // Path 1: official chain macros
        macros = menuResult.items.map((item) => {
          const macro = menuResult.macros?.get(item.name.toLowerCase());
          return macro ?? null;
        });
      } else {
        // Path 2: indie estimation via Haiku
        try {
          macros = await estimateMacros(menuResult.items, anthropic);
          stats.anthropicCalls++;
        } catch (err) {
          log(`  [${place.name}] Haiku failed: ${String(err)}`);
          stats.skippedHaikuFailed++;
          return;
        }
      }

      // S-111, S-112: Validate items — reject non-food, condiments
      const { valid: validPairs, rejected } = validateItems(menuResult.items, macros);
      if (rejected.length > 0) {
        log(`  [${place.name}] Rejected ${rejected.length} items: ${rejected.map((r) => `${r.name} (${r.reason})`).join(", ")}`);
        stats.rejectedItems += rejected.length;
      }

      if (validPairs.length === 0) {
        log(`  [${place.name}] All items rejected by validation — skipping`);
        stats.skippedNoMenu++;
        return;
      }

      // S-115: Regression detection — don't replace good data with less data
      if (!CONFIG.force) {
        const existingCount = await prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*)::bigint as count FROM "MenuItem" WHERE "restaurantId" = ${restaurantId}
        `;
        const existing = Number(existingCount[0]?.count ?? 0);
        if (existing > 5 && validPairs.length < existing * 0.5) {
          log(`  [${place.name}] Regression guard: new ${validPairs.length} items < 50% of existing ${existing} — skipping (use --force to override)`);
          stats.skippedRegression++;
          return;
        }
      }

      const persisted = await persistItems(restaurantId, validPairs, prisma);
      log(`  [${place.name}] Persisted ${persisted} items`);
      stats.persisted++;

      await computeAndStoreDietaryOptions(restaurantId, prisma);
    }

    // Process in parallel batches of CONCURRENCY
    for (let i = 0; i < places.length; i += CONCURRENCY) {
      const batch = places.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((place, j) => processRestaurant(place, i + j + 1)),
      );
      // Log any unexpected failures
      for (const result of results) {
        if (result.status === "rejected") {
          log(`  Unexpected error: ${String(result.reason)}`);
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Persist URL cache — any newly discovered UE URLs survive for next run
  if (urlCache.size > 0) {
    const cacheObj: Record<string, string> = {};
    for (const [k, v] of urlCache) cacheObj[k] = v;
    writeFileSync(URL_CACHE_PATH, JSON.stringify(cacheObj, null, 2));
    log(`UE URL cache saved (${urlCache.size} entries)`);
  }

  log("Done.");
  log(
    `Summary: ${stats.discovered} discovered / ${stats.persisted} persisted / ` +
      `${stats.skippedNoSource} skipped (no source) / ` +
      `${stats.skippedNoMenu} skipped (no menu) / ` +
      `${stats.skippedHaikuFailed} skipped (Haiku failed) / ` +
      `${stats.skippedDbError} skipped (DB error) / ` +
      `${stats.skippedRegression} skipped (regression guard) / ` +
      `${stats.rejectedItems} items rejected (validation)`,
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
