/**
 * Fitsy Preload Script — S-71 (refactored), S-141 (Overture Maps)
 *
 * Thin orchestrator. External API logic lives in service modules:
 *   - overture-discovery       → restaurant discovery via Overture Maps (S-141)
 *   - hex-assignment           → assign restaurants to H3 hexes
 *   - hex-resume               → DB-based hex-level resume (always on)
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
 * Discovery: Overture Maps (free, unlimited) via DuckDB + local parquet cache.
 * Resume: always-on via PipelineCompletedHex DB table (S-140).
 *
 * Flags:
 *   --force        Skip regression guard + incremental skip.
 *   --days N       Skip restaurants scraped within N days (S-127). Default: 7.
 *
 * Usage:
 *   npx tsx scripts/preload.ts                # full LA metro hex grid
 *   npx tsx scripts/preload.ts --force        # force re-scrape all
 *
 * Environment variables:
 *   POSTGRES_PRISMA_URL       — Prisma pooled connection string (required)
 *   POSTGRES_URL_NON_POOLING  — Prisma direct connection for migrations (required)
 *   ANTHROPIC_API_KEY         — Claude Haiku API (required)
 *   FIRECRAWL_API_KEY         — Firecrawl search/map/scrape (optional — used by UE discovery fallback)
 */

import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";

import { MenuSourceResolver, type SourceAttempt } from "../apps/api/services/menuSources/resolver.js";
import { FatSecretSource } from "../apps/api/services/menuSources/fatSecretSource.js";
import { UberEatsSource } from "../apps/api/services/menuSources/uberEatsSource.js";
import { UESitemapIndex } from "../apps/api/services/menuSources/ueSitemapIndex.js";
import { FirecrawlScraper } from "../apps/api/services/scrapers/firecrawlScraper.js";
import { WebScraperSource } from "../apps/api/services/menuSources/webScraperSource.js";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { estimateMacros } from "../apps/api/services/macroEstimationService.js";
import type { MacroData, MenuSourceResult } from "../apps/api/services/menuSources/types.js";
import {
  validateItems,
  type ValidatedPair,
} from "./pipeline-utils.js";
import { withRetry } from "./retry.js";
import {
  PipelineEmitter,
  type RestaurantEvent,
  type PipelineError,
} from "./pipeline-events.js";
import { downloadOvertureCache, queryLocalParquet, type OvertureRestaurant, type BoundingBox } from "./overture-discovery.js";
import { assignToHexes } from "./hex-assignment.js";
import { filterPendingHexes } from "./hex-resume.js";
import { persistHex, type HexRestaurantData } from "./hex-persist.js";
import { API_SEMAPHORES } from "./semaphore.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const REQUIRED_ENV_VARS = [
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
  "ANTHROPIC_API_KEY",
  "FIRECRAWL_API_KEY",
] as const;

function parseDaysArg(): number {
  const idx = process.argv.indexOf("--days");
  if (idx !== -1 && process.argv[idx + 1]) {
    return parseInt(process.argv[idx + 1]!, 10);
  }
  return 7;
}

const CONFIG = {
  bbox: { south: 33.95, north: 34.15, west: -118.50, east: -118.15 } as BoundingBox,
  force: process.argv.includes("--force"),
  skipDays: parseDaysArg(),
  concurrency: 10, // S-128: increased from 5
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
  sourceBreakdown: Record<string, number>; // sourceId → count
}

// ─── Chain detection ──────────────────────────────────────────────────────────

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

/** Overture categories that strongly indicate chain restaurants. */
const CHAIN_INDICATOR_CATEGORIES = new Set([
  "fast_food",
  "burger_restaurant",
]);

function isChain(name: string, category: string): boolean {
  const hasCategoryIndicator = CHAIN_INDICATOR_CATEGORIES.has(category);
  const nameLower = name.toLowerCase();
  const isKnownChain = KNOWN_CHAIN_NAMES.some((chain) => nameLower.includes(chain));
  return hasCategoryIndicator || isKnownChain;
}

// ─── Raw SQL persistence ─────────────────────────────────────────────────────
// Uses Prisma.$queryRawUnsafe for bulk inserts (3 queries instead of 7+).
// Schema ref: prisma/schema.prisma — MenuItem, MacroEstimate tables.

