/**
 * FFN Parser Validation (S-73)
 *
 * Fetches each item listed in ground-truth.json from FastFoodNutrition.org
 * individual item pages, parses the HTML nutrition table via parseFFNTableRow,
 * and compares extracted macro values against the hand-curated fixture values.
 *
 * URL pattern: https://fastfoodnutrition.org/{chain.slug}/{item.slug}
 * Each item page has a single nutrition facts table — no LLM required.
 *
 * Pass criteria: 0% error — any mismatch is a parser bug, not an estimation
 * error, and must be investigated and fixed in ffnSource.ts.
 *
 * Usage:
 *   npx tsx scripts/eval/ffn-validation/run.ts
 *
 * Requires network access to fastfoodnutrition.org.
 * No API keys needed — raw HTTP fetch only.
 */

import * as fs from "fs";
import * as path from "path";
import { parseFFNTableRow } from "../../../apps/api/services/menuSources/ffnSource.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GroundTruthMacros {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

interface GroundTruthItem {
  name: string;
  slug: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

interface GroundTruthChain {
  name: string;
  slug: string;
  items: GroundTruthItem[];
}

interface GroundTruth {
  chains: GroundTruthChain[];
}

interface ItemResult {
  chain: string;
  item: string;
  url: string;
  expected: GroundTruthMacros;
  got: GroundTruthMacros | null;
  pass: boolean;
  diffs: string[];
}

// ─── Load ground truth ────────────────────────────────────────────────────────

function loadGroundTruth(): GroundTruth {
  const fixturePath = path.join(__dirname, "ground-truth.json");
  const raw = fs.readFileSync(fixturePath, "utf-8");
  return JSON.parse(raw) as GroundTruth;
}

// ─── Compare macros ───────────────────────────────────────────────────────────

function compareMacros(
  expected: GroundTruthMacros,
  got: GroundTruthMacros | null,
  chain: string,
  item: string,
  url: string,
): ItemResult {
  if (got === null) {
    return {
      chain,
      item,
      url,
      expected,
      got: null,
      pass: false,
      diffs: [`Failed to extract macros from ${url}`],
    };
  }

  const diffs: string[] = [];
  const fields: (keyof GroundTruthMacros)[] = ["calories", "proteinG", "carbsG", "fatG"];
  for (const field of fields) {
    if (got[field] !== expected[field]) {
      diffs.push(`${field}: expected ${expected[field]}, got ${got[field]}`);
    }
  }

  return { chain, item, url, expected, got, pass: diffs.length === 0, diffs };
}

// ─── Browser UA (required — FFN may reject non-browser requests) ─────────────

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

const FFN_BASE = "https://fastfoodnutrition.org";

// ─── Fetch and parse one item page ────────────────────────────────────────────

async function validateItem(
  chain: GroundTruthChain,
  item: GroundTruthItem,
): Promise<ItemResult> {
  const url = `${FFN_BASE}/${chain.slug}/${item.slug}`;
  const expected: GroundTruthMacros = {
    calories: item.calories,
    proteinG: item.proteinG,
    carbsG: item.carbsG,
    fatG: item.fatG,
  };

  let html: string;
  try {
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) {
      return compareMacros(expected, null, chain.name, item.name, url);
    }
    html = await response.text();
  } catch {
    return compareMacros(expected, null, chain.name, item.name, url);
  }

  const parsed = parseFFNTableRow(html);

  const allFieldsPresent =
    parsed.calories !== undefined &&
    parsed.proteinG !== undefined &&
    parsed.carbsG !== undefined &&
    parsed.fatG !== undefined;

  if (!allFieldsPresent) {
    return compareMacros(expected, null, chain.name, item.name, url);
  }

  const got: GroundTruthMacros = {
    calories: parsed.calories!,
    proteinG: parsed.proteinG!,
    carbsG: parsed.carbsG!,
    fatG: parsed.fatG!,
  };

  return compareMacros(expected, got, chain.name, item.name, url);
}

// ─── Report ───────────────────────────────────────────────────────────────────

function printResults(results: ItemResult[]): void {
  const passed = results.filter((r) => r.pass);
  const failed = results.filter((r) => !r.pass);

  console.log("\n" + "=".repeat(70));
  console.log("FFN PARSER VALIDATION RESULTS");
  console.log("=".repeat(70));

  if (failed.length === 0) {
    console.log(`\nALL ${results.length} ITEMS PASSED — 0 parser errors\n`);
  } else {
    console.log(`\nFAILED: ${failed.length} / ${results.length} items\n`);
    for (const r of failed) {
      console.log(`  FAIL  ${r.chain} → ${r.item}`);
      console.log(`        URL: ${r.url}`);
      for (const diff of r.diffs) {
        console.log(`        ${diff}`);
      }
    }
    console.log("");
  }

  console.log(`Passed: ${passed.length} / ${results.length}`);
  console.log(`Failed: ${failed.length} / ${results.length}`);
  console.log("=".repeat(70));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const groundTruth = loadGroundTruth();
  const allResults: ItemResult[] = [];

  for (const chain of groundTruth.chains) {
    console.log(`\n${chain.name} (${chain.items.length} items)`);
    for (const item of chain.items) {
      const result = await validateItem(chain, item);
      const icon = result.pass ? "PASS" : "FAIL";
      const diffStr = result.diffs.length > 0 ? ` — ${result.diffs.join(", ")}` : "";
      console.log(`  [${icon}] ${item.name}${diffStr}`);
      allResults.push(result);
    }
  }

  printResults(allResults);

  const failed = allResults.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error(
      `\nParser validation FAILED — ${failed.length} mismatch(es) detected.`,
    );
    console.error(
      "These are parser bugs. Fix apps/api/services/menuSources/ffnSource.ts before shipping.\n",
    );
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
