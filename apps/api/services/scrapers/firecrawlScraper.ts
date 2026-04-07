/**
 * Firecrawl WebScraper
 *
 * Uses Firecrawl API for web scraping and search:
 *   - scrape(url):   POST /v1/scrape → markdown
 *   - search(query): POST /v1/search → combined markdown from top results
 *
 * Requires FIRECRAWL_API_KEY env var. Returns null if key absent.
 */

import type { WebScraper } from "./types";

const FIRECRAWL_BASE = "https://api.firecrawl.dev";
const MIN_CONTENT_LENGTH = 200;

interface FirecrawlScrapeResponse {
  data?: { markdown?: string; content?: string };
}

interface FirecrawlSearchResult {
  markdown?: string;
  content?: string;
}

interface FirecrawlSearchResponse {
  data?: FirecrawlSearchResult[];
}

export class FirecrawlScraper implements WebScraper {
  readonly id = "firecrawl";

  private get apiKey(): string {
    return process.env["FIRECRAWL_API_KEY"] ?? "";
  }

  async scrape(url: string): Promise<string | null> {
    if (!this.apiKey) return null;

    let response: Response;
    try {
      response = await fetch(`${FIRECRAWL_BASE}/v1/scrape`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ url, formats: ["markdown"] }),
      });
    } catch {
      return null;
    }

    if (!response.ok) return null;

    const data = (await response.json()) as FirecrawlScrapeResponse;
    const content = data.data?.markdown ?? data.data?.content ?? null;
    if (!content || content.length < MIN_CONTENT_LENGTH) return null;

    return content;
  }

  async search(query: string, limit?: number): Promise<string | null> {
    if (!this.apiKey) return null;

    let response: Response;
    try {
      response = await fetch(`${FIRECRAWL_BASE}/v1/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query,
          limit: limit ?? 3,
          scrapeOptions: { formats: ["markdown"] },
        }),
      });
    } catch {
      return null;
    }

    if (!response.ok) return null;

    const data = (await response.json()) as FirecrawlSearchResponse;
    if (!data.data || data.data.length === 0) return null;

    const parts: string[] = [];
    for (const result of data.data) {
      const content = result.markdown ?? result.content ?? "";
      if (content.length > MIN_CONTENT_LENGTH) parts.push(content);
    }

    if (parts.length === 0) return null;
    return parts.join("\n\n---\n\n");
  }
}
