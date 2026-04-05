/**
 * Firecrawl MenuSource
 *
 * Fallback source for the menu resolution pipeline. Uses Firecrawl to
 * fetch menu content, then Haiku to extract structured menu items.
 *
 * Two entry points:
 *   - lookup(name, address)   — Firecrawl search by restaurant name
 *   - lookupByUrl(name, url)  — Firecrawl map+scrape using known website URL
 *
 * The resolver uses lookup(). The preload orchestrator calls lookupByUrl()
 * when the restaurant has a known websiteUri and search failed.
 *
 * Returns StructuredMenuItem[] — no macros. Caller passes items to
 * macroEstimationService for Haiku macro estimation.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MenuSource, MenuSourceResult, StructuredMenuItem } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const FIRECRAWL_BASE = "https://api.firecrawl.dev";
const MIN_MARKDOWN_LENGTH = 200;
const MAX_MENU_CHARS = 8000;
const MAX_MAP_URLS = 2;

// ─── Haiku extraction prompt ──────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are a menu data extractor. Given raw restaurant menu text (markdown or HTML), extract all menu items.

Return ONLY valid JSON (no markdown fences, no explanation) as an array of objects with these fields:
- name: item name (string, required)
- description: brief description if present in the menu text (string, optional)
- category: category like "Entree", "Side", "Drink", "Dessert", "Appetizer" (string, optional)
- section: menu section heading if identifiable (string, optional)

Include every distinct food item. Do not estimate macros. If no items are found, return [].`;

// ─── Firecrawl API types ──────────────────────────────────────────────────────

interface FirecrawlSearchResult {
  markdown?: string;
  content?: string;
}

interface FirecrawlSearchResponse {
  data?: FirecrawlSearchResult[];
}

interface FirecrawlMapResponse {
  links?: string[];
}

interface FirecrawlScrapeData {
  markdown?: string;
  content?: string;
}

interface FirecrawlScrapeResponse {
  data?: FirecrawlScrapeData;
}

// ─── Haiku extracted item shape ───────────────────────────────────────────────

interface ExtractedItem {
  name?: unknown;
  description?: unknown;
  category?: unknown;
  section?: unknown;
}

// ─── FirecrawlSource ──────────────────────────────────────────────────────────

export class FirecrawlSource implements MenuSource {
  readonly id = "firecrawl";

  private readonly anthropic: Anthropic;

  constructor(anthropic?: Anthropic) {
    this.anthropic = anthropic ?? new Anthropic();
  }

  /**
   * Primary MenuSource entry point. Uses Firecrawl search by restaurant name.
   * Does NOT use website URL (use lookupByUrl for that).
   */
  async lookup(name: string, _address: string): Promise<MenuSourceResult> {
    const markdown = await this.firecrawlSearch(name);
    if (!markdown) return { found: false, items: [], sourceId: this.id };

    const items = await this.extractItems(markdown);
    if (items.length === 0) return { found: false, items: [], sourceId: this.id };

    return { found: true, items, sourceId: this.id };
  }

  /**
   * Website-based fallback: Firecrawl map → scrape using known restaurant URL.
   * Called by the preload orchestrator when search failed and websiteUri is known.
   */
  async lookupByUrl(name: string, websiteUri: string): Promise<MenuSourceResult> {
    const markdown = await this.getMarkdownFromWebsite(websiteUri);
    if (!markdown) return { found: false, items: [], sourceId: this.id };

    const items = await this.extractItems(markdown);
    if (items.length === 0) return { found: false, items: [], sourceId: this.id };

    return { found: true, items, sourceId: this.id, restaurant: { name } };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async firecrawlSearch(name: string): Promise<string | null> {
    const apiKey = process.env["FIRECRAWL_API_KEY"] ?? "";
    const query = `${name} Los Angeles menu`;

    let response: Response;
    try {
      response = await fetch(`${FIRECRAWL_BASE}/v1/search`, {
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
    } catch {
      return null;
    }

    if (!response.ok) return null;

    const data = (await response.json()) as FirecrawlSearchResponse;
    if (!data.data || data.data.length === 0) return null;

    const parts: string[] = [];
    for (const result of data.data) {
      const content = result.markdown ?? result.content ?? "";
      if (content.length > MIN_MARKDOWN_LENGTH) parts.push(content);
    }

    if (parts.length === 0) return null;
    return parts.join("\n\n---\n\n");
  }

  private async getMarkdownFromWebsite(websiteUri: string): Promise<string | null> {
    // Try map → scrape first
    const menuUrls = await this.firecrawlMap(websiteUri);
    if (menuUrls.length > 0) {
      const parts: string[] = [];
      for (const url of menuUrls) {
        const content = await this.firecrawlScrape(url);
        if (content) parts.push(content);
      }
      if (parts.length > 0) return parts.join("\n\n---\n\n");
    }

    // Fallback: scrape homepage directly
    return this.firecrawlScrape(websiteUri);
  }

  private async firecrawlMap(websiteUri: string): Promise<string[]> {
    const apiKey = process.env["FIRECRAWL_API_KEY"] ?? "";

    let response: Response;
    try {
      response = await fetch(`${FIRECRAWL_BASE}/v1/map`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ url: websiteUri, search: "menu" }),
      });
    } catch {
      return [];
    }

    if (!response.ok) return [];

    const data = (await response.json()) as FirecrawlMapResponse;
    return (data.links ?? []).slice(0, MAX_MAP_URLS);
  }

  private async firecrawlScrape(url: string): Promise<string | null> {
    const apiKey = process.env["FIRECRAWL_API_KEY"] ?? "";

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
    const content = data.data?.markdown ?? data.data?.content ?? null;
    if (!content || content.length < MIN_MARKDOWN_LENGTH) return null;
    return content;
  }

  /**
   * Uses Haiku to extract StructuredMenuItem[] from raw markdown.
   * Extraction only — no macro estimation.
   */
  private async extractItems(markdown: string): Promise<StructuredMenuItem[]> {
    const truncated = markdown.slice(0, MAX_MENU_CHARS);

    let message: Awaited<ReturnType<typeof this.anthropic.messages.create>>;
    try {
      message = await this.anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 4096,
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Menu text:\n${truncated}` }],
      });
    } catch {
      return [];
    }

    const contentBlock = message.content[0];
    if (!contentBlock || contentBlock.type !== "text") return [];

    const raw = contentBlock.text.trim();
    const text = raw
      .replace(/^```(?:json)?\s*\n?/, "")
      .replace(/\n?```\s*$/, "");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }

    if (!Array.isArray(parsed)) return [];

    return (parsed as ExtractedItem[]).flatMap(
      (item): StructuredMenuItem[] => {
        if (typeof item.name !== "string" || item.name.length === 0) return [];

        const structured: StructuredMenuItem = { name: item.name };
        if (typeof item.description === "string" && item.description.length > 0)
          structured.description = item.description;
        if (typeof item.category === "string" && item.category.length > 0)
          structured.category = item.category;
        if (typeof item.section === "string" && item.section.length > 0)
          structured.section = item.section;
        return [structured];
      },
    );
  }
}
