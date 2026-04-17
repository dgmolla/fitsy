/**
 * Uber Eats MenuSource
 *
 * Extracts structured menu data from Uber Eats store pages via Schema.org
 * JSON-LD embedded in the server-side rendered HTML.
 *
 * Pipeline:
 *   1. URL discovery: Firecrawl search (one-time, ~$0.006) → cached
 *   2. Menu extraction: raw HTTP fetch ($0) → parse JSON-LD
 *      Restaurant.hasMenu.hasMenuSection[].hasMenuItem[]
 *
 * Data shape:
 *   Each MenuItem: name, description, price, section
 *
 * UberEats embeds full Schema.org JSON-LD in <script type="application/ld+json">
 * for Google Rich Results / SEO. This data is in the initial SSR HTML response —
 * no headless browser or JS rendering needed. A raw fetch() with browser UA works.
 *
 * Cost: $0.006 one-time for URL discovery (Firecrawl), then $0/fetch forever.
 * Coverage: excellent indie and chain coverage in major US cities.
 *
 * Falls back to Firecrawl markdown scraping if JSON-LD is absent.
 */

import type { MenuSource, MenuSourceResult, StructuredMenuItem } from "./types";
import type { UESitemapIndex } from "./ueSitemapIndex";
import type { WebScraper } from "../scrapers/types";
import { discoverUberEatsUrlViaBrave } from "../scrapers/braveSearchScraper";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const FIRECRAWL_BASE = "https://api.firecrawl.dev";

// ─── JSON-LD types ────────────────────────────────────────────────────────────

interface JsonLdOffer {
  "@type"?: string;
  price?: string | number;
  priceCurrency?: string;
}

interface JsonLdMenuItem {
  "@type"?: string;
  name?: string;
  description?: string;
  offers?: JsonLdOffer | JsonLdOffer[];
}

interface JsonLdMenuSection {
  "@type"?: string;
  name?: string;
  hasMenuItem?: JsonLdMenuItem | JsonLdMenuItem[];
}

interface JsonLdMenu {
  "@type"?: string;
  hasMenuSection?: JsonLdMenuSection | JsonLdMenuSection[];
}

interface JsonLdRestaurant {
  "@type"?: string;
  name?: string;
  servesCuisine?: string | string[];
  priceRange?: string;
  image?: string | string[];
  hasMenu?: JsonLdMenu | JsonLdMenu[];
  address?: {
    "@type"?: string;
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string;
    postalCode?: string;
    addressCountry?: string;
  };
  geo?: {
    "@type"?: string;
    latitude?: number;
    longitude?: number;
  };
}

// ─── Extraction helpers ───────────────────────────────────────────────────────

/**
 * Extract all <script type="application/ld+json"> blocks from HTML.
 */
export function extractJsonLdBlocks(html: string): unknown[] {
  const results: unknown[] = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const raw = match[1];
    if (raw === undefined) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      results.push(parsed);
    } catch {
      // malformed JSON-LD — skip
    }
  }

  return results;
}

/**
 * Find the first Restaurant-typed JSON-LD object from a list of blocks.
 */
export function findRestaurantBlock(blocks: unknown[]): JsonLdRestaurant | null {
  for (const block of blocks) {
    const found = searchForRestaurant(block);
    if (found) return found;
  }
  return null;
}

function searchForRestaurant(node: unknown): JsonLdRestaurant | null {
  if (!node || typeof node !== "object") return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = searchForRestaurant(item);
      if (found) return found;
    }
    return null;
  }

  const obj = node as Record<string, unknown>;

  if (obj["@type"] === "Restaurant" && obj["hasMenu"]) {
    return obj as JsonLdRestaurant;
  }

  // Check @graph wrapper
  if (obj["@graph"] && Array.isArray(obj["@graph"])) {
    return searchForRestaurant(obj["@graph"]);
  }

  return null;
}

/**
 * Parse items out of a Restaurant JSON-LD block.
 */
