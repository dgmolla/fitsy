/**
 * Fitsy Preload Script — S-11
 *
 * One-shot batch runner: discovers restaurants in a target area, scrapes menus
 * via Firecrawl, estimates macros via Claude Haiku, and persists to PostgreSQL.
 *
 * Usage:
 *   npx tsx scripts/preload.ts
 *   npm run preload
 *
 * Environment variables:
 *   POSTGRES_PRISMA_URL   — Prisma pooled connection string (required)
 *   POSTGRES_URL_NON_POOLING — Prisma direct connection string (required)
 *   GOOGLE_PLACES_API_KEY — Google Places Nearby Search (required)
 *   ANTHROPIC_API_KEY     — Claude Haiku API (required)
 *   FIRECRAWL_API_KEY     — Firecrawl search/map/scrape (required)
 *   TARGET_LAT            — Target latitude (default: 34.0928)
 *   TARGET_LNG            — Target longitude (default: -118.3086)
 *   TARGET_RADIUS         — Search radius in meters (default: 1500)
 *   MAX_RESTAURANTS       — Max restaurants to process (default: 50)
 */

import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

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
  targetRadius: parseInt(process.env["TARGET_RADIUS"] ?? "1500", 10),
  maxRestaurants: parseInt(process.env["MAX_RESTAURANTS"] ?? "50", 10),
  firecrawlBaseUrl: "https://api.firecrawl.dev",
  googlePlacesBaseUrl: "https://places.googleapis.com/v1",
  claudeModel: "claude-haiku-4-5" as const,
  minMarkdownLength: 200,
  maxMenuChars: 8000,
  rateLimitDelayMs: 500,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlaceResult {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  websiteUri: string | null;
  types: string[];
}

interface HaikuMenuItem {
  n: string;
  desc?: string;
  cat?: string;
  cal: number;
  p: number;
  c: number;
  f: number;
  conf: "HIGH" | "MEDIUM" | "LOW";
}

interface PipelineStats {
  discovered: number;
  persisted: number;
  skippedNoWebsite: number;
  skippedNoMenu: number;
  skippedHaikuFailed: number;
  skippedDbError: number;
}

// Claude Haiku 4.5 pricing (per token)
const HAIKU_COST_PER_INPUT_TOKEN = 0.0000008; // $0.80/MTok
const HAIKU_COST_PER_OUTPUT_TOKEN = 0.000005; // $5.00/MTok
// Google Places Nearby Search pricing
const GOOGLE_PLACES_COST_PER_CALL = 0.005; // ~$5/1000 requests

