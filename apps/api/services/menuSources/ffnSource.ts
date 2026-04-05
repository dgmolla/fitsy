/**
 * FastFoodNutrition (FFN) MenuSource
 *
 * Fetches official chain nutrition data from fastfoodnutrition.org via raw
 * HTTP. Returns a macros map keyed by item name — pipeline skips Haiku
 * estimation for chains with FFN coverage.
 *
 * Method: HTML table extraction. FFN uses static HTML tables where each row
 * has a `<td title="X in a Restaurant Y">` pattern containing the value.
 * No headless browser required.
 *
 * Coverage: chains only (McDonald's, IHOP, Chick-fil-A, etc.)
 */

import type { MacroData, MenuSource, MenuSourceResult, StructuredMenuItem } from "./types";

const FFN_BASE = "https://fastfoodnutrition.org";

// Browser UA required — FFN may reject non-browser requests
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

/**
 * Convert a restaurant name into a FFN URL slug.
 * e.g. "McDonald's" → "mcdonalds", "Chick-fil-A" → "chick-fil-a"
 */
export function toFFNSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/'/g, "")      // remove apostrophes
    .replace(/[^a-z0-9-]/g, "-") // replace non-alphanumeric with dashes
    .replace(/-+/g, "-")    // collapse consecutive dashes
    .replace(/^-|-$/g, ""); // trim leading/trailing dashes
}

/**
 * Parse a single nutrition row from FFN HTML.
 * Returns null if the row doesn't match the expected pattern.
 *
 * FFN table row format (single-item pages):
 *   <tr>
 *     <td class="nfactl"><span class="f700">Calories</span></td>
 *     <td title="Calories in a McDonald's Big Mac">540</td>
 *   </tr>
 *
 * Live FFN pages use "Amount of fat", "Amount of carbohydrates", and
 * "Amount of protein" title prefixes (not "Total Fat" / "Protein").
 * Values may have a "g" unit suffix (e.g. "28g"). We use first-wins to
 * avoid clobbering real values with "Percent daily value of …" rows that
 * also contain the keyword but carry a percent number, not a gram value.
 */
export function parseFFNTableRow(html: string): {
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
} {
  const result: { calories?: number; proteinG?: number; carbsG?: number; fatG?: number } = {};

  // Match <td title="...">…VALUE…</td> — value may be followed by a "g" unit.
  // Using a permissive inner match: extract the first integer/decimal in the cell.
  const tdPattern = /<td[^>]+title="([^"]*)"[^>]*>([\s\S]*?)<\/td>/gi;
  let match: RegExpExecArray | null;

  while ((match = tdPattern.exec(html)) !== null) {
    const rawTitle = match[1];
    const cellHtml = match[2];
    if (rawTitle === undefined || cellHtml === undefined) continue;
    const title = rawTitle.toLowerCase();

    // Skip percentage rows and "calories from fat"
    if (title.includes("percent") || title.includes("calories from")) continue;

    // Extract the first number in the cell (handles plain "540" and "28g")
    const valMatch = cellHtml.match(/(\d+\.?\d*)/);
    if (!valMatch?.[1]) continue;
    const value = parseFloat(valMatch[1]);

    // First-wins: only set each field once so "Amount of carbohydrates" (46g)
    // takes precedence over a later "Percent daily value of carbohydrates" (15).
    if (title.includes("calorie") && result.calories === undefined) {
      result.calories = value;
    } else if (title.includes("protein") && result.proteinG === undefined) {
      result.proteinG = value;
    } else if (title.includes("carb") && result.carbsG === undefined) {
      result.carbsG = value;
    } else if (
      title.includes("fat") &&
      !title.includes("saturated") &&
      !title.includes("trans") &&
      result.fatG === undefined
    ) {
      result.fatG = value;
    }
  }

  return result;
}

/**
 * Extract all menu items and their macros from a FFN restaurant page.
 *
 * FFN page structure: each item is a section with an <h3> item name and
 * a nutrition facts table. We find all item headings, then parse the
 * table that follows each heading.
 */
export function parseFFNPage(html: string): Map<string, MacroData> {
  const macros = new Map<string, MacroData>();

  // Match item blocks: <h3 ...>ITEM NAME</h3> followed by a table
  // FFN uses <h2 class="nfh2"> or <h3 class="nfh2"> for item names
  const itemPattern = /<h[23][^>]*class="[^"]*nf[^"]*"[^>]*>([\s\S]*?)<\/h[23]>([\s\S]*?)(?=<h[23]|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(html)) !== null) {
    const rawName = match[1];
    const tableHtml = match[2];
    if (rawName === undefined || tableHtml === undefined) continue;
    // Strip HTML tags from item name
    const itemName = rawName.replace(/<[^>]+>/g, "").trim();

    if (!itemName) continue;

    const parsed = parseFFNTableRow(tableHtml ?? "");

    if (
      parsed.calories !== undefined &&
      parsed.proteinG !== undefined &&
      parsed.carbsG !== undefined &&
      parsed.fatG !== undefined
    ) {
      macros.set(itemName.toLowerCase(), {
        calories: parsed.calories,
        proteinG: parsed.proteinG,
        carbsG: parsed.carbsG,
        fatG: parsed.fatG,
        confidence: "HIGH",
        source: "ffn",
      });
    }
  }

  return macros;
}

export class FFNSource implements MenuSource {
  readonly id = "ffn";

  async lookup(name: string, _address: string): Promise<MenuSourceResult> {
    const slug = toFFNSlug(name);
    const url = `${FFN_BASE}/${slug}`;

    let response: Response;
    try {
      response = await fetch(url, { headers: HEADERS });
    } catch {
      return { found: false, items: [], sourceId: this.id };
    }

    if (!response.ok) {
      return { found: false, items: [], sourceId: this.id };
    }

    const html = await response.text();

    // FFN 404s return a 200 with "not found" content in some cases
    if (html.includes("Page Not Found") || html.includes("404")) {
      return { found: false, items: [], sourceId: this.id };
    }

    const macros = parseFFNPage(html);

    if (macros.size === 0) {
      return { found: false, items: [], sourceId: this.id };
    }

    // Convert macro keys back to StructuredMenuItem format
    const items: StructuredMenuItem[] = Array.from(macros.keys()).map((key) => ({ name: key }));

    return {
      found: true,
      restaurant: { name },
      items,
      macros,
      sourceId: this.id,
    };
  }
}