export function parseMenuItems(restaurant: JsonLdRestaurant): StructuredMenuItem[] {
  const items: StructuredMenuItem[] = [];

  const menus = Array.isArray(restaurant.hasMenu)
    ? restaurant.hasMenu
    : restaurant.hasMenu
    ? [restaurant.hasMenu]
    : [];

  for (const menu of menus) {
    const sections = Array.isArray(menu.hasMenuSection)
      ? menu.hasMenuSection
      : menu.hasMenuSection
      ? [menu.hasMenuSection]
      : [];

    for (const section of sections) {
      const sectionName = section.name;
      const menuItems = Array.isArray(section.hasMenuItem)
        ? section.hasMenuItem
        : section.hasMenuItem
        ? [section.hasMenuItem]
        : [];

      for (const menuItem of menuItems) {
        if (!menuItem.name) continue;

        let price: number | undefined;
        if (menuItem.offers) {
          const offer = Array.isArray(menuItem.offers)
            ? menuItem.offers[0]
            : menuItem.offers;
          if (offer?.price !== undefined) {
            const parsed = parseFloat(String(offer.price));
            if (!isNaN(parsed)) price = parsed;
          }
        }

        const item: StructuredMenuItem = { name: menuItem.name };
        if (menuItem.description !== undefined) item.description = menuItem.description;
        if (price !== undefined) item.price = price;
        if (sectionName !== undefined) item.section = sectionName;
        items.push(item);
      }
    }
  }

  return items;
}

// ─── URL discovery ────────────────────────────────────────────────────────────

/**
 * Firecrawl search result shape (url field).
 */
interface FirecrawlSearchHit {
  url?: string;
  sourceURL?: string;
  markdown?: string;
}
interface FirecrawlSearchResponse {
  data?: FirecrawlSearchHit[];
}
interface FirecrawlScrapeResponse {
  data?: { html?: string; markdown?: string; content?: string; };
}

/**
 * Use Firecrawl web search to find the location-specific UberEats store URL.
 *
 * UberEats store URLs require a UUID suffix (/store/{slug}/{uuid}) that can't
 * be guessed from the name alone. This resolves the real URL by searching
 * Firecrawl's index for the matching store page.
 *
 * Requires FIRECRAWL_API_KEY. Returns null if the key is absent or search fails.
 */
export async function discoverUberEatsUrl(
  name: string,
  address: string,
): Promise<string | null> {
  const apiKey = process.env["FIRECRAWL_API_KEY"];
  if (!apiKey) return null;

  // Search for the store page — broader query works better than site: operator
  const query = `${name} uber eats ${address}`;

  let response: Response;
  try {
    response = await fetch(`${FIRECRAWL_BASE}/v1/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, limit: 3 }),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const data = (await response.json()) as FirecrawlSearchResponse;
  for (const hit of data.data ?? []) {
    const url = hit.url ?? hit.sourceURL ?? "";
    // Only accept real store pages (with the UUID segment, not just /store/{slug})
    if (/ubereats\.com\/store\/[^/]+\/[^/?]+/.test(url)) return url;
  }
  return null;
}

/**
 * Use Firecrawl to scrape a known UberEats store URL, returning HTML.
 *
 * Kept for backward compatibility. Prefer scrapeUberEatsMarkdown() which
 * returns Markdown with embedded calorie data (UberEats has no JSON-LD).
 *
 * Requires FIRECRAWL_API_KEY.
 */
export async function scrapeUberEatsViaFirecrawl(url: string): Promise<string | null> {
  const apiKey = process.env["FIRECRAWL_API_KEY"];
  if (!apiKey) return null;

  let response: Response;
  try {
    response = await fetch(`${FIRECRAWL_BASE}/v1/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url, formats: ["html"] }),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const data = (await response.json()) as FirecrawlScrapeResponse;
  return data.data?.html ?? null;
}

/**
 * Use Firecrawl to scrape a known UberEats store URL, returning Markdown.
 *
 * UberEats does NOT embed JSON-LD. The Markdown returned by Firecrawl
 * contains menu items with calorie data in the format:
 *   {name}\\ \n${price} • {calories} Cal.
 *
 * Use parseUberEatsMarkdown() to extract items with name + calories.
 *
 * Requires FIRECRAWL_API_KEY.
 */