interface CostStats {
  anthropicInputTokens: number;
  anthropicOutputTokens: number;
  anthropicCalls: number;
  googlePlacesCalls: number;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(
      `[preload] Missing required environment variables: ${missing.join(", ")}`
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Google Places — Nearby Search
// ---------------------------------------------------------------------------

interface GooglePlacesEntry {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  websiteUri?: string;
  types?: string[];
}

interface GooglePlacesNearbyResponse {
  places?: GooglePlacesEntry[];
  nextPageToken?: string;
}

async function discoverRestaurants(): Promise<PlaceResult[]> {
  const apiKey = process.env["GOOGLE_PLACES_API_KEY"] ?? "";
  const results: PlaceResult[] = [];
  let pageToken: string | undefined;
  let page = 0;
  const maxPages = 3;

  while (page < maxPages && results.length < CONFIG.maxRestaurants) {
    page++;
    const body: Record<string, unknown> = {
      includedTypes: ["restaurant"],
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: {
            latitude: CONFIG.targetLat,
            longitude: CONFIG.targetLng,
          },
          radius: CONFIG.targetRadius,
        },
      },
    };

    if (pageToken) {
      body["pageToken"] = pageToken;
    }

    const response = await fetch(
      `${CONFIG.googlePlacesBaseUrl}/places:searchNearby`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.location,places.websiteUri,places.types,nextPageToken",
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Places API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as GooglePlacesNearbyResponse;

    if (!data.places || data.places.length === 0) {
      break;
    }

    for (const place of data.places) {
      if (!place.id || !place.displayName?.text) continue;

      results.push({
        placeId: place.id,
        name: place.displayName.text,
        address: place.formattedAddress ?? "",
        lat: place.location?.latitude ?? CONFIG.targetLat,
        lng: place.location?.longitude ?? CONFIG.targetLng,
        websiteUri: place.websiteUri ?? null,
        types: place.types ?? [],
      });
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;

    await delay(CONFIG.rateLimitDelayMs);
  }

  return results.slice(0, CONFIG.maxRestaurants);
}

// ---------------------------------------------------------------------------
// Firecrawl — Search (primary menu discovery)
// ---------------------------------------------------------------------------

interface FirecrawlSearchResult {
  markdown?: string;
  content?: string;
  url?: string;
}

interface FirecrawlSearchResponse {
  data?: FirecrawlSearchResult[];
}

async function firecrawlSearch(
  restaurantName: string
): Promise<string | null> {
  const apiKey = process.env["FIRECRAWL_API_KEY"] ?? "";
  const query = `${restaurantName} Los Angeles menu`;

  const response = await fetch(`${CONFIG.firecrawlBaseUrl}/v1/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      limit: 3,
      scrapeOptions: { formats: ["markdown"] },
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as FirecrawlSearchResponse;

  if (!data.data || data.data.length === 0) {
    return null;
  }

  const parts: string[] = [];
  for (const result of data.data) {
    const content = result.markdown ?? result.content ?? "";
    if (content.length > CONFIG.minMarkdownLength) {
      parts.push(content);
    }
  }

  if (parts.length === 0) return null;

  return parts.join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// Firecrawl — Map (fallback: discover menu pages on restaurant's website)
// ---------------------------------------------------------------------------

interface FirecrawlMapResponse {
  links?: string[];
}

async function firecrawlMap(websiteUri: string): Promise<string[]> {
  const apiKey = process.env["FIRECRAWL_API_KEY"] ?? "";

  const response = await fetch(`${CONFIG.firecrawlBaseUrl}/v1/map`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url: websiteUri, search: "menu" }),
  });

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as FirecrawlMapResponse;
  return (data.links ?? []).slice(0, 2);
}

// ---------------------------------------------------------------------------
// Firecrawl — Scrape (fallback: scrape a single URL)
// ---------------------------------------------------------------------------

interface FirecrawlScrapeData {
  markdown?: string;
  content?: string;
}

interface FirecrawlScrapeResponse {
  data?: FirecrawlScrapeData;
}

async function firecrawlScrape(url: string): Promise<string | null> {
  const apiKey = process.env["FIRECRAWL_API_KEY"] ?? "";

  const response = await fetch(`${CONFIG.firecrawlBaseUrl}/v1/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url, formats: ["markdown"] }),
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as FirecrawlScrapeResponse;
  const content = data.data?.markdown ?? data.data?.content ?? null;
  if (!content || content.length < CONFIG.minMarkdownLength) return null;
  return content;
}

// ---------------------------------------------------------------------------
// Menu discovery — search + fallback
// ---------------------------------------------------------------------------

async function getMenuMarkdown(
  restaurantName: string,
  websiteUri: string
): Promise<string | null> {
  // Primary: Firecrawl search
  const searchMarkdown = await firecrawlSearch(restaurantName);
  if (searchMarkdown && searchMarkdown.length >= CONFIG.minMarkdownLength) {
    return searchMarkdown;
  }

  // Fallback 1: map the restaurant's website to find menu pages
  const menuUrls = await firecrawlMap(websiteUri);
  if (menuUrls.length > 0) {
    const parts: string[] = [];
    for (const url of menuUrls) {
      const content = await firecrawlScrape(url);
      if (content) parts.push(content);
      await delay(CONFIG.rateLimitDelayMs);
    }
    if (parts.length > 0) {
      return parts.join("\n\n---\n\n");
    }
  }

  // Fallback 2: scrape the homepage directly
  return firecrawlScrape(websiteUri);
}

// ---------------------------------------------------------------------------
// Claude Haiku — extract menu items and estimate macros
// ---------------------------------------------------------------------------

const HAIKU_SYSTEM_PROMPT = `You are a nutrition expert. Extract menu items from the provided restaurant menu text and estimate macros for each item.

Return ONLY valid JSON (no markdown fences, no explanation) as an array of objects with these exact fields:
- n: item name (string)
- desc: brief description (string, optional)
- cat: category like "Entree", "Side", "Drink", "Dessert" (string, optional)
- cal: calories (integer)
- p: protein in grams (number)
- c: carbohydrates in grams (number)
- f: fat in grams (number)
- conf: confidence level (string: "HIGH", "MEDIUM", or "LOW")

Confidence levels:
- HIGH: known chain item or clear description with specific ingredients
- MEDIUM: typical restaurant item with reasonable description
- LOW: vague name, no description, or unusual item

If you cannot extract any menu items, return an empty array: []`;

async function estimateMacros(
  restaurantName: string,
  menuMarkdown: string,
  anthropic: Anthropic,
  costStats: CostStats
): Promise<HaikuMenuItem[]> {
  const truncatedMarkdown = menuMarkdown.slice(0, CONFIG.maxMenuChars);

  const userMessage = `Restaurant: ${restaurantName}

Menu text:
${truncatedMarkdown}`;

  const message = await anthropic.messages.create({
    model: CONFIG.claudeModel,
    max_tokens: 4096,
    system: HAIKU_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  costStats.anthropicCalls++;
  costStats.anthropicInputTokens += message.usage.input_tokens;
  costStats.anthropicOutputTokens += message.usage.output_tokens;

  const contentBlock = message.content[0];
  if (!contentBlock || contentBlock.type !== "text") {
    throw new Error("Unexpected Haiku response type");
  }

  const text = contentBlock.text.trim();
  const items = JSON.parse(text) as unknown;

  if (!Array.isArray(items)) {
    throw new Error("Haiku response is not an array");
  }

  // Filter out items missing required fields
  return (items as HaikuMenuItem[]).filter(
    (item) =>
      typeof item.n === "string" &&
      item.n.length > 0 &&
      typeof item.cal === "number" &&
      typeof item.p === "number" &&
      typeof item.c === "number" &&
      typeof item.f === "number" &&
      ["HIGH", "MEDIUM", "LOW"].includes(item.conf)
  );
}

// ---------------------------------------------------------------------------
// Cuisine tag extraction from Google Places types
// ---------------------------------------------------------------------------

const CUISINE_TYPE_MAP: Record<string, string> = {
  american_restaurant: "american",
  asian_restaurant: "asian",
  bakery: "bakery",
  bar_and_grill: "bar_and_grill",
  barbecue_restaurant: "bbq",
  brazilian_restaurant: "brazilian",
  breakfast_restaurant: "breakfast",
  brunch_restaurant: "brunch",
  buffet_restaurant: "buffet",
  cafe: "cafe",
  cafeteria: "cafeteria",
  caribbean_restaurant: "caribbean",
  chinese_restaurant: "chinese",
  coffee_shop: "coffee",
  fast_food_restaurant: "fast_food",
  french_restaurant: "french",
  greek_restaurant: "greek",
  hamburger_restaurant: "burgers",
  indian_restaurant: "indian",
  indonesian_restaurant: "indonesian",
  italian_restaurant: "italian",
  japanese_restaurant: "japanese",
  korean_restaurant: "korean",
  latin_american_restaurant: "latin_american",
  lebanese_restaurant: "lebanese",
  mediterranean_restaurant: "mediterranean",
  mexican_restaurant: "mexican",
  middle_eastern_restaurant: "middle_eastern",
  pizza_restaurant: "pizza",
  ramen_restaurant: "ramen",
  sandwich_shop: "sandwiches",
  seafood_restaurant: "seafood",
  spanish_restaurant: "spanish",
  steak_house: "steakhouse",
  sushi_restaurant: "sushi",
  thai_restaurant: "thai",
  turkish_restaurant: "turkish",
  vegan_restaurant: "vegan",
  vegetarian_restaurant: "vegetarian",
  vietnamese_restaurant: "vietnamese",
};

const CHAIN_INDICATOR_TYPES = new Set([
  "fast_food_restaurant",
  "hamburger_restaurant",
  "pizza_restaurant",
]);

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

function extractCuisineTags(types: string[]): string[] {
  const tags: string[] = [];
  for (const type of types) {
    const tag = CUISINE_TYPE_MAP[type];
    if (tag) tags.push(tag);
  }
  return tags.length > 0 ? tags : ["restaurant"];
}

function isChain(name: string, types: string[]): boolean {
  const hasChainType = types.some((t) => CHAIN_INDICATOR_TYPES.has(t));
  const nameLower = name.toLowerCase();
  const isKnownChain = KNOWN_CHAIN_NAMES.some((chain) =>
    nameLower.includes(chain)
  );
  return hasChainType || isKnownChain;
}

// ---------------------------------------------------------------------------
// MenuItem upsert helper (findFirst + create/update)
// ---------------------------------------------------------------------------

async function upsertMenuItem(
  restaurantId: string,
  item: HaikuMenuItem,
  prisma: PrismaClient
): Promise<string> {
  const existing = await prisma.menuItem.findFirst({
    where: { restaurantId, name: item.n },
    select: { id: true },
  });

  if (existing) {
    await prisma.menuItem.update({
      where: { id: existing.id },
      data: {
        description: item.desc ?? null,
        category: item.cat ?? null,
      },
    });
    return existing.id;
  }

  const created = await prisma.menuItem.create({
    data: {
      restaurantId,
      name: item.n,
      description: item.desc ?? null,
      category: item.cat ?? null,
    },
  });
  return created.id;
}

// ---------------------------------------------------------------------------
// Prisma persistence
// ---------------------------------------------------------------------------

async function persistRestaurant(
  place: PlaceResult,
  menuItems: HaikuMenuItem[],
  prisma: PrismaClient
): Promise<void> {
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
    },
    update: {
      name: place.name,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      cuisineTags: extractCuisineTags(place.types),
      chainFlag: isChain(place.name, place.types),
    },
  });

