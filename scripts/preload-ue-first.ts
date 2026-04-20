/**
 * UE-First Preload Orchestrator (Stage 3)
 *
 * Replaces the Overture → Brave → Firecrawl → getStoreV1 discovery pipeline
 * with an unauth `getFeedV1` discovery probe. Two phases, one script:
 *
 *   Phase 1 (discover): res-5 probe grid → paginateFeedV1 → dedup by
 *     storeUuid → assign to res-7 homeHex → upsert Restaurant with feed
 *     hero photo (photoSource='ue_feed_hero').
 *
 *   Phase 2 (enrich): iterate Restaurants grouped by homeHex → resolver
 *     [FatSecret, UeApiDirectSource(storeUuid)] → Haiku (indie path) →
 *     photo fallback (hero → menu image → Google Places) → persistHex.
 *
 * Reuses: assignToHexes (via h3-js directly), persistHex, filterPendingHexes,
 *   findIncompleteRunId, PipelineEmitter, API_SEMAPHORES, shouldSkipIncremental,
 *   validateItems, fetchGooglePlacesPhoto, FatSecretSource, UeApiDirectSource,
 *   estimateMacros.
 *
 * See `docs/engineering/plans/ue-first-pipeline.md` for the full design.
 *
 * Flags:
 *   --phase discover|enrich|both   Default: both.
 *   --hex-id HEX                   Run only this specific res-7 hex in Phase 2.
 *   --max-hexes N                  Limit Phase 2 to N pending hexes.
 *   --dry-run                      Skip all DB writes in Phase 2; print plans.
 *   --force                        Skip the post-fetch menuHash skip gate.
 *   --days N                       Skip restaurants scraped within N days (default 7).
 *   --run-id ID                    Explicit run id; otherwise resumed or date-based.
 *   --skip-preflight               Skip UE + Anthropic preflight (offline testing).
 *
 * Environment:
 *   POSTGRES_PRISMA_URL         required
 *   POSTGRES_URL_NON_POOLING    required (preload uses direct connection)
 *   ANTHROPIC_API_KEY           required (Haiku estimation)
 *   UE_LOC_COOKIE               required (URL-encoded uev2.loc cookie)
 *   GOOGLE_PLACES_API_KEY       optional (tier-3 photo fallback)
 *   AXIOM_TOKEN                 optional (pipeline telemetry)
 */

import { PrismaClient, type Prisma } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import {
  cellToLatLng,
  gridDisk,
  latLngToCell,
  polygonToCells,
} from "h3-js";

import { MenuSourceResolver, type SourceAttempt } from "../apps/api/services/menuSources/resolver.js";
import { FatSecretSource } from "../apps/api/services/menuSources/fatSecretSource.js";
import { UeApiDirectSource } from "../apps/api/services/menuSources/ueApiDirectSource.js";
import {
  buildFeedCookieHeader,
  fetchFeedV1,
  paginateFeedV1,
  type UeFeedStoreCard,
} from "../apps/api/services/menuSources/ueApiClient.js";
import { estimateMacros } from "../apps/api/services/macroEstimationService.js";
import { fetchGooglePlacesPhoto } from "../apps/api/services/googlePlacesPhoto.js";
import type {
  MacroData,
  MenuSourceResult,
} from "../apps/api/services/menuSources/types.js";

import { filterPendingHexes, findIncompleteRunId } from "./hex-resume.js";
import { persistHex, type HexRestaurantData } from "./hex-persist.js";
import { validateItems, type ValidatedPair } from "./pipeline-utils.js";
import { API_SEMAPHORES } from "./semaphore.js";
import { withRetry } from "./retry.js";
import {
  PipelineEmitter,
  type RestaurantEvent,
} from "./pipeline-events.js";

// ─── Config / CLI args ───────────────────────────────────────────────────────

type Phase = "discover" | "enrich" | "both";

interface BoundingBox {
  south: number;
  north: number;
  west: number;
  east: number;
}

function parseStringArg(flag: string): string | null {
  // Support both `--flag value` and `--flag=value` forms.
  const eqPrefix = `${flag}=`;
  const eqMatch = process.argv.find((a) => a.startsWith(eqPrefix));
  if (eqMatch) return eqMatch.slice(eqPrefix.length);
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  return null;
}

function parseIntArg(flag: string, defaultVal: number): number {
  const raw = parseStringArg(flag);
  return raw === null ? defaultVal : parseInt(raw, 10);
}

function parsePhase(): Phase {
  const raw = parseStringArg("--phase") ?? "both";
  if (raw !== "discover" && raw !== "enrich" && raw !== "both") {
    console.error(`[ue-first] invalid --phase value: ${raw} (expected discover|enrich|both)`);
    process.exit(1);
  }
  return raw;
}

const CONFIG = {
  bbox: { south: 33.95, north: 34.15, west: -118.50, east: -118.15 } as BoundingBox,
  phase: parsePhase(),
  force: process.argv.includes("--force"),
  dryRun: process.argv.includes("--dry-run"),
  maxHexes: parseIntArg("--max-hexes", 0),
  hexId: parseStringArg("--hex-id"),
  skipDays: parseIntArg("--days", 7),
  probeResolution: 7,
  hexResolution: 7,
  concurrency: 20,
};

