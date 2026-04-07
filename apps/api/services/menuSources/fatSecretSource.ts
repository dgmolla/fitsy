/**
 * FatSecret MenuSource
 *
 * Fetches official chain nutrition data from foods.fatsecret.com via raw
 * HTTP. Returns a macros map keyed by item name — pipeline skips Haiku
 * estimation for chains with FatSecret coverage.
 *
 * Method: HTML parsing. FatSecret lists items in `<table class="generic searchResult">`
 * blocks, each item as a `<tr>` with:
 *   - `<a class="prominent"><b>ITEM NAME</b></a>`
 *   - `Per 1 serving - Calories: Xkcal | Fat: X.XXg | Carbs: X.XXg | Protein: X.XXg`
 *
 * Sections are `<h2>` headers with `name="Section_Name"` attributes.
 *
 * Coverage: ~1,060 chains (broader than FFN's ~200).
 */

import type { MacroData, MenuSource, MenuSourceResult, StructuredMenuItem } from "./types";

const FATSECRET_BASE = "https://foods.fatsecret.com/calories-nutrition";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

/**
 * Convert a restaurant name into a FatSecret URL slug.
 * e.g. "McDonald's" → "mcdonalds", "Chick-fil-A" → "chick-fil-a"
 */
export function toFatSecretSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/'/g, "")           // remove apostrophes
    .replace(/[^a-z0-9-]/g, "-") // replace non-alphanumeric with dashes
    .replace(/-+/g, "-")         // collapse consecutive dashes
    .replace(/^-|-$/g, "");      // trim leading/trailing dashes
}

/**
 * Parse the macro line from FatSecret.
 * Format: "Per 1 serving - Calories: 590kcal | Fat: 34.00g | Carbs: 45.00g | Protein: 25.00g"
 */
export function parseMacroLine(line: string): {
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
} {
  const result: { calories?: number; proteinG?: number; carbsG?: number; fatG?: number } = {};

  const calMatch = line.match(/Calories:\s*([\d.]+)\s*kcal/i);
  if (calMatch?.[1]) result.calories = parseFloat(calMatch[1]);

  const fatMatch = line.match(/Fat:\s*([\d.]+)\s*g/i);
  if (fatMatch?.[1]) result.fatG = parseFloat(fatMatch[1]);

  const carbMatch = line.match(/Carbs:\s*([\d.]+)\s*g/i);
  if (carbMatch?.[1]) result.carbsG = parseFloat(carbMatch[1]);

  const proteinMatch = line.match(/Protein:\s*([\d.]+)\s*g/i);
  if (proteinMatch?.[1]) result.proteinG = parseFloat(proteinMatch[1]);

  return result;
}

interface ParsedItem {
  name: string;
  section?: string;
  macros: MacroData;
}

/**
 * Parse all items from a FatSecret restaurant page.
 *
 * Structure:
 *   <h2><a ... name="Section_Name">Chain Section</a>:</h2>
 *   <table class="generic searchResult">
 *     <tr><td>
 *       <a class="prominent"><b>Item Name</b></a>
 *       <div>Per 1 serving - Calories: Xkcal | Fat: Xg | Carbs: Xg | Protein: Xg</div>
 *     </td></tr>
 *     ...
 *   </table>
 */
export function parseFatSecretPage(html: string): ParsedItem[] {
  const items: ParsedItem[] = [];

  // Split by <h2> sections to track section names
  // Each section: <h2><a ... name="Section_Name">Chain Section</a>:</h2>
  // followed by item rows
  const sectionPattern = /<h2><a[^>]+name="([^"]*)"[^>]*>[^<]*<\/a>:?<\/h2>([\s\S]*?)(?=<h2>|<\/div>\s*<br|$)/gi;
  let sectionMatch: RegExpExecArray | null;

  while ((sectionMatch = sectionPattern.exec(html)) !== null) {
    const rawSection = sectionMatch[1];
    const sectionHtml = sectionMatch[2];
    if (!rawSection || !sectionHtml) continue;

    // Convert "Breakfast_Items" → "Breakfast Items"
    const section = rawSection.replace(/_/g, " ");

    // Find items within this section
    const itemPattern = /<a[^>]+class="prominent"[^>]*><b>([^<]+)<\/b><\/a>[\s\S]*?Per 1 serving[^<]*/gi;
    let itemMatch: RegExpExecArray | null;

    while ((itemMatch = itemPattern.exec(sectionHtml)) !== null) {
      const fullMatch = itemMatch[0];
      const itemName = itemMatch[1];
      if (!itemName) continue;

      const parsed = parseMacroLine(fullMatch);

      if (
        parsed.calories !== undefined &&
        parsed.proteinG !== undefined &&
        parsed.carbsG !== undefined &&
        parsed.fatG !== undefined
      ) {
        items.push({
          name: itemName.trim(),
          section,
          macros: {
            calories: parsed.calories,
            proteinG: parsed.proteinG,
            carbsG: parsed.carbsG,
            fatG: parsed.fatG,
            confidence: "HIGH",
            source: "fatsecret",
            dietaryTags: [],
          },
        });
      }
    }
  }

  return items;
}

export class FatSecretSource implements MenuSource {
  readonly id = "fatsecret";

  async lookup(name: string, _address: string): Promise<MenuSourceResult> {
    const slug = toFatSecretSlug(name);
    const url = `${FATSECRET_BASE}/${slug}`;

    let response: Response;
    try {
      response = await fetch(url, { headers: HEADERS, redirect: "follow" });
    } catch {
      return { found: false, items: [], sourceId: this.id };
    }

    if (!response.ok) {
      return { found: false, items: [], sourceId: this.id };
    }

    const html = await response.text();

    // FatSecret 404s may return 200 with generic content
    if (html.includes("No results found") || html.includes("Page Not Found")) {
      return { found: false, items: [], sourceId: this.id };
    }

    const parsed = parseFatSecretPage(html);

    if (parsed.length === 0) {
      return { found: false, items: [], sourceId: this.id };
    }

    // Build macros map (keyed by lowercased item name) and items array
    const macros = new Map<string, MacroData>();
    const items: StructuredMenuItem[] = [];

    for (const item of parsed) {
      macros.set(item.name.toLowerCase(), item.macros);
      const entry: StructuredMenuItem = { name: item.name };
      if (item.section) entry.section = item.section;
      items.push(entry);
    }

    return {
      found: true,
      restaurant: { name },
      items,
      macros,
      sourceId: this.id,
    };
  }
}