  for (const item of menuItems) {
    try {
      const menuItemId = await upsertMenuItem(restaurant.id, item, prisma);

      await prisma.macroEstimate.create({
        data: {
          menuItemId,
          calories: Math.round(item.cal),
          proteinG: item.p,
          carbsG: item.c,
          fatG: item.f,
          confidence: item.conf,
          hadPhoto: false,
          expiresAt: null,
        },
      });
    } catch (err) {
      log(`  Failed to persist item "${item.n}": ${String(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string): void {
  console.log(`[preload] ${message}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  validateEnv();

  log(
    `Starting preload for 90029 (lat: ${CONFIG.targetLat}, lng: ${CONFIG.targetLng}, radius: ${CONFIG.targetRadius}m)`
  );
  log(`Max restaurants: ${CONFIG.maxRestaurants}`);

  const prisma = new PrismaClient();
  const anthropic = new Anthropic({
    apiKey: process.env["ANTHROPIC_API_KEY"],
  });

  const stats: PipelineStats = {
    discovered: 0,
    persisted: 0,
    skippedNoWebsite: 0,
    skippedNoMenu: 0,
    skippedHaikuFailed: 0,
    skippedDbError: 0,
  };

  const costStats: CostStats = {
    anthropicInputTokens: 0,
    anthropicOutputTokens: 0,
    anthropicCalls: 0,
    googlePlacesCalls: 0,
  };

  try {
    // Stage 1: Discover restaurants
    log("Discovering restaurants via Google Places...");
    let places: PlaceResult[];
    try {
      places = await discoverRestaurants();
      // discoverRestaurants paginates up to 3 pages; count actual pages used
      costStats.googlePlacesCalls = Math.ceil(places.length / 20) || 1;
    } catch (err) {
      log(`Google Places API error: ${String(err)}`);
      process.exit(1);
    }

    stats.discovered = places.length;
    log(`Discovered ${places.length} restaurants from Google Places`);

    if (places.length === 0) {
      log("No restaurants found. Exiting.");
      process.exit(0);
    }

    // Stage 2: Process each restaurant
    let index = 0;
    for (const place of places) {
      index++;
      log(`Processing ${place.name} (${index} of ${places.length})...`);

      // Skip restaurants without a website
      if (!place.websiteUri) {
        log(`  Skipping — no website`);
        stats.skippedNoWebsite++;
        continue;
      }

      const websiteUri = place.websiteUri;

      // Stage 2a: Scrape menu
      let menuMarkdown: string | null = null;
      try {
        menuMarkdown = await getMenuMarkdown(place.name, websiteUri);
      } catch (err) {
        log(`  Firecrawl error: ${String(err)}`);
      }

      if (!menuMarkdown) {
        log(`  Skipping — no menu found`);
        stats.skippedNoMenu++;
        await delay(CONFIG.rateLimitDelayMs);
        continue;
      }

      log(`  Firecrawl: ${menuMarkdown.length} chars of markdown`);

      // Stage 2b: Estimate macros
      let menuItems: HaikuMenuItem[] = [];
      try {
        menuItems = await estimateMacros(place.name, menuMarkdown, anthropic, costStats);
      } catch (err) {
        log(`  Haiku failed: ${String(err)}`);
        stats.skippedHaikuFailed++;
        await delay(CONFIG.rateLimitDelayMs);
        continue;
      }

      if (menuItems.length === 0) {
        log(`  Skipping — Haiku returned 0 items`);
        stats.skippedHaikuFailed++;
        await delay(CONFIG.rateLimitDelayMs);
        continue;
      }

      log(`  Haiku: extracted ${menuItems.length} menu items`);

      // Stage 2c: Persist to DB
      try {
        await persistRestaurant(place, menuItems, prisma);
        log(`  Persisted restaurant + ${menuItems.length} items`);
        stats.persisted++;
      } catch (err) {
        log(`  DB error: ${String(err)}`);
        stats.skippedDbError++;
      }

      await delay(CONFIG.rateLimitDelayMs);
    }
  } finally {
    await prisma.$disconnect();
  }

  log("Done.");
  log(
    `Summary: ${stats.discovered} discovered / ${stats.persisted} persisted / ` +
      `${stats.skippedNoWebsite} skipped (no website) / ` +
      `${stats.skippedNoMenu} skipped (no menu) / ` +
      `${stats.skippedHaikuFailed} skipped (Haiku failed) / ` +
      `${stats.skippedDbError} skipped (DB error)`
  );

  const anthropicCostUsd =
    costStats.anthropicInputTokens * HAIKU_COST_PER_INPUT_TOKEN +
    costStats.anthropicOutputTokens * HAIKU_COST_PER_OUTPUT_TOKEN;
  const googleCostUsd = costStats.googlePlacesCalls * GOOGLE_PLACES_COST_PER_CALL;
  const totalCostUsd = anthropicCostUsd + googleCostUsd;

  console.log(
    "[preload:costs]",
    JSON.stringify({
      restaurants_discovered: stats.discovered,
      restaurants_persisted: stats.persisted,
      anthropic_calls: costStats.anthropicCalls,
      anthropic_tokens_in: costStats.anthropicInputTokens,
      anthropic_tokens_out: costStats.anthropicOutputTokens,
      anthropic_cost_usd: parseFloat(anthropicCostUsd.toFixed(4)),
      google_places_calls: costStats.googlePlacesCalls,
      google_places_cost_usd: parseFloat(googleCostUsd.toFixed(4)),
      total_cost_usd: parseFloat(totalCostUsd.toFixed(4)),
    })
  );
}

main().catch((err) => {
  console.error("[preload] Fatal error:", err);
  process.exit(1);
});
