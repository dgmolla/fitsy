/**
 * Yelp MenuSource
 *
 * Scrapes menu data from Yelp menu pages via Firecrawl markdown extraction,
 * then uses Haiku to parse the markdown into structured menu items.
 *
 * Yelp menu URLs follow the pattern: yelp.com/menu/{business-alias}
 * Business aliases are slugified names with location suffixes.
 *
 * Used as a fallback for restaurants not on UberEats.
 * Requires FIRECRAWL_API_KEY for scraping.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MenuSource, MenuSourceResult, StructuredMenuItem } from "./types";

const FIRECRAWL_BASE = "https://api.firecrawl.dev";
const MIN_MARKDOWN_LENGTH = 200;
const MAX_MENU_CHARS = 12000;

// ─── Yelp URL construction ───────────────────────────────────────────────────

function buildYelpSlug(name: string, city: string = "los-angeles"): string {
  return name
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    + "-" + city;
}

// ─── Haiku menu extraction ───────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a menu data extractor. Given raw restaurant menu text from Yelp, extract all menu items.

Return ONLY valid JSON (no markdown fences, no explanation) as an array of objects with these fields:
- name: item name (string, required)
- description: brief description if present (string, optional)
- price: price as a number if present (number, optional)
- section: menu section heading if identifiable (string, optional)

Include every distinct food item. Do not estimate macros. If no items are found, return [].`;

interface ExtractedItem {
  name?: unknown;
  description?: unknown;
  price?: unknown;
  section?: unknown;
}

function parseExtractedItems(raw: string): StructuredMenuItem[] {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```\s*$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const items: StructuredMenuItem[] = [];
  for (const entry of parsed as ExtractedItem[]) {
    if (!entry.name || typeof entry.name !== "string") continue;
    const item: StructuredMenuItem = { name: entry.name };
    if (typeof entry.description === "string" && entry.description) item.description = entry.description;
    if (typeof entry.price === "number") item.price = entry.price;
    if (typeof entry.section === "string" && entry.section) item.section = entry.section;
    items.push(item);
  }
  return items;
}

// ─── Firecrawl scraping ──────────────────────────────────────────────────────

async function scrapeYelpMenu(url: string): Promise<string | null> {
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

  const data = (await response.json()) as { data?: { markdown?: string } };
  return data.data?.markdown ?? null;
}

// ─── MenuSource implementation ───────────────────────────────────────────────

export class YelpSource implements MenuSource {
  readonly id = "yelp";

  constructor(private anthropic: Anthropic) {}

  async lookup(name: string, address: string): Promise<MenuSourceResult> {
    // Extract city from address for slug construction
    const cityMatch = address.match(/,\s*([^,]+),\s*[A-Z]{2}/);
    const city = cityMatch
      ? cityMatch[1]!.trim().toLowerCase().replace(/\s+/g, "-")
      : "los-angeles";

    const slug = buildYelpSlug(name, city);
    const menuUrl = `https://www.yelp.com/menu/${slug}`;

    const markdown = await scrapeYelpMenu(menuUrl);
    if (!markdown || markdown.length < MIN_MARKDOWN_LENGTH) {
      return { found: false, items: [], sourceId: this.id };
    }

    // Truncate to avoid Haiku token limits
    const truncated = markdown.slice(0, MAX_MENU_CHARS);

    const message = await this.anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      system: EXTRACTION_PROMPT,
      messages: [{ role: "user", content: `Extract menu items from this Yelp menu page:\n\n${truncated}` }],
    });

    const block = message.content[0];
    if (!block || block.type !== "text") {
      return { found: false, items: [], sourceId: this.id };
    }

    const items = parseExtractedItems(block.text);
    if (items.length === 0) {
      return { found: false, items: [], sourceId: this.id };
    }

    return { found: true, items, sourceId: this.id };
  }
}