async function upsertRestaurantRaw(
  restaurant: OvertureRestaurant,
  menuSourceId: string,
  photoUrl: string | null,
  prisma: PrismaClient,
): Promise<string> {
  const cuisineTags = restaurant.category ? [restaurant.category] : ["restaurant"];
  const chainFlag = isChain(restaurant.name, restaurant.category ?? "");

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "Restaurant" (
      "id", "externalPlaceId", "name", "address", "lat", "lng",
      "cuisineTags", "chainFlag", "source", "menuSourceId",
      "rating", "userRatingCount", "priceLevel", "photoUrl",
      "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid(), ${restaurant.overtureId}, ${restaurant.name}, ${restaurant.address},
      ${restaurant.lat}, ${restaurant.lng}, ${cuisineTags}::text[], ${chainFlag},
      'overture_maps', ${menuSourceId}, ${null},
      ${null}, ${null},
      ${photoUrl},
      now(), now()
    )
    ON CONFLICT ("externalPlaceId") DO UPDATE SET
      "name" = EXCLUDED."name",
      "address" = EXCLUDED."address",
      "cuisineTags" = EXCLUDED."cuisineTags",
      "chainFlag" = EXCLUDED."chainFlag",
      "menuSourceId" = EXCLUDED."menuSourceId",
      "photoUrl" = COALESCE(EXCLUDED."photoUrl", "Restaurant"."photoUrl"),
      "updatedAt" = now()
    RETURNING "id"
  `;
  return rows[0]!.id;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(`[preload] Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
}


function log(message: string): void {
  console.log(`[preload] ${message}`);
}

// S-127: Compute a hash of menu item names for change detection
function computeMenuHash(itemNames: string[]): string {
  const sorted = [...itemNames].sort();
  return createHash("sha256").update(sorted.join("\n")).digest("hex").slice(0, 16);
}

