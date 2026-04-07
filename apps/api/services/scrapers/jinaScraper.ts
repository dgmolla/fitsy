/**
 * Jina WebScraper
 *
 * Uses Jina Reader API for free web scraping and search:
 *   - scrape(url):   GET https://r.jina.ai/{url} → markdown
 *   - search(query): GET https://s.jina.ai/{query} → search results as markdown
 *
 * Free tier: 20 RPM. We enforce a 3-second delay between calls.
 * No API key required for free tier.
 */

import type { WebScraper } from "./types";

const JINA_READER_BASE = "https://r.jina.ai/";
const JINA_SEARCH_BASE = "https://s.jina.ai/";
const RATE_LIMIT_DELAY_MS = 3000;
const MIN_CONTENT_LENGTH = 100;

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "text/plain",
    "X-No-Cache": "true",
  };
  const apiKey = process.env["JINA_API_KEY"];
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  return headers;
}

export class JinaScraper implements WebScraper {
  readonly id = "jina";

  private lastCallTime = 0;

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    if (elapsed < RATE_LIMIT_DELAY_MS && this.lastCallTime > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, RATE_LIMIT_DELAY_MS - elapsed),
      );
    }
    this.lastCallTime = Date.now();
  }

  async scrape(url: string): Promise<string | null> {
    await this.rateLimit();

    let response: Response;
    try {
      response = await fetch(`${JINA_READER_BASE}${url}`, {
        headers: buildHeaders(),
      });
    } catch {
      return null;
    }

    if (!response.ok) return null;

    const text = await response.text();
    if (!text || text.length < MIN_CONTENT_LENGTH) return null;

    return text;
  }

  async search(query: string, _limit?: number): Promise<string | null> {
    await this.rateLimit();

    let response: Response;
    try {
      response = await fetch(
        `${JINA_SEARCH_BASE}${encodeURIComponent(query)}`,
        { headers: buildHeaders() },
      );
    } catch {
      return null;
    }

    if (!response.ok) return null;

    const text = await response.text();
    if (!text || text.length === 0) return null;

    return text;
  }
}