const REQUIRED_ENV_VARS = [
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
  "ANTHROPIC_API_KEY",
  "UE_LOC_COOKIE",
] as const;

// ─── Logging ─────────────────────────────────────────────────────────────────

function log(message: string): void {
  console.log(`[ue-first] ${message}`);
}

/**
 * Best-effort Slack alert on hard failures. Posts via chat.postMessage
 * using SLACK_BOT_TOKEN (same token the post-to-slack skill uses), to
 * SLACK_ALERT_CHANNEL or the default ops channel. Silently no-ops if the
 * token is unset (local dev). 3s timeout so a Slack outage never delays
 * the process exit that's about to happen anyway.
 */
async function notifySlack(title: string, errorDetail: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
  const channel = process.env.SLACK_ALERT_CHANNEL ?? "C0ANF717GBC"; // #clahh
  const truncated = errorDetail.length > 2500 ? errorDetail.slice(0, 2500) + "… (truncated)" : errorDetail;
  const body = JSON.stringify({
    channel,
    text: `:rotating_light: *[ue-first] ${title}*\n\`\`\`${truncated}\`\`\``,
  });
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${token}`,
      },
      body,
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || !json?.ok) {
      console.error(`[ue-first] Slack alert failed: HTTP ${res.status} ${json?.error ?? ""}`);
    }
  } catch (err) {
    console.error(`[ue-first] Slack alert threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Env + preflight ─────────────────────────────────────────────────────────

function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(`[ue-first] Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
}

async function validateApiCredentials(): Promise<void> {
  if (process.argv.includes("--skip-preflight")) {
    log(`Skipping API credential preflight (--skip-preflight)`);
    return;
  }

  // UE feed probe — catches expired/corrupt UE_LOC_COOKIE before the pipeline
  // burns a run on empty-state responses.
  try {
    buildFeedCookieHeader(34.05, -118.25);
  } catch (err) {
    console.error(`[ue-first] UE_LOC_COOKIE invalid: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`[ue-first] Capture a fresh cookie from ubereats.com → DevTools → Application → Cookies → uev2.loc.`);
    process.exit(1);
  }
  const feed = await fetchFeedV1(34.05, -118.25, { maxRetries: 1 });
  if (!feed?.data?.feedItems || feed.data.feedItems.length === 0) {
    console.error(`[ue-first] UE feed probe returned empty — cookie likely expired, rotate UE_LOC_COOKIE.`);
    process.exit(1);
  }

  // Anthropic preflight
  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env["ANTHROPIC_API_KEY"]!,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  if ([401, 403, 422].includes(anthropicRes.status)) {
    const body = await anthropicRes.text().catch(() => "<unreadable>");
    console.error(`[ue-first] Anthropic preflight failed: HTTP ${anthropicRes.status} — ${body.slice(0, 160)}`);
    process.exit(1);
  }

  log(`Preflight OK — UE feed reachable + Anthropic reachable`);
}

// ─── Probe grid ──────────────────────────────────────────────────────────────

/**
 * Generate res-5 probe centers covering the bbox. Expanded by gridDisk(1) so
 * stores just inside the bbox near an edge aren't missed.
 */
function computeProbeGrid(bbox: BoundingBox): Array<{ lat: number; lng: number; cell: string }> {
  // h3-js v4: polygonToCells takes [lat, lng] ring and resolution.
  const ring: [number, number][] = [
    [bbox.south, bbox.west],
    [bbox.south, bbox.east],
    [bbox.north, bbox.east],
    [bbox.north, bbox.west],
  ];
  const baseCells = polygonToCells(ring, CONFIG.probeResolution);
  const expanded = new Set<string>(baseCells);
  for (const c of baseCells) {
    for (const n of gridDisk(c, 1)) expanded.add(n);
  }
  return Array.from(expanded).map((cell) => {
    const [lat, lng] = cellToLatLng(cell);
    return { lat, lng, cell };
  });
}

// ─── Phase 1: Discover ───────────────────────────────────────────────────────

interface DiscoveryStats {
  probes: number;
  rawCards: number;
  uniqueCards: number;
  upserted: number;
  withPhoto: number;
}