// S-127: Check if a restaurant was recently scraped and menu hasn't changed
async function shouldSkipIncremental(
  restaurantId: string,
  newMenuHash: string,
  skipDays: number,
  prisma: PrismaClient,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ lastScrapedAt: Date | null; menuHash: string | null }[]>`
    SELECT "lastScrapedAt", "menuHash" FROM "Restaurant" WHERE "id" = ${restaurantId}
  `;
  const row = rows[0];
  if (!row?.lastScrapedAt) return false;

  const daysSinceLastScrape = (Date.now() - row.lastScrapedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceLastScrape > skipDays) return false;

  // Even if recently scraped, re-process if menu changed
  if (row.menuHash && row.menuHash !== newMenuHash) return false;

  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  validateEnv();
  const startTime = Date.now();

  const prisma = new PrismaClient();
  const anthropic = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });

  // S-141: runId is date-based so re-running the same day resumes.
  // Pass --run-id <id> to override (useful for manual retries).
  const runIdIdx = process.argv.indexOf("--run-id");
  const runId =
    runIdIdx !== -1 && process.argv[runIdIdx + 1]
      ? process.argv[runIdIdx + 1]!
      : `run-${new Date().toISOString().slice(0, 10)}`;
  const emitter = new PipelineEmitter();

  // Web scrapers: Firecrawl for known-URL scraping, Brave Search for search fallback (S-123, S-124)
  const firecrawlScraper = new (await import("../apps/api/services/scrapers/firecrawlScraper.js")).FirecrawlScraper();
  const { BraveSearchScraper } = await import("../apps/api/services/scrapers/braveSearchScraper.js");
  const braveScraper = new BraveSearchScraper();
  const firecrawlWebSource = new WebScraperSource(firecrawlScraper, anthropic);
  const braveWebSource = new WebScraperSource(braveScraper, anthropic);

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

  // Multi-path resolver: chains → UberEats (S-134: removed Yelp — unreliable slug guessing, Brave website fallback covers it)
  const ueSource = new UberEatsSource(undefined, sitemapIndex, firecrawlScraper);
  ueSource.urlCache = urlCache;
  const resolver = new MenuSourceResolver([
    new FatSecretSource(),              // Path 1: ~1,060 chains, official macros, $0
    ueSource,                           // Path 2: UberEats JSON-LD (raw fetch → Firecrawl fallback on bot defense)
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
    sourceBreakdown: {},
  };
  let skippedIncremental = 0;

  // S-141: Stage 0 — Download Overture cache (no-op if fresh)
  const cachePath = await downloadOvertureCache(CONFIG.bbox);

  // S-141: Stage 1 — Query all restaurants from local cache
  const allRestaurants = await queryLocalParquet(cachePath, CONFIG.bbox);
  log(`Discovered ${allRestaurants.length} restaurants via Overture Maps`);
  stats.discovered = allRestaurants.length;

  // S-141: Stage 2 — Assign restaurants to H3 hexes
  const hexMap = assignToHexes(allRestaurants);
  const allHexIds = Array.from(hexMap.keys());
  log(`Assigned to ${allHexIds.length} hexes at resolution 7`);

  // S-141: Stage 3 — Filter out already-completed hexes (resume by default, S-140)
  const pendingHexIds = await filterPendingHexes(allHexIds, runId, prisma);
  const hexesTotal = allHexIds.length;
  let hexesCompleted = hexesTotal - pendingHexIds.length;

  try {
    for (const hexId of pendingHexIds) {
      const hexRestaurants = hexMap.get(hexId)!;

      log(`\n========== Hex ${hexId} (${hexRestaurants.length} restaurants) ==========`);

      if (hexRestaurants.length === 0) {
        await prisma.pipelineCompletedHex.create({
          data: { runId, hexId, count: 0 },
        });
        hexesCompleted++;
        continue;
      }

      // Process restaurants in parallel batches (S-128: concurrency=10)
      // Returns persist-ready data, or null if skipped. Actual DB writes
      // are deferred to persistHex() for atomic batch persist + checkpoint.
      interface ProcessedRestaurant {
        restaurantId: string;
        items: ValidatedPair[];
        menuHash: string;
        itemCount: number;
      }

      async function processRestaurant(restaurant: OvertureRestaurant, index: number): Promise<ProcessedRestaurant | null> {
        const restaurantStart = Date.now();
        const sourcesAttempted: string[] = [];
        const sourcesFailed: string[] = [];
        let resolverAttempts: SourceAttempt[] = [];

        log(`Processing ${restaurant.name} (${index}/${hexRestaurants.length})...`);

        // Helper: emit restaurant event and return (S-120, S-133)
        function emitRestaurantEvent(status: string, source: string, itemCount: number, rejectedCount: number, macroMismatchCount: number, nameMismatch: boolean): void {
          emitter.bufferRestaurant({
            type: "restaurant",
            runId,
            hexId,
            name: restaurant.name,
            placeId: restaurant.overtureId,
            source,
            status,
            itemCount,
            rejectedCount,
            macroMismatchCount,
            sourcesAttempted: [...sourcesAttempted],
            sourcesFailed: [...sourcesFailed],
            sourceAttempts: [...resolverAttempts],
            nameMismatch,
            durationMs: Date.now() - restaurantStart,
            _time: new Date().toISOString(),
          });
        }

        // Resolver: FatSecret → UberEats (with retry — S-116)
        const resolverResult = await withRetry(
          () => resolver.resolve(restaurant.name, restaurant.address),
          { label: `${restaurant.name}/resolve` },
        ).then((r) => r.result);
        let menuResult: MenuSourceResult = resolverResult;
        resolverAttempts = resolverResult.attempts ?? [];
        // S-133: Populate per-source tracking from resolver attempts
        for (const attempt of resolverResult.attempts) {
          sourcesAttempted.push(attempt.sourceId);
          if (attempt.status !== "ok") sourcesFailed.push(attempt.sourceId);
        }

        // Phase 3a: Website scrape via Firecrawl (with retry — S-116, S-124)
        if (!menuResult.found && restaurant.website) {
          log(`  [${restaurant.name}] Trying firecrawl website scrape`);
          sourcesAttempted.push("brave_website");
          menuResult = await withRetry(
            () => API_SEMAPHORES.firecrawl.run(() =>
              firecrawlWebSource.lookupByUrl(restaurant.name, restaurant.website!),
            ),
            { label: `${restaurant.name}/firecrawl-url` },
          ).then((r) => r.result);
          if (!menuResult.found) sourcesFailed.push("brave_website");
        }

        // Phase 3b: Brave Search menu fallback (S-123, S-124 — replaces Firecrawl search)
        if (!menuResult.found) {
          log(`  [${restaurant.name}] Trying brave_search menu fallback`);
          if (!sourcesAttempted.includes("brave_website")) sourcesAttempted.push("brave_website");
          menuResult = await withRetry(
            () => API_SEMAPHORES.braveSearch.run(() =>
              braveWebSource.lookup(restaurant.name, restaurant.address),
            ),
            { label: `${restaurant.name}/brave-search` },
          ).then((r) => r.result);
          if (!menuResult.found && !sourcesFailed.includes("brave_website")) sourcesFailed.push("brave_website");
        }

        // S-131: Skip restaurant entirely when all sources miss — no fake items
        if (!menuResult.found) {
          log(`  [${restaurant.name}] All sources missed — skipping (no name-only fallback)`);
          stats.skippedNoSource++;
          stats.sourceBreakdown["skipped_no_source"] = (stats.sourceBreakdown["skipped_no_source"] ?? 0) + 1;
          emitRestaurantEvent("skipped_no_source", "none", 0, 0, 0, false);
          return null;
        }

        log(`  [${restaurant.name}] Source: ${menuResult.sourceId}, ${menuResult.items.length} items`);
        stats.sourceBreakdown[menuResult.sourceId] = (stats.sourceBreakdown[menuResult.sourceId] ?? 0) + 1;

        // S-118: Name mismatch detection (log-only)
        const nameMismatch = menuResult.nameMismatch ?? false;
        if (nameMismatch) {
          log(`  [${restaurant.name}] Name mismatch detected (scraped: ${menuResult.restaurant?.name ?? "unknown"})`);
        }

        // Get photo: UE JSON-LD fallback (free)
        const photoUrl: string | null = menuResult.restaurant?.imageUrl ?? null;

        // Upsert restaurant (raw SQL)
        let restaurantId: string;
        try {
          restaurantId = await upsertRestaurantRaw(restaurant, menuResult.sourceId, photoUrl, prisma);
        } catch (err) {
          log(`  [${restaurant.name}] DB error: ${String(err)}`);
          stats.skippedDbError++;
          emitter.emitError({
            type: "error", runId, hexId, restaurant: restaurant.name, placeId: restaurant.overtureId,
            stage: "persistence", source: "db", error: String(err), retryable: false, retriesAttempted: 0,
            _time: new Date().toISOString(),
          });
          emitRestaurantEvent("skipped_db_error", menuResult.sourceId, 0, 0, 0, nameMismatch);
          return null;
        }

        // S-127: Incremental updates — skip if recently scraped and menu unchanged
        if (!CONFIG.force) {
          const menuHash = computeMenuHash(menuResult.items.map((i) => i.name));
          if (await shouldSkipIncremental(restaurantId, menuHash, CONFIG.skipDays, prisma)) {
            log(`  [${restaurant.name}] Recently scraped (within ${CONFIG.skipDays} days), menu unchanged — skipping`);
            skippedIncremental++;
            emitRestaurantEvent("skipped_incremental", menuResult.sourceId, 0, 0, 0, nameMismatch);
            return null;
          }
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
          // Path 2: indie estimation via Haiku (with retry — S-116, S-128 semaphore)
          try {
            const { result: estimatedMacros } = await withRetry(
              () => API_SEMAPHORES.haiku.run(() =>
                estimateMacros(menuResult.items, anthropic),
              ),
              { label: `${restaurant.name}/haiku` },
            );
            macros = estimatedMacros;
            stats.anthropicCalls++;
          } catch (err) {
            log(`  [${restaurant.name}] Haiku failed: ${String(err)}`);
            stats.skippedHaikuFailed++;
            emitter.emitError({
              type: "error", runId, hexId, restaurant: restaurant.name, placeId: restaurant.overtureId,
              stage: "macro_estimation", source: "haiku", error: String(err), retryable: true, retriesAttempted: 2,
              _time: new Date().toISOString(),
            });
            emitRestaurantEvent("skipped_haiku_failed", menuResult.sourceId, 0, 0, 0, nameMismatch);
            return null;
          }
        }

        // S-111, S-112: Validate items — reject non-food, condiments
        // S-121: Flag macro math mismatches (log-only)
        const { valid: validPairs, rejected, macroMismatches } = validateItems(menuResult.items, macros);
        if (rejected.length > 0) {
          log(`  [${restaurant.name}] Rejected ${rejected.length} items: ${rejected.map((r) => `${r.name} (${r.reason})`).join(", ")}`);
          stats.rejectedItems += rejected.length;
        }
        if (macroMismatches.length > 0) {
          log(`  [${restaurant.name}] Macro mismatches: ${macroMismatches.map((m) => `${m.name} (${m.calories}cal vs ${m.calculatedCalories}cal calc, ${m.percentDelta}%)`).join(", ")}`);
        }

        if (validPairs.length === 0) {
          log(`  [${restaurant.name}] All items rejected by validation — skipping`);
          stats.skippedNoMenu++;
          emitRestaurantEvent("skipped_validation_empty", menuResult.sourceId, 0, rejected.length, macroMismatches.length, nameMismatch);
          return null;
        }

        // S-115: Regression detection — don't replace good data with less data
        if (!CONFIG.force) {
          const existingCount = await prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*)::bigint as count FROM "MenuItem" WHERE "restaurantId" = ${restaurantId}
          `;
          const existing = Number(existingCount[0]?.count ?? 0);
          if (existing > 5 && validPairs.length < existing * 0.5) {
            log(`  [${restaurant.name}] Regression guard: new ${validPairs.length} items < 50% of existing ${existing} — skipping (use --force to override)`);
            stats.skippedRegression++;
            emitRestaurantEvent("skipped_regression", menuResult.sourceId, 0, rejected.length, macroMismatches.length, nameMismatch);
            return null;
          }
        }

        // Compute menu hash for incremental update tracking (S-127)
        // Uses raw items (not validPairs) so hash matches the skip-check computation
        const menuHash = computeMenuHash(menuResult.items.map((i) => i.name));

        log(`  [${restaurant.name}] Ready to persist ${validPairs.length} items`);
        stats.persisted++;

        emitRestaurantEvent("ok", menuResult.sourceId, validPairs.length, rejected.length, macroMismatches.length, nameMismatch);
        return { restaurantId, items: validPairs, menuHash, itemCount: validPairs.length };
      }

      // Process in parallel batches (S-128: concurrency=10)
      // Collect results — actual DB writes deferred to persistHex()
      const hexResults: HexRestaurantData[] = [];

      for (let i = 0; i < hexRestaurants.length; i += CONFIG.concurrency) {
        const batch = hexRestaurants.slice(i, i + CONFIG.concurrency);
        const results = await Promise.allSettled(
          batch.map((r, j) => processRestaurant(r, i + j + 1)),
        );
        for (const result of results) {
          if (result.status === "rejected") {
            log(`  Unexpected error: ${String(result.reason)}`);
          } else if (result.value != null) {
            hexResults.push(result.value);
          }
        }
      }

      // Atomic batch persist: all items + dietary options + menuHash + checkpoint
      // in a single DB transaction. If anything fails, everything rolls back —
      // no partial data, no phantom checkpoint. (Spec: "Nothing reaches the DB
      // until the entire hex is done.")
      if (hexResults.length > 0) {
        const totalItems = await persistHex(runId, hexId, hexResults, prisma);
        log(`Persisted ${totalItems} items across ${hexResults.length} restaurants`);
      } else {
        // No restaurants to persist — still checkpoint the hex as done
        await prisma.pipelineCompletedHex.create({
          data: { runId, hexId, count: 0 },
        });
      }

      // S-120: Flush hex events + cost checkpoint
      hexesCompleted++;
      await emitter.flushHex({
        type: "cost_checkpoint",
        runId,
        hexId,
        hexesCompleted,
        hexesTotal,
        cumulativeCost: 0,
        cumulativeCostBreakdown: { braveSearch: 0, firecrawl: 0, haiku: 0 },
        _time: new Date().toISOString(),
      });

      log(`Hex ${hexId} complete (${hexesCompleted}/${hexesTotal})`);
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
      `${skippedIncremental} skipped (incremental) / ` +
      `${stats.rejectedItems} items rejected (validation)`,
  );
  log(
    `Source breakdown: ${Object.entries(stats.sourceBreakdown).map(([k, v]) => `${k}: ${v}`).join(", ") || "none"}`,
  );
  log(
    `API calls: ${stats.anthropicCalls} Haiku (discovery: Overture Maps — free)`,
  );
  log(`Hexes: ${hexesCompleted}/${hexesTotal}`);
  log(`Total time: ${elapsed}s`);

  // S-120: Emit run event and flush
  const failed = stats.skippedNoSource + stats.skippedNoMenu + stats.skippedHaikuFailed + stats.skippedDbError + stats.skippedRegression;
  await emitter.emitRun({
    type: "run",
    runId,
    durationTotal: `${elapsed}s`,
    hexesTotal,
    hexesCompleted,
    restaurantsDiscovered: stats.discovered,
    restaurantsPersisted: stats.persisted,
    restaurantsFailed: failed,
    itemsTotal: 0,
    costTotal: 0,
    _time: new Date().toISOString(),
  });
}

main().catch((err) => {
  console.error("[preload] Fatal error:", err);
  process.exit(1);
});