export async function scrapeUberEatsMarkdown(url: string): Promise<string | null> {
  const apiKey = process.env["FIRECRAWL_API_KEY"];
  if (!apiKey) return null;

  let response: Response;
  try {
    response = await fetch(`${FIRECRAWL_BASE}/v1/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url, formats: ["markdown"] }),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const data = (await response.json()) as FirecrawlScrapeResponse;
  return data.data?.markdown ?? null;
}

/**
 * Parse UberEats Firecrawl markdown into structured menu items.
 *
 * UberEats markdown from Firecrawl embeds calorie data in each menu item link:
 *   {name}\\\n${price} • {calories} Cal.
 *
 * This parser extracts item name and calories. Price is also extracted when
 * available. Items with calorie ranges (e.g. "430 - 530 Cal.") use the
 * lower bound as the calorie count.
 *
 * Returns an empty array if no items are found (e.g. login-gated page).
 */
export function parseUberEatsMarkdown(markdown: string): StructuredMenuItem[] {
  const items: StructuredMenuItem[] = [];
  const seen = new Set<string>();

  // UberEats markdown format (from Firecrawl):
  //   {name}\\\n\\\n${price} • {N} Cal.  (typical — two backslash-newlines between name and price)
  //   {name}\\\n${price} • {N} Cal.  (compact — one backslash-newline)
  //   {name}\\\n${price} • {N} - {M} Cal.  (range — use lower bound)
  //
  // Backslashes are Firecrawl's encoding of markdown hard line breaks.
  // There may be one or more "backslash + newline" sequences between the item
  // name and the price+calorie line (often an empty \ line as a blank separator).
  // We use `(?:\\+[ \t]*\n)+` to consume all of them.
  const lineBreakPattern = /([^\n\[\]\\|]+?)(?:\\+[ \t]*\n)+[ \t]*\$[\d.]+[ \t]*•[ \t]*(\d+)(?:[ \t]*-[ \t]*\d+)?[ \t]*Cal\./g;

  let match: RegExpExecArray | null;
  while ((match = lineBreakPattern.exec(markdown)) !== null) {
    const rawName = match[1]!.trim();
    const calories = parseInt(match[2]!, 10);

    // Skip empty names or obvious non-item matches (e.g. "#1 most liked")
    if (!rawName || rawName.startsWith("#") || isNaN(calories)) continue;

    // Deduplicate: UberEats often shows the same item in Featured and its section
    if (seen.has(rawName)) continue;
    seen.add(rawName);

    const item: StructuredMenuItem = { name: rawName, calories };
    items.push(item);
  }

  return items;
}

// ─── Raw fetch for JSON-LD ───────────────────────────────────────────────────

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Raw HTTP fetch of a UberEats store page. Returns HTML string.
 * UberEats SSRs the page with JSON-LD for Google SEO — no JS rendering needed.
 *
 * S-117: Rate limiting — 500ms minimum between fetches, 403 → backoff to 2s + retry once.
 */

// Module-level rate limit state for UE fetches (S-117)
let _ueLastFetchTime = 0;
const UE_MIN_DELAY_MS = 500;
const UE_BACKOFF_DELAY_MS = 2000;

export async function fetchUberEatsHtml(
  storeUrl: string,
): Promise<string | null> {
  // S-117: Enforce minimum delay between UE fetches
  const now = Date.now();
  const elapsed = now - _ueLastFetchTime;
  if (elapsed < UE_MIN_DELAY_MS) {
    await new Promise((resolve) => setTimeout(resolve, UE_MIN_DELAY_MS - elapsed));
  }

  try {
    _ueLastFetchTime = Date.now();
    const response = await fetch(storeUrl, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
    });

    // S-117: On 403, backoff to 2s and retry once
    if (response.status === 403) {
      console.warn(`[ubereats-fetch] 403 for ${storeUrl} — backing off ${UE_BACKOFF_DELAY_MS}ms and retrying`);
      await new Promise((resolve) => setTimeout(resolve, UE_BACKOFF_DELAY_MS));
      _ueLastFetchTime = Date.now();
      const retryResponse = await fetch(storeUrl, {
        headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
      });
      if (!retryResponse.ok) {
        console.warn(`[ubereats-fetch] retry failed with ${retryResponse.status} for ${storeUrl}`);
        return null;
      }
      return await retryResponse.text();
    }

    if (!response.ok) {
      console.warn(`[ubereats-fetch] HTTP ${response.status} for ${storeUrl}`);
      return null;
    }
    return await response.text();
  } catch (err) {
    console.warn(`[ubereats-fetch] network error for ${storeUrl}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Detect UberEats bot defense challenge page. */
export function isBotDefensePage(html: string): boolean {
  return html.includes("botdefense-ext-ui");
}

/**
 * Save failed UE HTML to disk for debugging transient failures.
 * Helps diagnose whether failures are login walls, JS challenges, or empty menus.
 */
function saveFailedHtml(storeUrl: string, html: string, reason: string): void {
  try {
    const debugDir = join(process.cwd(), "scripts", "cache", "ue-debug");
    mkdirSync(debugDir, { recursive: true });
    const slug = storeUrl.replace(/[^a-z0-9]+/gi, "-").slice(0, 80);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${ts}_${slug}.html`;
    const header = `<!-- UE debug dump\n     URL: ${storeUrl}\n     Reason: ${reason}\n     Time: ${new Date().toISOString()}\n     HTML length: ${html.length}\n-->\n`;
    writeFileSync(join(debugDir, filename), header + html);
    console.log(`[ubereats-debug] saved failed HTML: ${filename} (${reason})`); // eslint-disable-line no-console
  } catch {
    // Debug dump is best-effort
  }
}

/** Parsed result from JSON-LD extraction. */
interface JsonLdParseResult {
  items: StructuredMenuItem[];
  restaurant?: { name: string; cuisine?: string[]; priceRange?: string; imageUrl?: string };
  geo?: { lat: number; lng: number };
}

/**
 * Parse JSON-LD from raw HTML string (shared by raw fetch and Firecrawl paths).
 * Returns structured items + restaurant metadata + geo, or null.
 */
function parseJsonLdFromHtml(html: string): JsonLdParseResult | null {
  const blocks = extractJsonLdBlocks(html);
  const restaurantBlock = findRestaurantBlock(blocks);
  if (!restaurantBlock) return null;

  const items = parseMenuItems(restaurantBlock);
  if (items.length === 0) return null;

  const cuisine = restaurantBlock.servesCuisine
    ? Array.isArray(restaurantBlock.servesCuisine)
      ? restaurantBlock.servesCuisine
      : [restaurantBlock.servesCuisine]
    : undefined;

  const imageArr = restaurantBlock.image;
  const imageUrl = Array.isArray(imageArr) ? imageArr[0] : typeof imageArr === "string" ? imageArr : undefined;

  const restaurant: { name: string; cuisine?: string[]; priceRange?: string; imageUrl?: string } = {
    name: restaurantBlock.name ?? "",
  };
  if (cuisine) restaurant.cuisine = cuisine;
  if (restaurantBlock.priceRange) restaurant.priceRange = restaurantBlock.priceRange;
  if (imageUrl) restaurant.imageUrl = imageUrl;

  // Extract geo coordinates from JSON-LD (100% available on UE pages)
  const result: JsonLdParseResult = { items, restaurant };
  if (restaurantBlock.geo?.latitude != null && restaurantBlock.geo?.longitude != null) {
    result.geo = { lat: restaurantBlock.geo.latitude, lng: restaurantBlock.geo.longitude };
  }

  return result;
}

/**
 * Full JSON-LD extraction: raw fetch → parse → structured menu items.
 * Returns null if the page has no JSON-LD menu data.
 * Also returns `botDefense: true` if the page is a bot defense challenge.
 */
export async function extractMenuViaJsonLd(
  storeUrl: string,
): Promise<(JsonLdParseResult & { botDefense?: boolean }) | null> {
  const html = await fetchUberEatsHtml(storeUrl);
  if (!html) return null;

  if (isBotDefensePage(html)) {
    saveFailedHtml(storeUrl, html, "bot-defense");
    return { items: [], botDefense: true };
  }

  const result = parseJsonLdFromHtml(html);
  if (!result) {
    saveFailedHtml(storeUrl, html, "no-json-ld");
    return null;
  }

  return result;
}

/**
 * Firecrawl HTML fallback: scrape UE page via Firecrawl (bypasses bot defense)
 * and extract JSON-LD from the rendered HTML.
 * Cost: $0.006 per call. Only used when raw fetch hits bot defense.
 */
export async function extractMenuViaFirecrawl(
  storeUrl: string,
): Promise<JsonLdParseResult | null> {
  const html = await scrapeUberEatsViaFirecrawl(storeUrl);
  if (!html) return null;

  const result = parseJsonLdFromHtml(html);
  if (!result) {
    saveFailedHtml(storeUrl, html, "firecrawl-no-json-ld");
  }
  return result;
}

// ─── Photo-only helpers ───────────────────────────────────────────────────────

/**
 * Extract a restaurant image URL from JSON-LD blocks.
 * Unlike findRestaurantBlock(), does NOT require hasMenu — works even when
 * the page has a @type:Restaurant block without a menu (e.g. bot-gated pages
 * that still embed the header image in structured data).
 */
function extractPhotoFromBlocks(blocks: unknown[]): { imageUrl: string | null; geoLat?: number; geoLng?: number } {
  for (const block of blocks) {
    const result = searchBlockForPhoto(block);
    if (result) return result;
  }
  return { imageUrl: null };
}

function searchBlockForPhoto(node: unknown): { imageUrl: string | null; geoLat?: number; geoLng?: number } | null {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const obj = node as Record<string, unknown>;

  if (obj["@type"] === "Restaurant") {
    const img = obj["image"];
    const imageUrl = Array.isArray(img)
      ? (typeof img[0] === "string" ? img[0] : null)
      : typeof img === "string" ? img : null;
    if (!imageUrl) return null;
    const geo = obj["geo"] as { latitude?: number; longitude?: number } | undefined;
    const result: { imageUrl: string | null; geoLat?: number; geoLng?: number } = { imageUrl };
    if (geo?.latitude != null) result.geoLat = geo.latitude;
    if (geo?.longitude != null) result.geoLng = geo.longitude;
    return result;
  }

  if (obj["@graph"] && Array.isArray(obj["@graph"])) {
    for (const item of obj["@graph"]) {
      const result = searchBlockForPhoto(item);
      if (result) return result;
    }
  }

  return null;
}

// ─── Geo distance helper ─────────────────────────────────────────────────────

/** Haversine distance between two lat/lng points, in meters. */
function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── MenuSource implementation ────────────────────────────────────────────────

export class UberEatsSource implements MenuSource {
  readonly id = "ubereats";

  private cachedUrl: string | undefined;
  private sitemapIndex: UESitemapIndex | undefined;
  private searchScraper: WebScraper | undefined;

  /**
   * Create a UberEatsSource.
   * @param storeUrl — pre-discovered store URL (skip discovery)
   * @param sitemapIndex — UE sitemap index for free slug-based discovery
   * @param searchScraper — web scraper for search-based URL discovery (e.g. JinaScraper)
   */
  constructor(storeUrl?: string, sitemapIndex?: UESitemapIndex, searchScraper?: WebScraper) {
    this.cachedUrl = storeUrl ?? undefined;
    this.sitemapIndex = sitemapIndex;
    this.searchScraper = searchScraper;
  }

  /**
   * Build a guessed UberEats URL from a restaurant name (slug-based).
   * UberEats URLs are: /store/{slug}/{uuid} — we can't guess the UUID,
   * but some stores work with just the slug.
   */
  private buildSlugUrl(name: string): string {
    const slug = name
      .toLowerCase()
      .replace(/'/g, "")
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return `https://www.ubereats.com/store/${slug}`;
  }

  /**
   * Build a MenuSourceResult from parsed JSON-LD data, with geo + name validation.
   *
   * Validation strategy (geo-first):
   *   1. If both sides have lat/lng: accept if within 500m, reject if >500m
   *   2. If geo unavailable: fall back to name word matching (at least half of
   *      significant words must appear in the UE name)
   *   3. nameMismatch flag is set when names don't match exactly (for logging)
   */
  private buildResult(
    jsonLdResult: JsonLdParseResult,
    expectedName: string,
    expectedGeo?: { lat: number; lng: number },
  ): MenuSourceResult | null {
    const log = (msg: string) => console.log(`[ubereats] [${expectedName}] build-result: ${msg}`); // eslint-disable-line no-console
    let nameMismatch = false;

    // Geo-based validation (primary — both sources have lat/lng ~100% of the time)
    if (expectedGeo && jsonLdResult.geo) {
      const dist = haversineMeters(expectedGeo.lat, expectedGeo.lng, jsonLdResult.geo.lat, jsonLdResult.geo.lng);
      if (dist > 500) {
        log(`geo reject: ${Math.round(dist)}m apart (expected ${expectedGeo.lat.toFixed(4)},${expectedGeo.lng.toFixed(4)} vs UE ${jsonLdResult.geo.lat.toFixed(4)},${jsonLdResult.geo.lng.toFixed(4)})`);
        return null;
      }
      // Geo matched — set nameMismatch for logging but don't reject
      if (jsonLdResult.restaurant?.name) {
        const found = jsonLdResult.restaurant.name.toLowerCase();
        const expected = expectedName.toLowerCase();
        if (found !== expected && !(found.includes(expected) || expected.includes(found))) {
          nameMismatch = true;
          log(`geo ok (${Math.round(dist)}m) but name differs: "${jsonLdResult.restaurant.name}" vs "${expectedName}"`);
        }
      }
    } else if (jsonLdResult.restaurant?.name) {
      // Fallback: name-based validation (when geo unavailable)
      const found = jsonLdResult.restaurant.name.toLowerCase();
      const expected = expectedName.toLowerCase();
      if (found === expected || found.includes(expected) || expected.includes(found)) {
        // Exact or substring match — accept
      } else {
        const expectedWords = expected.split(/\s+/).filter(w => w.length > 2);
        const matchCount = expectedWords.filter(w => found.includes(w)).length;
        if (expectedWords.length > 0 && matchCount < Math.ceil(expectedWords.length / 2)) {
          log(`name reject (no geo): "${jsonLdResult.restaurant.name}" vs "${expectedName}" (${matchCount}/${expectedWords.length} words)`);
          return null;
        }
        nameMismatch = true;
      }
    }

    const result: MenuSourceResult = {
      found: true,
      items: jsonLdResult.items,
      sourceId: this.id,
      nameMismatch,
    };
    if (jsonLdResult.restaurant) result.restaurant = jsonLdResult.restaurant;
    return result;
  }

  /**
   * Try JSON-LD extraction from a UberEats store URL via raw fetch.
   * Returns { result, botDefense } — result is null on failure,
   * botDefense is true if UE served a bot defense challenge page.
   */
  private async tryJsonLd(
    storeUrl: string,
    expectedName: string,
    expectedGeo?: { lat: number; lng: number },
  ): Promise<{ result: MenuSourceResult | null; botDefense: boolean }> {
    const jsonLdResult = await extractMenuViaJsonLd(storeUrl);
    if (!jsonLdResult) return { result: null, botDefense: false };
    if (jsonLdResult.botDefense) return { result: null, botDefense: true };
    if (jsonLdResult.items.length === 0) return { result: null, botDefense: false };
    return { result: this.buildResult(jsonLdResult, expectedName, expectedGeo), botDefense: false };
  }

  /**
   * Try JSON-LD extraction via Firecrawl (S-134 — bypasses bot defense).
   * Only called when raw fetch hits bot defense. Cost: $0.006.
   */
  private async tryFirecrawlJsonLd(
    storeUrl: string,
    expectedName: string,
    expectedGeo?: { lat: number; lng: number },
  ): Promise<MenuSourceResult | null> {
    const jsonLdResult = await extractMenuViaFirecrawl(storeUrl);
    if (!jsonLdResult || jsonLdResult.items.length === 0) return null;
    return this.buildResult(jsonLdResult, expectedName, expectedGeo);
  }

  /**
   * Lookup menu data for a restaurant.
   *
   * Flow (S-134):
   *   1. URL discovery: url-cache → sitemap → Brave → Firecrawl search
   *   2. Raw fetch → JSON-LD (free, fast — works ~75% of the time)
   *   3. If bot defense detected → Firecrawl HTML fetch → JSON-LD ($0.006)
   */
  /** Optional URL cache — callers can set this to persist discovered URLs across runs. */
  urlCache: Map<string, string> | null = null;

  async lookup(name: string, address: string, geo?: { lat: number; lng: number }): Promise<MenuSourceResult> {
    const log = (step: string, msg: string) => console.log(`[ubereats] [${name}] ${step}: ${msg}`); // eslint-disable-line no-console

    // Track the best URL we've found (for Firecrawl fallback if bot defense blocks raw fetch)
    let botDefenseUrl: string | null = null;

    // Step 1: Try constructor-provided URL
    if (this.cachedUrl) {
      log("cached-url", `trying ${this.cachedUrl}`);
      const { result, botDefense } = await this.tryJsonLd(this.cachedUrl, name, geo);
      if (result) { log("cached-url", `ok (${result.items.length} items)`); return result; }
      if (botDefense) { botDefenseUrl = this.cachedUrl; log("cached-url", "bot defense detected"); }
      else { log("cached-url", "no JSON-LD or geo/name mismatch"); }
    }

    // Step 2: Try persistent URL cache (survives across runs)
    const cachedDiscoveredUrl = this.urlCache?.get(name);
    if (cachedDiscoveredUrl) {
      log("url-cache", `trying ${cachedDiscoveredUrl}`);
      const { result, botDefense } = await this.tryJsonLd(cachedDiscoveredUrl, name, geo);
      if (result) { log("url-cache", `ok (${result.items.length} items)`); return result; }
      if (botDefense) { botDefenseUrl ??= cachedDiscoveredUrl; log("url-cache", "bot defense detected"); }
      else { log("url-cache", "no JSON-LD or geo/name mismatch"); }
    }

    // Step 3: Try UE sitemap index (free, local lookup → raw fetch)
    if (this.sitemapIndex) {
      const sitemapUrl = this.sitemapIndex.findUrl(name);
      if (sitemapUrl) {
        log("sitemap", `trying ${sitemapUrl}`);
        const { result, botDefense } = await this.tryJsonLd(sitemapUrl, name, geo);
        if (result) {
          log("sitemap", `ok (${result.items.length} items)`);
          this.urlCache?.set(name, sitemapUrl);
          return result;
        }
        if (botDefense) { botDefenseUrl ??= sitemapUrl; log("sitemap", "bot defense detected"); }
        else { log("sitemap", "no JSON-LD or geo/name mismatch"); }
      } else {
        log("sitemap", "no slug match");
      }
    }

    // Step 4: Brave Search URL discovery (S-122 — preferred, faster + cheaper)
    const braveUrl = await discoverUberEatsUrlViaBrave(name, address);
    if (braveUrl) {
      log("brave-ue", `trying ${braveUrl}`);
      const { result, botDefense } = await this.tryJsonLd(braveUrl, name, geo);
      if (result) {
        log("brave-ue", `ok (${result.items.length} items)`);
        this.urlCache?.set(name, braveUrl);
        return result;
      }
      if (botDefense) { botDefenseUrl ??= braveUrl; log("brave-ue", "bot defense detected"); }
      else { log("brave-ue", "no JSON-LD or geo/name mismatch"); }
    } else {
      log("brave-ue", "no UE URL found");
    }

    // Step 5: Firecrawl URL discovery → raw fetch (fallback)
    const discoveredUrl = await discoverUberEatsUrl(name, address);
    if (discoveredUrl) {
      log("firecrawl-ue", `trying ${discoveredUrl}`);
      const { result, botDefense } = await this.tryJsonLd(discoveredUrl, name, geo);
      if (result) {
        log("firecrawl-ue", `ok (${result.items.length} items)`);
        this.urlCache?.set(name, discoveredUrl);
        return result;
      }
      if (botDefense) { botDefenseUrl ??= discoveredUrl; log("firecrawl-ue", "bot defense detected"); }
      else { log("firecrawl-ue", "no JSON-LD or geo/name mismatch"); }
    } else {
      log("firecrawl-ue", "no UE URL found");
    }

    // Step 6 (S-134): Firecrawl HTML fallback — bypasses bot defense
    if (botDefenseUrl) {
      log("firecrawl-fallback", `trying ${botDefenseUrl} via Firecrawl`);
      const result = await this.tryFirecrawlJsonLd(botDefenseUrl, name, geo);
      if (result) {
        log("firecrawl-fallback", `ok (${result.items.length} items)`);
        this.urlCache?.set(name, botDefenseUrl);
        return result;
      }
      log("firecrawl-fallback", "no JSON-LD from Firecrawl either");
    }

    log("result", "all steps failed — not found");
    return { found: false, items: [], sourceId: this.id };
  }

  /**
   * Photo-only lookup. Discovers the UE store URL and extracts just the
   * restaurant image URL from JSON-LD. Does NOT require menu items.
   *
   * Used as a photo fallback for chains where FatSecret provided the macros
   * but returned no imageUrl.
   *
   * Returns the photo URL string, or null if unavailable.
   */
  async lookupPhoto(name: string, address: string, geo?: { lat: number; lng: number }): Promise<string | null> {
    const log = (step: string, msg: string) => console.log(`[ubereats-photo] [${name}] ${step}: ${msg}`); // eslint-disable-line no-console

    // Collect candidate URLs in priority order (same as lookup())
    const urlsToTry: string[] = [];

    if (this.cachedUrl) urlsToTry.push(this.cachedUrl);

    const cachedDiscovered = this.urlCache?.get(name);
    if (cachedDiscovered && !urlsToTry.includes(cachedDiscovered)) urlsToTry.push(cachedDiscovered);

    if (this.sitemapIndex) {
      const sitemapUrl = this.sitemapIndex.findUrl(name);
      if (sitemapUrl && !urlsToTry.includes(sitemapUrl)) urlsToTry.push(sitemapUrl);
    }

    // Discovery: Brave first, then Firecrawl
    if (urlsToTry.length === 0) {
      const braveUrl = await discoverUberEatsUrlViaBrave(name, address);
      if (braveUrl) urlsToTry.push(braveUrl);
    }
    if (urlsToTry.length === 0) {
      const firecrawlUrl = await discoverUberEatsUrl(name, address);
      if (firecrawlUrl) urlsToTry.push(firecrawlUrl);
    }

    for (const storeUrl of urlsToTry) {
      log("fetch", storeUrl);
      const html = await fetchUberEatsHtml(storeUrl);
      if (!html || isBotDefensePage(html)) {
        log("fetch", "no html or bot defense — skip");
        continue;
      }

      const blocks = extractJsonLdBlocks(html);
      const { imageUrl, geoLat, geoLng } = extractPhotoFromBlocks(blocks);
      if (!imageUrl) {
        log("fetch", "no image in JSON-LD");
        continue;
      }

      // Geo validation — reject if clearly the wrong location (>500m off)
      if (geo && geoLat != null && geoLng != null) {
        const dist = haversineMeters(geo.lat, geo.lng, geoLat, geoLng);
        if (dist > 500) {
          log("fetch", `geo mismatch ${Math.round(dist)}m — skip`);
          continue;
        }
      }

      log("fetch", "got photo");
      return imageUrl;
    }

    log("result", "no photo found");
    return null;
  }
}