async function probeFeed(
  probe: { lat: number; lng: number; cell: string },
): Promise<UeFeedStoreCard[]> {
  const cards: UeFeedStoreCard[] = [];
  try {
    for await (const card of paginateFeedV1(probe.lat, probe.lng)) {
      cards.push(card);
    }
  } catch (err) {
    log(`  probe ${probe.cell} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return cards;
}

async function runPhase1(prisma: PrismaClient): Promise<DiscoveryStats> {
  log(`Phase 1 (discover): computing probe grid for bbox ${JSON.stringify(CONFIG.bbox)}`);
  const probes = computeProbeGrid(CONFIG.bbox);
  log(`  ${probes.length} probe centers at res-${CONFIG.probeResolution} (with gridDisk(1) expansion)`);

  const dedup = new Map<string, UeFeedStoreCard>();
  let rawCards = 0;

  // Concurrency: clamp to UE semaphore (5 in-flight). Each probe may yield
  // multiple pages internally — paginateFeedV1 serializes those per probe.
  await Promise.all(
    probes.map(async (probe) => {
      const cards = await API_SEMAPHORES.ubereats.run(() => probeFeed(probe));
      rawCards += cards.length;
      for (const card of cards) {
        if (!dedup.has(card.storeUuid)) dedup.set(card.storeUuid, card);
      }
    }),
  );

  const unique = Array.from(dedup.values());
  log(`  probes done — ${rawCards} raw cards, ${unique.length} unique storeUuids`);

  let upserted = 0;
  let withPhoto = 0;

  if (CONFIG.dryRun) {
    log(`  [dry-run] would upsert ${unique.length} restaurants`);
  } else {
    for (const card of unique) {
      const homeHex = latLngToCell(card.lat, card.lng, CONFIG.hexResolution);
      const photoUrl = card.photoUrl ?? null;
      const photoSource = photoUrl ? "ue_feed_hero" : null;
      const rating = card.rating ?? null;
      const userRatingCount = card.userRatingCount ?? null;

      await prisma.$executeRaw`
        INSERT INTO "Restaurant" (
          "id", "storeUuid", "homeHex", "name", "address", "lat", "lng",
          "cuisineTags", "chainFlag", "source", "menuSourceId",
          "photoUrl", "photoSource", "rating", "userRatingCount",
          "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid(), ${card.storeUuid}, ${homeHex}, ${card.name}, '',
          ${card.lat}, ${card.lng},
          ${["restaurant"]}::text[], false, 'ue_feed', null,
          ${photoUrl}, ${photoSource}, ${rating}, ${userRatingCount},
          now(), now()
        )
        ON CONFLICT ("storeUuid") DO UPDATE SET
          "homeHex"         = COALESCE("Restaurant"."homeHex", EXCLUDED."homeHex"),
          "lat"             = COALESCE("Restaurant"."lat", EXCLUDED."lat"),
          "lng"             = COALESCE("Restaurant"."lng", EXCLUDED."lng"),
          "name"            = EXCLUDED."name",
          "photoUrl"        = COALESCE(EXCLUDED."photoUrl", "Restaurant"."photoUrl"),
          "photoSource"     = COALESCE(EXCLUDED."photoSource", "Restaurant"."photoSource"),
          "rating"          = COALESCE(EXCLUDED."rating", "Restaurant"."rating"),
          "userRatingCount" = COALESCE(EXCLUDED."userRatingCount", "Restaurant"."userRatingCount"),
          "updatedAt"       = now()
      `;
      upserted++;
      if (photoUrl) withPhoto++;
    }
  }

  const stats: DiscoveryStats = {
    probes: probes.length,
    rawCards,
    uniqueCards: unique.length,
    upserted,
    withPhoto,
  };
  log(`  Phase 1 done — ${stats.upserted} upserted, ${stats.withPhoto} with feed hero photo`);
  return stats;
}

// ─── Phase 1 invariants ──────────────────────────────────────────────────────

async function runPhase1Invariants(prisma: PrismaClient): Promise<void> {
  // 1. storeUuid uniqueness (schema-enforced, asserted anyway)
  const dupes = await prisma.$queryRaw<{ storeUuid: string; count: bigint }[]>`
    SELECT "storeUuid", COUNT(*)::bigint as count FROM "Restaurant"
    WHERE "source" = 'ue_feed'
    GROUP BY "storeUuid" HAVING COUNT(*) > 1
  `;
  if (dupes.length > 0) {
    console.error(`[ue-first] INVARIANT FAIL: ${dupes.length} duplicate storeUuids`);
    process.exit(1);
  }

  // 2. Geo validity + homeHex matches geo
  const rows = await prisma.$queryRaw<{ id: string; lat: number; lng: number; homeHex: string | null }[]>`
    SELECT "id", "lat", "lng", "homeHex" FROM "Restaurant" WHERE "source" = 'ue_feed'
  `;
  for (const r of rows) {
    if (r.lat < -90 || r.lat > 90 || r.lng < -180 || r.lng > 180) {
      console.error(`[ue-first] INVARIANT FAIL: restaurant ${r.id} has invalid geo (${r.lat}, ${r.lng})`);
      process.exit(1);
    }
    if (!r.homeHex) {
      console.error(`[ue-first] INVARIANT FAIL: restaurant ${r.id} missing homeHex`);
      process.exit(1);
    }
    const computed = latLngToCell(r.lat, r.lng, CONFIG.hexResolution);
    if (computed !== r.homeHex) {
      console.error(`[ue-first] INVARIANT FAIL: restaurant ${r.id} homeHex=${r.homeHex} but geo → ${computed}`);
      process.exit(1);
    }
  }

  log(`  Phase 1 invariants passed (${rows.length} rows)`);
}

// ─── Phase 2: Enrich ─────────────────────────────────────────────────────────

interface EnrichmentStats {
  processed: number;
  persistedRestaurants: number;
  persistedItems: number;
  skippedIncremental: number;
  skippedNoSource: number;
  skippedHaikuFailed: number;
  skippedValidationEmpty: number;
  rejectedItems: number;
  fatsecretHits: number;
  ueApiHits: number;
  photoSourceBreakdown: Record<string, number>;
  anthropicCalls: number;
  anthropicRateLimitErrors: number;
  anthropicApiErrors: number;
}

interface Phase2Restaurant {
  id: string;
  storeUuid: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  homeHex: string;
  photoUrl: string | null;
  photoSource: string | null;
  lastScrapedAt: Date | null;
  menuHash: string | null;
}

function computeMenuHash(itemNames: string[]): string {
  const sorted = [...itemNames].sort();
  return createHash("sha256").update(sorted.join("\n")).digest("hex").slice(0, 16);
}

/**
 * Extract structured diagnostics from an Anthropic SDK error. Iterates all
 * response headers rather than hardcoding names — whatever Anthropic returns
 * on the response lands in the summary, so a 429 wave shows exactly which
 * rate-limit dimension tripped (requests, input-tokens, output-tokens) plus
 * retry-after. Error body shape (`err.error.error.type`) comes from the SDK's
 * shared.d.ts (`ErrorResponse`); 429 is the HTTP standard for rate-limited.
 */
interface AnthropicErrDiag {
  summary: string;
  status?: number;
  isRateLimit: boolean;
}
function describeAnthropicError(err: unknown): AnthropicErrDiag {
  if (!(err instanceof Anthropic.APIError)) {
    return {
      summary: err instanceof Error ? err.message : String(err),
      isRateLimit: false,
    };
  }
  const parts: string[] = [`status=${err.status ?? "?"}`];
  const body = err.error as { error?: { type?: string; message?: string } } | undefined;
  if (body?.error?.type) parts.push(`type=${body.error.type}`);

  const h = err.headers;
  if (h && typeof (h as Headers).forEach === "function") {
    const relevant: Record<string, string> = {};
    (h as Headers).forEach((value: string, name: string) => {
      const lower = name.toLowerCase();
      if (lower.startsWith("anthropic-ratelimit-") || lower === "retry-after" || lower === "request-id") {
        relevant[lower] = value;
      }
    });
    for (const [k, v] of Object.entries(relevant).sort(([a], [b]) => a.localeCompare(b))) {
      parts.push(`${k}=${v}`);
    }
  }
  parts.push(`msg=${err.message}`);
  return {
    summary: parts.join(" "),
    status: err.status ?? undefined,
    isRateLimit: err.status === 429,
  };
}

async function loadRestaurantsForEnrichment(
  prisma: PrismaClient,
): Promise<Map<string, Phase2Restaurant[]>> {
  const rows = await prisma.$queryRaw<Phase2Restaurant[]>`
    SELECT "id", "storeUuid", "name", "address", "lat", "lng",
           "homeHex", "photoUrl", "photoSource", "lastScrapedAt", "menuHash"
    FROM "Restaurant"
    WHERE "source" = 'ue_feed' AND "homeHex" IS NOT NULL
  `;
  const byHex = new Map<string, Phase2Restaurant[]>();
  for (const r of rows) {
    const bucket = byHex.get(r.homeHex);
    if (bucket) bucket.push(r);
    else byHex.set(r.homeHex, [r]);
  }
  return byHex;
}

/**
 * Pre-fetch skip gate: if `lastScrapedAt` within `--days` AND `!--force`,
 * skip the UE call entirely. Cheaper than paying for the UE round-trip just
 * to discover via menuHash that nothing changed.
 */
function shouldSkipPreFetch(r: Phase2Restaurant): boolean {
  if (CONFIG.force) return false;
  if (!r.lastScrapedAt) return false;
  const ageDays = (Date.now() - r.lastScrapedAt.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays <= CONFIG.skipDays;
}

async function resolvePhotoUrl(
  r: Phase2Restaurant,
  menuResult: MenuSourceResult,
): Promise<{ url: string | null; source: string | null }> {
  // Tier 1: feed hero already persisted in Phase 1.
  if (r.photoUrl) return { url: r.photoUrl, source: r.photoSource ?? "ue_feed_hero" };

  // Tier 2: menu response hero (getStoreV1's heroImageUrls[0]).
  if (menuResult.restaurant?.imageUrl) {
    return { url: menuResult.restaurant.imageUrl, source: "ue_store_hero" };
  }

  // Tier 3: Google Places fallback.
  const placesUrl = await fetchGooglePlacesPhoto(r.name, r.lat, r.lng);
  if (placesUrl) return { url: placesUrl, source: "google_places" };

  return { url: null, source: null };
}

/**
 * Guard 1: per-hex cookie liveness probe.
 *
 * Runs a single `fetchFeedV1` at the hex center before enrichment starts. An
 * expired/corrupted UE_LOC_COOKIE returns empty feedItems at scale; if we
 * detect that we abort the whole run rather than burning Haiku $ on a cookie
 * that is already dead.
 */
async function assertCookieAliveForHex(hexId: string): Promise<void> {
  const [lat, lng] = cellToLatLng(hexId);
  const feed = await fetchFeedV1(lat, lng, { maxRetries: 1 });
  if (!feed?.data?.feedItems || feed.data.feedItems.length === 0) {
    const msg = `UE_LOC_COOKIE appears expired — cookie reprobe at hex ${hexId} (${lat.toFixed(4)}, ${lng.toFixed(4)}) returned empty. Rotate UE_LOC_COOKIE and resume.`;
    console.error(`[ue-first] ${msg}`);
    await notifySlack("UE cookie expired — rotate UE_LOC_COOKIE and resume", msg);
    process.exit(1);
  }
}

/**
 * Guard 3: in-tx invariant check (Option A).
 *
 * After bulk persist but before the checkpoint is written, assert that every
 * restaurant in this hex's hexResults actually landed with items > 0 AND a
 * 1:1 MenuItem ↔ MacroEstimate mapping. Throws to roll back the tx if not,
 * so we never commit half-populated restaurants or a phantom checkpoint.
 */
async function validateHexInTx(
  tx: Prisma.TransactionClient,
  restaurants: HexRestaurantData[],
): Promise<void> {
  if (restaurants.length === 0) return;
  const ids = restaurants.map((r) => r.restaurantId);
  const rows = await tx.$queryRaw<
    { restaurantId: string; itemCount: bigint; macroCount: bigint }[]
  >`
    SELECT r.id AS "restaurantId",
           COUNT(DISTINCT mi.id)::bigint AS "itemCount",
           COUNT(DISTINCT me.id)::bigint AS "macroCount"
    FROM "Restaurant" r
    LEFT JOIN "MenuItem" mi ON mi."restaurantId" = r.id
    LEFT JOIN "MacroEstimate" me ON me."menuItemId" = mi.id
    WHERE r.id = ANY(${ids}::text[])
    GROUP BY r.id
  `;
  const byId = new Map(rows.map((r) => [r.restaurantId, r]));
  const failures: string[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      failures.push(`${id}: row missing from invariant query`);
      continue;
    }
    const items = Number(row.itemCount);
    const macros = Number(row.macroCount);
    if (items === 0) failures.push(`${id}: items=0`);
    else if (items !== macros) failures.push(`${id}: items=${items} macros=${macros}`);
  }
  if (failures.length > 0) {
    throw new Error(
      `hex invariant check failed (${failures.length}/${ids.length} restaurants): ${failures.slice(0, 3).join("; ")}${failures.length > 3 ? "…" : ""}`,
    );
  }
}

async function runPhase2(
  prisma: PrismaClient,
  anthropic: Anthropic,
  emitter: PipelineEmitter,
  runId: string,
): Promise<EnrichmentStats> {
  log(`Phase 2 (enrich): loading ue_feed restaurants grouped by homeHex`);
  const byHex = await loadRestaurantsForEnrichment(prisma);
  const allHexIds = Array.from(byHex.keys());
  log(`  ${allHexIds.length} hexes, ${Array.from(byHex.values()).reduce((s, r) => s + r.length, 0)} restaurants total`);

  let pendingHexIds: string[];
  if (CONFIG.dryRun) {
    pendingHexIds = allHexIds;
    log(`  [dry-run] skipping resume check — processing all ${allHexIds.length} hexes`);
  } else {
    pendingHexIds = await filterPendingHexes(allHexIds, runId, prisma);
  }

  if (CONFIG.hexId) {
    if (!byHex.has(CONFIG.hexId)) {
      log(`  [hex-id] hex ${CONFIG.hexId} not found among ue_feed restaurants — exiting`);
      process.exit(1);
    }
    pendingHexIds = [CONFIG.hexId];
  } else if (CONFIG.maxHexes > 0 && pendingHexIds.length > CONFIG.maxHexes) {
    // Representative sample: sort by restaurant count ascending, pick evenly spaced.
    const sorted = [...pendingHexIds].sort(
      (a, b) => (byHex.get(a)?.length ?? 0) - (byHex.get(b)?.length ?? 0),
    );
    const step = (sorted.length - 1) / (CONFIG.maxHexes - 1);
    pendingHexIds = Array.from(
      { length: CONFIG.maxHexes },
      (_, i) => sorted[Math.round(i * step)]!,
    );
    log(`  [max-hexes] selected ${CONFIG.maxHexes} representative hexes`);
  }

  const stats: EnrichmentStats = {
    processed: 0,
    persistedRestaurants: 0,
    persistedItems: 0,
    skippedIncremental: 0,
    skippedNoSource: 0,
    skippedHaikuFailed: 0,
    skippedValidationEmpty: 0,
    rejectedItems: 0,
    fatsecretHits: 0,
    ueApiHits: 0,
    photoSourceBreakdown: {},
    anthropicCalls: 0,
    anthropicRateLimitErrors: 0,
    anthropicApiErrors: 0,
  };

  const hexesTotal = allHexIds.length;
  let hexesCompleted = hexesTotal - pendingHexIds.length;

  for (const hexId of pendingHexIds) {
    const restaurants = byHex.get(hexId)!;
    log(`\n===== Hex ${hexId} (${restaurants.length} restaurants) =====`);
    const hexStart = Date.now();

    // Guard 1: reprobe the cookie before burning Haiku $ on this hex.
    if (!CONFIG.dryRun) await assertCookieAliveForHex(hexId);

    // Guard 2: strict hex-level atomicity. Any systemic failure inside
    // processRestaurant throws; the pool rejects fast; we log + exit(2)
    // without writing persist or checkpoint so the hex stays pending for a
    // future resume.
    //
    // Rolling worker pool instead of fixed-size batches with Promise.all:
    // `CONFIG.concurrency` workers each pull the next restaurant off a shared
    // cursor, so a slow-tail restaurant (Escuela Taqueria 385 items, Canter's
    // 224, etc.) only parks *itself*, not the 19 peers in its batch. Max
    // concurrency is identical, so the UE + Haiku semaphores still cap the
    // outbound request rate — no change in bot-defense exposure.
    const hexResults: HexRestaurantData[] = [];
    try {
      let cursor = 0;
      const workerCount = Math.min(CONFIG.concurrency, restaurants.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= restaurants.length) return;
          const r = restaurants[idx]!;
          const result = await processRestaurant(
            r, idx + 1, restaurants.length,
            prisma, anthropic, emitter, runId, hexId, stats,
          );
          if (result != null) hexResults.push(result);
        }
      });
      await Promise.all(workers);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[ue-first] hex ${hexId} aborted (strict): ${msg}. No persist, no checkpoint — hex remains pending for resume.`,
      );
      await notifySlack(
        `hex ${hexId} aborted (strict) — resume from checkpoint after fixing`,
        msg,
      );
      process.exit(2);
    }

    if (CONFIG.dryRun) {
      const totalItems = hexResults.reduce((sum, r) => sum + r.items.length, 0);
      log(`  [dry-run] would persist ${totalItems} items across ${hexResults.length} restaurants`);
    } else if (hexResults.length > 0) {
      // Guard 3: in-tx invariant validator runs before the checkpoint is
      // written. Throws → rollback (persist + checkpoint both aborted).
      const totalItems = await persistHex(runId, hexId, hexResults, prisma, {
        validateInTx: validateHexInTx,
      });
      stats.persistedRestaurants += hexResults.length;
      stats.persistedItems += totalItems;
      log(`  persisted ${totalItems} items across ${hexResults.length} restaurants`);
    } else {
      // No-op hex still needs a checkpoint so resume doesn't re-process it.
      await prisma.pipelineCompletedHex.create({ data: { runId, hexId, count: 0 } });
    }

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

    const hexWallMs = Date.now() - hexStart;
    log(`  hex done (${hexesCompleted}/${hexesTotal}) — ${(hexWallMs / 1000).toFixed(1)}s`);
  }

  return stats;
}

