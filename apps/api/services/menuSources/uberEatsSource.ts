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

/**
 * Full JSON-LD extraction: raw fetch → parse → structured menu items.
 * Returns null if the page has no JSON-LD menu data.
 */
export async function extractMenuViaJsonLd(
  storeUrl: string,
): Promise<{ items: StructuredMenuItem[]; restaurant?: { name: string; cuisine?: string[]; priceRange?: string; imageUrl?: string } } | null> {
  const html = await fetchUberEatsHtml(storeUrl);
  if (!html) return null;

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

  // Extract hero image from JSON-LD (free)
  const imageArr = restaurantBlock.image;
  const imageUrl = Array.isArray(imageArr) ? imageArr[0] : typeof imageArr === "string" ? imageArr : undefined;

  const restaurant: { name: string; cuisine?: string[]; priceRange?: string; imageUrl?: string } = {
    name: restaurantBlock.name ?? "",
  };
  if (cuisine) restaurant.cuisine = cuisine;
  if (restaurantBlock.priceRange) restaurant.priceRange = restaurantBlock.priceRange;
  if (imageUrl) restaurant.imageUrl = imageUrl;

  return { items, restaurant };
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
   * Try JSON-LD extraction from a UberEats store URL.
   * Returns a MenuSourceResult if successful, null otherwise.
   *
   * S-118: Sets nameMismatch on the result if the scraped name doesn't
   * match the expected name (log-only, does not reject).
   */
  private async tryJsonLd(storeUrl: string, expectedName: string): Promise<MenuSourceResult | null> {
    const jsonLdResult = await extractMenuViaJsonLd(storeUrl);
    if (!jsonLdResult || jsonLdResult.items.length === 0) return null;

    let nameMismatch = false;

    // Validate: ensure the JSON-LD restaurant name roughly matches what we expected.
    // Prevents caching wrong restaurants (e.g. "Taoxi Asian Cuisine" for "TAO").
    if (jsonLdResult.restaurant?.name) {
      const found = jsonLdResult.restaurant.name.toLowerCase();
      const expected = expectedName.toLowerCase();
      // Check if either name contains a significant portion of the other
      const expectedWords = expected.split(/\s+/).filter(w => w.length > 2);
      const matchCount = expectedWords.filter(w => found.includes(w)).length;
      if (expectedWords.length > 0 && matchCount === 0) {
        // No significant word overlap — likely wrong restaurant
        return null;
      }
      // S-118: Flag mismatch if names don't match closely (but still accept)
      if (found !== expected && !(found.includes(expected) || expected.includes(found))) {
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
   * Lookup menu data for a restaurant.
   *
   * Flow:
   *   1. Try cached URL (if provided)
   *   2. Try persistent URL cache
   *   3. Try UE sitemap index (free)
   *   4. Brave Search URL discovery (S-122 — $0.005/query, 20 QPS)
   *   5. Firecrawl URL discovery (fallback — $0.006/query, 0.17 QPS)
   */
  /** Optional URL cache — callers can set this to persist discovered URLs across runs. */
  urlCache: Map<string, string> | null = null;

  async lookup(name: string, address: string): Promise<MenuSourceResult> {
    const log = (step: string, msg: string) => console.log(`[ubereats] [${name}] ${step}: ${msg}`);

    // Step 1: Try constructor-provided URL
    if (this.cachedUrl) {
      log("cached-url", `trying ${this.cachedUrl}`);
      const result = await this.tryJsonLd(this.cachedUrl, name);
      if (result) { log("cached-url", `ok (${result.items.length} items)`); return result; }
      log("cached-url", "no JSON-LD or name mismatch");
    }

    // Step 2: Try persistent URL cache (survives across runs)
    const cachedDiscoveredUrl = this.urlCache?.get(name);
    if (cachedDiscoveredUrl) {
      log("url-cache", `trying ${cachedDiscoveredUrl}`);
      const result = await this.tryJsonLd(cachedDiscoveredUrl, name);
      if (result) { log("url-cache", `ok (${result.items.length} items)`); return result; }
      log("url-cache", "no JSON-LD or name mismatch");
    }

    // Step 3: Try UE sitemap index (free, local lookup → raw fetch)
    if (this.sitemapIndex) {
      const sitemapUrl = this.sitemapIndex.findUrl(name);
      if (sitemapUrl) {
        log("sitemap", `trying ${sitemapUrl}`);
        const result = await this.tryJsonLd(sitemapUrl, name);
        if (result) {
          log("sitemap", `ok (${result.items.length} items)`);
          this.urlCache?.set(name, sitemapUrl);
          return result;
        }
        log("sitemap", "no JSON-LD or name mismatch");
      } else {
        log("sitemap", "no slug match");
      }
    }

    // Step 4: Brave Search URL discovery (S-122 — preferred, faster + cheaper)
    const braveUrl = await discoverUberEatsUrlViaBrave(name, address);
    if (braveUrl) {
      log("brave-ue", `trying ${braveUrl}`);
      const result = await this.tryJsonLd(braveUrl, name);
      if (result) {
        log("brave-ue", `ok (${result.items.length} items)`);
        this.urlCache?.set(name, braveUrl);
        return result;
      }
      log("brave-ue", "no JSON-LD or name mismatch");
    } else {
      log("brave-ue", "no UE URL found");
    }

    // Step 5: Firecrawl URL discovery → JSON-LD (fallback)
    const discoveredUrl = await discoverUberEatsUrl(name, address);
    if (discoveredUrl) {
      log("firecrawl-ue", `trying ${discoveredUrl}`);
      const result = await this.tryJsonLd(discoveredUrl, name);
      if (result) {
        log("firecrawl-ue", `ok (${result.items.length} items)`);
        this.urlCache?.set(name, discoveredUrl);
        return result;
      }
      log("firecrawl-ue", "no JSON-LD or name mismatch");
    } else {
      log("firecrawl-ue", "no UE URL found");
    }

    log("result", "all steps failed — not found");
    return { found: false, items: [], sourceId: this.id };
  }
}
