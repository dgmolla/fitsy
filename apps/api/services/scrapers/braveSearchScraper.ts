/**
 * Brave Search WebScraper (S-122, S-123)
 *
 * Uses the Brave Web Search API for two purposes:
 *   1. UE URL discovery: find UberEats store URLs (S-122)
 *   2. Website menu fallback: find restaurant menu pages (S-123)
 *
 * Performance: 20 QPS (vs Firecrawl 0.17 QPS = 120x faster)
 * Cost: $5 per 1,000 queries (vs Firecrawl $6)
 * Free tier: 2,000 queries/month
 *
 * Requires BRAVE_SEARCH_API_KEY env var.
 */

import type { WebScraper } from "./types";

const BRAVE_SEARCH_BASE = "https://api.search.brave.com/res/v1/web/search";

interface BraveSearchResult {
  title?: string;
  url?: string;
  description?: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveSearchResult[];
  };
}

/**
 * Search Brave for a UberEats store URL matching the given restaurant.
 *
 * Query format: "{name} uber eats {city}" — using city from address for
 * location precision (avoids wrong location for multi-location restaurants).
 *
 * Returns the first matching ubereats.com/store/{slug}/{uuid} URL, or null.
 */
export async function discoverUberEatsUrlViaBrave(
  name: string,
  address: string,
): Promise<string | null> {
  const apiKey = process.env["BRAVE_SEARCH_API_KEY"];
  if (!apiKey) return null;

  // Extract city from address for location precision
  const cityMatch = address.match(/,\s*([^,]+),\s*[A-Z]{2}/);
  const city = cityMatch ? cityMatch[1]!.trim() : "";

  const query = `${name} uber eats ${city}`;

  try {
    const params = new URLSearchParams({ q: query, count: "5" });
    const response = await fetch(`${BRAVE_SEARCH_BASE}?${params}`, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as BraveSearchResponse;
    for (const result of data.web?.results ?? []) {
      const url = result.url ?? "";
      // Only accept real store pages (with the UUID segment)
      if (/ubereats\.com\/store\/[^/]+\/[^/?]+/.test(url)) return url;
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Brave Search WebScraper implementation.
 *
 * - search(): searches Brave and returns combined result descriptions as
 *   markdown (sufficient for Haiku extraction of menu items)
 * - scrape(): not supported by Brave Search API (it's a search engine, not
 *   a scraper). Falls back to null — callers should use Firecrawl for
 *   known-URL scraping.
 */
export class BraveSearchScraper implements WebScraper {
  readonly id = "brave_search";

  private get apiKey(): string {
    return process.env["BRAVE_SEARCH_API_KEY"] ?? "";
  }

  async scrape(_url: string): Promise<string | null> {
    // Brave Search API doesn't support scraping URLs — use Firecrawl for that
    return null;
  }

  async search(query: string, limit?: number): Promise<string | null> {
    if (!this.apiKey) return null;

    try {
      const params = new URLSearchParams({
        q: query,
        count: String(limit ?? 5),
      });
      const response = await fetch(`${BRAVE_SEARCH_BASE}?${params}`, {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": this.apiKey,
        },
      });

      if (!response.ok) return null;

      const data = (await response.json()) as BraveSearchResponse;
      const results = data.web?.results ?? [];
      if (results.length === 0) return null;

      // Combine result titles + descriptions into markdown for Haiku extraction
      const parts: string[] = [];
      for (const result of results) {
        const title = result.title ?? "";
        const desc = result.description ?? "";
        if (title || desc) {
          parts.push(`## ${title}\n\n${desc}`);
        }
      }

      if (parts.length === 0) return null;
      return parts.join("\n\n---\n\n");
    } catch {
      return null;
    }
  }
}