async function processRestaurant(
  r: Phase2Restaurant,
  index: number,
  total: number,
  prisma: PrismaClient,
  anthropic: Anthropic,
  emitter: PipelineEmitter,
  runId: string,
  hexId: string,
  stats: EnrichmentStats,
): Promise<HexRestaurantData | null> {
  const restaurantStart = Date.now();
  stats.processed++;

  function emitEvent(
    status: string,
    source: string,
    itemCount: number,
    rejectedCount: number,
    attempts: SourceAttempt[],
  ): void {
    const event: RestaurantEvent = {
      type: "restaurant",
      runId,
      hexId,
      name: r.name,
      placeId: r.storeUuid,
      source,
      status,
      itemCount,
      rejectedCount,
      macroMismatchCount: 0,
      sourcesAttempted: attempts.map((a) => a.sourceId),
      sourcesFailed: attempts.filter((a) => a.status !== "ok").map((a) => a.sourceId),
      sourceAttempts: attempts.map((a) => {
        const base: { sourceId: string; status: "ok" | "not_found" | "error"; durationMs: number; reason?: string } = {
          sourceId: a.sourceId,
          status: a.status,
          durationMs: a.durationMs,
        };
        if (a.reason !== undefined) base.reason = a.reason;
        return base;
      }),
      nameMismatch: false,
      durationMs: Date.now() - restaurantStart,
      _time: new Date().toISOString(),
    };
    emitter.bufferRestaurant(event);
  }

  log(`  [${index}/${total}] ${r.name}`);

  // Pre-fetch skip gate.
  if (shouldSkipPreFetch(r)) {
    log(`    skipped (pre-fetch: lastScrapedAt within ${CONFIG.skipDays}d, no --force)`);
    stats.skippedIncremental++;
    emitEvent("skipped_incremental_prefetch", "none", 0, 0, []);
    return null;
  }

  const resolver = new MenuSourceResolver([
    new FatSecretSource(),
    new UeApiDirectSource(r.storeUuid, {}, API_SEMAPHORES.ubereats),
  ]);

  // The UE semaphore lives inside UeApiDirectSource now — it only wraps the
  // UE getStoreV1 call. Holding it around the whole resolver wastes UE slots
  // on FatSecret work for chain restaurants that never hit UE at all.
  const { result: resolverResult } = await withRetry(
    () => resolver.resolve(r.name, r.address, { lat: r.lat, lng: r.lng }),
    { label: `${r.name}/resolve` },
  );

  if (!resolverResult.found) {
    // UeApiDirectSource throws UeUnexpectedError for fetch failure / schema
    // drift / zero-items-after-parse. The resolver catches thrown errors and
    // records them with status: "error". Treat those as hard failures — a
    // schema drift on UE's side will corrupt every restaurant in the hex
    // silently if we soft-skip. Guard 2 (strict hex atomicity) catches the
    // throw and leaves the hex unchecked-pointed for resume.
    const ueError = resolverResult.attempts.find(
      (a) => a.sourceId === "ue_api_direct" && a.status === "error",
    );
    if (ueError) {
      throw new Error(
        `UE lookup failed unexpectedly for ${r.name} (storeUuid=${r.storeUuid}): ${ueError.reason ?? "unknown"}`,
      );
    }

    // Soft skip: UE explicitly returned an empty menu (no catalogSectionsMap).
    // Ghost kitchens between refreshes, closed-for-the-day stores, and
    // delisted storefronts land here. Mass source failures are caught by
    // Guard 1 (pre-probe) and the UE 403 circuit breaker.
    stats.skippedNoSource++;
    emitEvent("skipped_no_source", "none", 0, 0, resolverResult.attempts);
    log(`    skipped: [${r.name}] no menu source found (FatSecret + UE both missed)`);
    return null;
  }

  if (resolverResult.sourceId === "fatsecret") stats.fatsecretHits++;
  else if (resolverResult.sourceId === "ue_api_direct") stats.ueApiHits++;

  log(`    source: ${resolverResult.sourceId}, ${resolverResult.items.length} items`);

  // Post-fetch skip gate: we now have items, so compute hash and compare.
  // Matches preload.ts shouldSkipIncremental semantics (menuHash + age).
  const menuHash = computeMenuHash(resolverResult.items.map((i) => i.name));
  if (!CONFIG.force && r.lastScrapedAt && r.menuHash === menuHash) {
    const ageDays = (Date.now() - r.lastScrapedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays <= CONFIG.skipDays) {
      log(`    skipped (post-fetch: hash unchanged, fresh)`);
      stats.skippedIncremental++;
      emitEvent("skipped_incremental_hash", resolverResult.sourceId, 0, 0, resolverResult.attempts);
      return null;
    }
  }

  // Photo resolution — write photoSource + photoUrl back to Restaurant.
  const photo = await resolvePhotoUrl(r, resolverResult);
  if (photo.source) {
    stats.photoSourceBreakdown[photo.source] =
      (stats.photoSourceBreakdown[photo.source] ?? 0) + 1;
    if (!CONFIG.dryRun && (photo.url !== r.photoUrl || photo.source !== r.photoSource)) {
      await prisma.$executeRaw`
        UPDATE "Restaurant"
        SET "photoUrl" = ${photo.url}, "photoSource" = ${photo.source}, "updatedAt" = now()
        WHERE "id" = ${r.id}
      `;
    }
  }

  // Macro estimation: FatSecret carries official macros; UE needs Haiku.
  let macros: (MacroData | null)[];
  if (resolverResult.macros && resolverResult.macros.size > 0) {
    macros = resolverResult.items.map((item) =>
      resolverResult.macros?.get(item.name.toLowerCase()) ?? null,
    );
  } else {
    try {
      const { result } = await withRetry(
        () => API_SEMAPHORES.haiku.run(() => estimateMacros(resolverResult.items, anthropic)),
        {
          label: `${r.name}/haiku`,
          maxRetries: 5,
          backoffMs: [1000, 3000, 8000, 15000, 30000],
          computeDelayMs: (err) => {
            if (!(err instanceof Anthropic.APIError) || err.status !== 429) return null;
            const h = err.headers;
            if (!h || typeof (h as Headers).get !== "function") return null;
            const ra = (h as Headers).get("retry-after");
            if (!ra) return null;
            const sec = parseInt(ra, 10);
            return Number.isFinite(sec) && sec > 0 ? sec * 1000 : null;
          },
        },
      );
      macros = result;
      stats.anthropicCalls++;
    } catch (err) {
      // Strict: Haiku retries have already been exhausted by withRetry. A
      // macro estimation failure produces bad data, so abort the hex rather
      // than persist items without macros.
      const diag = describeAnthropicError(err);
      const msg = err instanceof Error ? err.message : String(err);
      stats.skippedHaikuFailed++;
      if (diag.isRateLimit) stats.anthropicRateLimitErrors++;
      else if (diag.status !== undefined) stats.anthropicApiErrors++;
      console.error(`[haiku-fail] ${r.name}: ${diag.summary}`);
      emitter.emitError({
        type: "error",
        runId,
        hexId,
        restaurant: r.name,
        placeId: r.storeUuid,
        stage: "macro_estimation",
        source: "haiku",
        error: diag.summary,
        retryable: true,
        retriesAttempted: 2,
        _time: new Date().toISOString(),
      });
      emitEvent("skipped_haiku_failed", resolverResult.sourceId, 0, 0, resolverResult.attempts);
      throw new Error(`[${r.name}] haiku failed after retries: ${msg}`);
    }
  }

  const { valid, rejected } = validateItems(resolverResult.items, macros);
  stats.rejectedItems += rejected.length;
  if (valid.length === 0) {
    // Soft skip: per-restaurant validation wipeout is usually a non-food
    // storefront (floral, gift, pharmacy) that UE classifies as REGULAR_STORE.
    // Log + drop this restaurant; the hex still commits with its other rows.
    // Hex-level strictness is enforced by Guard 3 (validateHexInTx).
    stats.skippedValidationEmpty++;
    emitEvent("skipped_validation_empty", resolverResult.sourceId, 0, rejected.length, resolverResult.attempts);
    log(`    skipped: [${r.name}] all ${rejected.length} items rejected by validation (likely non-food storefront)`);
    return null;
  }

  emitEvent("ok", resolverResult.sourceId, valid.length, rejected.length, resolverResult.attempts);
  return { restaurantId: r.id, items: valid, menuHash };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  validateEnv();
  await validateApiCredentials();

  const startTime = Date.now();
  const directUrl = process.env["POSTGRES_URL_NON_POOLING"]!;
  const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });
  const anthropic = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });
  const emitter = new PipelineEmitter();

  try {
    let discoveryStats: DiscoveryStats | null = null;
    if (CONFIG.phase === "discover" || CONFIG.phase === "both") {
      discoveryStats = await runPhase1(prisma);
      if (!CONFIG.dryRun) await runPhase1Invariants(prisma);
    }

    if (CONFIG.phase === "enrich" || CONFIG.phase === "both") {
      // Resolve runId against Phase 2's hex set.
      const byHex = await loadRestaurantsForEnrichment(prisma);
      const allHexIds = Array.from(byHex.keys());

      const runIdIdx = process.argv.indexOf("--run-id");
      let runId: string;
      if (runIdIdx !== -1 && process.argv[runIdIdx + 1]) {
        runId = process.argv[runIdIdx + 1]!;
        log(`Using explicit run ID: ${runId}`);
      } else {
        const incompleteRunId = await findIncompleteRunId(allHexIds.length, prisma);
        if (incompleteRunId) {
          runId = incompleteRunId;
          log(`Resuming incomplete run: ${runId}`);
        } else {
          runId = `run-ue-first-${new Date().toISOString().slice(0, 10)}`;
          log(`Starting fresh run: ${runId}`);
        }
      }

      const enrichStats = await runPhase2(prisma, anthropic, emitter, runId);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      log(`\nPhase 2 done — ${elapsed}s`);
      log(
        `  processed=${enrichStats.processed} persisted=${enrichStats.persistedRestaurants} ` +
          `items=${enrichStats.persistedItems} haiku=${enrichStats.anthropicCalls}`,
      );
      log(
        `  source: fatsecret=${enrichStats.fatsecretHits} ue_api=${enrichStats.ueApiHits} ` +
          `no_source=${enrichStats.skippedNoSource}`,
      );
      log(
        `  skipped: incremental=${enrichStats.skippedIncremental} ` +
          `haiku_failed=${enrichStats.skippedHaikuFailed} ` +
          `validation=${enrichStats.skippedValidationEmpty}`,
      );
      log(`  photoSource: ${JSON.stringify(enrichStats.photoSourceBreakdown)}`);

      await emitter.emitRun({
        type: "run",
        runId,
        durationTotal: `${elapsed}s`,
        hexesTotal: allHexIds.length,
        hexesCompleted: allHexIds.length,
        restaurantsDiscovered: discoveryStats?.uniqueCards ?? 0,
        restaurantsPersisted: enrichStats.persistedRestaurants,
        restaurantsFailed: enrichStats.skippedNoSource + enrichStats.skippedHaikuFailed,
        itemsTotal: enrichStats.persistedItems,
        costTotal: 0,
        _time: new Date().toISOString(),
      });
    }

    if (discoveryStats && CONFIG.phase === "discover") {
      log(
        `Phase 1 only — ${discoveryStats.probes} probes, ${discoveryStats.uniqueCards} unique stores, ` +
          `${discoveryStats.upserted} upserted`,
      );
    }

    await emitter.flush();
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  const detail = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`[ue-first] fatal: ${detail}`);
  await notifySlack("fatal (unhandled exception)", detail);
  process.exit(1);
});
