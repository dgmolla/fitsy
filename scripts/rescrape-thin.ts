/**
 * Rescrape Thin Restaurants
 *
 * One-off script to re-scrape menus for restaurants with suspiciously few
 * menu items: Great White (1), Denny's Restaurant (1), Kuya Lord (2).
 *
 * Uses the same Firecrawl + Claude Haiku pipeline as preload.ts, but with
 * max_tokens: 8192 to avoid the truncation bug that caused thin results.
 *
 * Usage:
 *   cd fitsy && set -a && source .env.local && set +a && npx tsx scripts/rescrape-thin.ts
 */

import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev";
const CLAUDE_MODEL = "claude-haiku-4-5" as const;
const MIN_MARKDOWN_LENGTH = 200;
const MAX_MENU_CHARS = 16000;
const RATE_LIMIT_DELAY_MS = 500;

const TARGET_RESTAURANTS = [
  "Great White",
  "Denny's Restaurant",
  "Kuya Lord",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Firecrawl — Map (fallback: discover menu pages on restaurant's website)
// ---------------------------------------------------------------------------

interface FirecrawlMapResponse {
  links?: string[];
}

async function firecrawlMap(websiteUri: string): Promise<string[]> {
  const apiKey = process.env["FIRECRAWL_API_KEY"] ?? "";

  const response = await fetch(`${FIRECRAWL_BASE_URL}/v1/map`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url: websiteUri, search: "menu" }),
  });

  if (!response.ok) return [];

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

  const response = await fetch(`${FIRECRAWL_BASE_URL}/v1/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url, formats: ["markdown"] }),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as FirecrawlScrapeResponse;
  const content = data.data?.markdown ?? data.data?.content ?? null;
  if (!content || content.length < MIN_MARKDOWN_LENGTH) return null;
  return content;
}

// ---------------------------------------------------------------------------
// Firecrawl — Search
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

  const response = await fetch(`${FIRECRAWL_BASE_URL}/v1/search`, {
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
    const text = await response.text();
    log(`  Firecrawl search failed (${response.status}): ${text}`);
    return null;
  }

  const data = (await response.json()) as FirecrawlSearchResponse;

  if (!data.data || data.data.length === 0) {
    return null;
  }

  const parts: string[] = [];
  for (const result of data.data) {
    const content = result.markdown ?? result.content ?? "";
    if (content.length > MIN_MARKDOWN_LENGTH) {
      parts.push(content);
    }
  }

  if (parts.length === 0) return null;

  return parts.join("\n\n---\n\n");
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
  anthropic: Anthropic
): Promise<HaikuMenuItem[]> {
  const truncatedMarkdown = menuMarkdown.slice(0, MAX_MENU_CHARS);

  const userMessage = `Restaurant: ${restaurantName}

Menu text:
${truncatedMarkdown}`;

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8192, // Doubled from 4096 to fix truncation bug
    system: HAIKU_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const contentBlock = message.content[0];
  if (!contentBlock || contentBlock.type !== "text") {
    throw new Error("Unexpected Haiku response type");
  }

  const raw = contentBlock.text.trim();
  // Strip markdown fences if model wraps response despite instructions
  let text = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");

  // Try to extract JSON array if there's extra text around it
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    text = arrayMatch[0];
  }

  let items: unknown;
  try {
    items = JSON.parse(text);
  } catch (parseErr) {
    log(`  Haiku raw response (first 500 chars): ${raw.slice(0, 500)}`);
    throw parseErr;
  }

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
// Upsert helpers (copied from preload.ts)
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

async function upsertMacroEstimate(
  menuItemId: string,
  item: HaikuMenuItem,
  prisma: PrismaClient
): Promise<void> {
  const existing = await prisma.macroEstimate.findFirst({
    where: { menuItemId },
    select: { id: true },
    orderBy: { estimatedAt: "desc" },
  });

  const data = {
    calories: Math.round(item.cal),
    proteinG: item.p,
    carbsG: item.c,
    fatG: item.f,
    confidence: item.conf as "HIGH" | "MEDIUM" | "LOW",
    hadPhoto: false,
    expiresAt: null as Date | null,
  };

  if (existing) {
    await prisma.macroEstimate.update({ where: { id: existing.id }, data });
  } else {
    await prisma.macroEstimate.create({ data: { menuItemId, ...data } });
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string): void {
  console.log(`[rescrape-thin] ${message}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Validate required env vars
  const required = [
    "POSTGRES_PRISMA_URL",
    "ANTHROPIC_API_KEY",
    "FIRECRAWL_API_KEY",
  ];
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const anthropic = new Anthropic({
    apiKey: process.env["ANTHROPIC_API_KEY"],
  });

  const results: Array<{
    name: string;
    status: string;
    itemsBefore: number;
    itemsAfter: number;
  }> = [];

  try {
    for (const name of TARGET_RESTAURANTS) {
      log(`\n========== ${name} ==========`);

      // 1. Find the restaurant in the DB
      const restaurant = await prisma.restaurant.findFirst({
        where: { name },
        include: {
          menuItems: { select: { id: true } },
        },
      });

      if (!restaurant) {
        log(`  NOT FOUND in DB — skipping`);
        results.push({ name, status: "NOT_FOUND", itemsBefore: 0, itemsAfter: 0 });
        continue;
      }

      const itemsBefore = restaurant.menuItems.length;
      log(`  Found: id=${restaurant.id}, externalPlaceId=${restaurant.externalPlaceId}`);
      log(`  Current menu items: ${itemsBefore}`);

      // 2. Re-run firecrawlSearch
      log(`  Searching Firecrawl for "${name} Los Angeles menu"...`);
      let menuMarkdown = await firecrawlSearch(name);

      // For Denny's: the main website is a JS SPA that Firecrawl can't scrape well.
      // Search for Denny's menu from third-party sources that list actual items.
      if (name.toLowerCase().includes("denny")) {
        log(`  Denny's detected — trying targeted menu searches...`);
        const altSearches = [
          "Denny's menu items breakfast lunch dinner prices",
          "Denny's restaurant full menu Grand Slam pancakes burgers",
        ];
        for (const query of altSearches) {
          log(`  Trying: "${query}"`);
          const altApiKey = process.env["FIRECRAWL_API_KEY"] ?? "";
          const altResponse = await fetch(`${FIRECRAWL_BASE_URL}/v1/search`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${altApiKey}`,
            },
            body: JSON.stringify({
              query,
              limit: 5,
              scrapeOptions: { formats: ["markdown"] },
            }),
          });
          if (altResponse.ok) {
            const altData = (await altResponse.json()) as FirecrawlSearchResponse;
            if (altData.data) {
              const parts: string[] = [];
              for (const result of altData.data) {
                const content = result.markdown ?? result.content ?? "";
                if (content.length > MIN_MARKDOWN_LENGTH) {
                  parts.push(content);
                }
              }
              if (parts.length > 0) {
                const combined = parts.join("\n\n---\n\n");
                if (combined.length > (menuMarkdown?.length ?? 0)) {
                  log(`  Got ${combined.length} chars from alt search`);
                  menuMarkdown = combined;
                  break;
                }
              }
            }
          }
          await delay(RATE_LIMIT_DELAY_MS);
        }
      }

      // Generic fallback for when primary search fails
      if (!menuMarkdown || menuMarkdown.length < MIN_MARKDOWN_LENGTH) {
        log(`  Primary search returned insufficient data, trying alternate search...`);
        const altApiKey = process.env["FIRECRAWL_API_KEY"] ?? "";
        const altResponse = await fetch(`${FIRECRAWL_BASE_URL}/v1/search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${altApiKey}`,
          },
          body: JSON.stringify({
            query: `${name} menu food items prices`,
            limit: 3,
            scrapeOptions: { formats: ["markdown"] },
          }),
        });
        if (altResponse.ok) {
          const altData = (await altResponse.json()) as FirecrawlSearchResponse;
          if (altData.data) {
            const parts: string[] = [];
            for (const result of altData.data) {
              const content = result.markdown ?? result.content ?? "";
              if (content.length > MIN_MARKDOWN_LENGTH) {
                parts.push(content);
              }
            }
            if (parts.length > 0) {
              menuMarkdown = parts.join("\n\n---\n\n");
            }
          }
        }
        await delay(RATE_LIMIT_DELAY_MS);
      }

      if (!menuMarkdown || menuMarkdown.length < MIN_MARKDOWN_LENGTH) {
        log(`  No good markdown found (${menuMarkdown?.length ?? 0} chars) — skipping`);
        results.push({ name, status: "NO_MENU_FOUND", itemsBefore, itemsAfter: itemsBefore });
        await delay(RATE_LIMIT_DELAY_MS);
        continue;
      }

      log(`  Got ${menuMarkdown.length} chars of menu markdown (sending first ${Math.min(menuMarkdown.length, MAX_MENU_CHARS)} to Haiku)`);

      // 3. Send to Haiku with max_tokens: 8192
      log(`  Sending to Claude Haiku (max_tokens: 8192)...`);
      let menuItems: HaikuMenuItem[];
      try {
        menuItems = await estimateMacros(name, menuMarkdown, anthropic);
      } catch (err) {
        log(`  Haiku failed: ${String(err)}`);
        results.push({ name, status: "HAIKU_FAILED", itemsBefore, itemsAfter: itemsBefore });
        await delay(RATE_LIMIT_DELAY_MS);
        continue;
      }

      if (menuItems.length === 0) {
        log(`  Haiku returned 0 items — first 300 chars of markdown sent:`);
        log(`  ${menuMarkdown.slice(0, 300).replace(/\n/g, "\\n")}`);
        results.push({ name, status: "ZERO_ITEMS", itemsBefore, itemsAfter: itemsBefore });
        await delay(RATE_LIMIT_DELAY_MS);
        continue;
      }

      log(`  Haiku extracted ${menuItems.length} menu items`);

      // 4. Upsert menu items and macro estimates
      let upserted = 0;
      for (const item of menuItems) {
        try {
          const menuItemId = await upsertMenuItem(restaurant.id, item, prisma);
          await upsertMacroEstimate(menuItemId, item, prisma);
          upserted++;
        } catch (err) {
          log(`  Failed to upsert "${item.n}": ${String(err)}`);
        }
      }

      // Count final items
      const finalCount = await prisma.menuItem.count({
        where: { restaurantId: restaurant.id },
      });

      log(`  Upserted ${upserted} items. Menu items: ${itemsBefore} -> ${finalCount}`);
      results.push({ name, status: "OK", itemsBefore, itemsAfter: finalCount });

      await delay(RATE_LIMIT_DELAY_MS);
    }

    // Summary
    log(`\n========== SUMMARY ==========`);
    for (const r of results) {
      log(`  ${r.name}: ${r.status} (${r.itemsBefore} -> ${r.itemsAfter} items)`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[rescrape-thin] Fatal error:", err);
  process.exit(1);
});
