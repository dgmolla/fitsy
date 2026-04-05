/**
 * Uber Eats MenuSource
 *
 * Extracts full menu data from Uber Eats store pages via raw HTTP.
 * Uses JSON-LD `<script type="application/ld+json">` structured data
 * embedded in the page for Google Rich Results compatibility.
 *
 * Data shape:
 *   Restaurant → hasMenu → hasMenuSection[] → hasMenuItem[]
 *   Each MenuItem: name, description, offers.price
 *
 * Coverage: excellent indie and chain coverage in major US cities.
 * Bot detection: passive (not enforced on initial page load — required
 * for Google SEO, so removing it would hurt UE's search ranking).
 *
 * Returns structured items — no macros. Pipeline passes items to Haiku.
 */

import type { MenuSource, MenuSourceResult, StructuredMenuItem } from "./types";

const UE_BASE = "https://www.ubereats.com";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

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
 * Build a candidate Uber Eats store URL from restaurant name.
 * Uber Eats uses slugs like /store/mcdonalds-westwood/abc123
 *
 * This is a best-effort slug for direct fetch. In production the resolver
 * should cache discovered URLs in the DB after a successful lookup.
 */
export function toUberEatsSearchUrl(name: string, address: string): string {
  // Use UE's search endpoint — returns the store page with JSON-LD
  const params = new URLSearchParams({ q: `${name} ${address}` });
  return `${UE_BASE}/find-food?${params.toString()}`;
}

// ─── MenuSource implementation ────────────────────────────────────────────────

export class UberEatsSource implements MenuSource {
  readonly id = "ubereats";

  /**
   * The address is used to disambiguate stores (e.g., "McDonald's in Silver Lake
   * vs McDonald's in Santa Monica"). We search by name+address to get a direct
   * store page, then extract JSON-LD from it.
   */
  async lookup(name: string, address: string): Promise<MenuSourceResult> {
    // Try direct slug approach first (most restaurants are indexed)
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");

    const storeUrl = `${UE_BASE}/store/${slug}`;

    const html = await this.fetchPage(storeUrl);
    if (html) {
      const result = this.parseHTML(html, name);
      if (result.found) return result;
    }

    // Fallback: search page
    const searchUrl = toUberEatsSearchUrl(name, address);
    const searchHtml = await this.fetchPage(searchUrl);
    if (searchHtml) {
      const result = this.parseHTML(searchHtml, name);
      if (result.found) return result;
    }

    return { found: false, items: [], sourceId: this.id };
  }

  private async fetchPage(url: string): Promise<string | null> {
    let response: Response;
    try {
      response = await fetch(url, { headers: HEADERS });
    } catch {
      return null;
    }

    if (!response.ok) return null;
    return response.text();
  }

  private parseHTML(html: string, restaurantName: string): MenuSourceResult {
    const blocks = extractJsonLdBlocks(html);
    const restaurant = findRestaurantBlock(blocks);

    if (!restaurant) {
      return { found: false, items: [], sourceId: this.id };
    }

    const items = parseMenuItems(restaurant);

    if (items.length === 0) {
      return { found: false, items: [], sourceId: this.id };
    }

    const cuisine = restaurant.servesCuisine
      ? Array.isArray(restaurant.servesCuisine)
        ? restaurant.servesCuisine
        : [restaurant.servesCuisine]
      : undefined;

    const restaurantMeta: MenuSourceResult["restaurant"] = {
      name: restaurant.name ?? restaurantName,
    };
    if (cuisine !== undefined) restaurantMeta.cuisine = cuisine;
    if (restaurant.priceRange !== undefined) restaurantMeta.priceRange = restaurant.priceRange;

    return {
      found: true,
      restaurant: restaurantMeta,
      items,
      sourceId: this.id,
    };
  }
}
