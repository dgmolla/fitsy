/**
 * WebScraperSource — generic MenuSource backed by any WebScraper.
 *
 * Replaces the old FirecrawlSource with a provider-agnostic implementation.
 * Uses a WebScraper for fetching markdown, then Haiku for extracting
 * structured menu items from the markdown.
 *
 * Two entry points:
 *   - lookup(name, address)   — web search by restaurant name
 *   - lookupByUrl(name, url)  — direct URL scrape
 */

import Anthropic from "@anthropic-ai/sdk";
import type { WebScraper } from "../scrapers/types";
import type { MenuSource, MenuSourceResult, StructuredMenuItem } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_MARKDOWN_LENGTH = 200;
const MAX_MENU_CHARS = 8000;

// ─── Haiku extraction prompt ──────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are a menu data extractor. Given raw restaurant menu text (markdown or HTML), extract all menu items.

Return ONLY valid JSON (no markdown fences, no explanation) as an array of objects with these fields:
- name: item name (string, required)
- description: brief description if present in the menu text (string, optional)
- category: category like "Entree", "Side", "Drink", "Dessert", "Appetizer" (string, optional)
- section: menu section heading if identifiable (string, optional)

Include every distinct food item. Do not estimate macros. If no items are found, return [].`;

// ─── Haiku extracted item shape ───────────────────────────────────────────────

interface ExtractedItem {
  name?: unknown;
  description?: unknown;
  category?: unknown;
  section?: unknown;
}

// ─── WebScraperSource ─────────────────────────────────────────────────────────

export class WebScraperSource implements MenuSource {
  readonly id: string;

  constructor(
    private scraper: WebScraper,
    private anthropic: Anthropic,
  ) {
    this.id = scraper.id;
  }

  /**
   * Primary MenuSource entry point. Uses web search by restaurant name.
   */
  async lookup(name: string, _address: string): Promise<MenuSourceResult> {
    const query = `${name} menu`;
    const markdown = await this.scraper.search(query);
    if (!markdown || markdown.length < MIN_MARKDOWN_LENGTH) {
      return { found: false, items: [], sourceId: this.id };
    }

    const items = await this.extractItems(markdown);
    if (items.length === 0) return { found: false, items: [], sourceId: this.id };

    return { found: true, items, sourceId: this.id };
  }

  /**
   * Website-based lookup: scrape a known URL directly.
   */
  async lookupByUrl(name: string, websiteUri: string): Promise<MenuSourceResult> {
    const markdown = await this.scraper.scrape(websiteUri);
    if (!markdown || markdown.length < MIN_MARKDOWN_LENGTH) {
      return { found: false, items: [], sourceId: this.id };
    }

    const items = await this.extractItems(markdown);
    if (items.length === 0) return { found: false, items: [], sourceId: this.id };

    return { found: true, items, sourceId: this.id, restaurant: { name } };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

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
