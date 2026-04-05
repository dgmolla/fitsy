/**
 * Hero Eval: Uber Eats Pipeline vs FFN Ground Truth (S-72)
 *
 * End-to-end eval of the UberEats → Haiku macro estimation pipeline.
 * For each chain in ground-truth.json:
 *   1. Fetch Uber Eats store page (raw HTTP — same approach as UberEatsSource)
 *   2. Extract JSON-LD menu items via extractJsonLdBlocks + findRestaurantBlock + parseMenuItems
 *   3. Match UE items to FFN ground-truth items by name (fuzzy lowercase match)
 *   4. Run matched items through macroEstimationService (Haiku)
 *   5. Compare Haiku calorie estimates against FFN ground truth
 *
 * Metrics:
 *   - MdAPE (Median Absolute Percentage Error) for calories across all matched items
 *   - Red flag count: items with >15% calorie error
 *   - Catastrophic count: items with >50% calorie error
 *
 * Exit criteria (per docs/engineering/menu-data-sources-analysis.md):
 *   - MdAPE ≤ 8%
 *   - Red flags ≤ 12 / 60
 *   - Catastrophic errors ≤ 3 / 60
 *
 * Usage:
 *   npx tsx scripts/eval/hero-eval/run.ts
 *
 * Requires:
 *   - ANTHROPIC_API_KEY (from apps/api/.env.local or process env)
 *   - Network access to ubereats.com and fastfoodnutrition.org
 *
 * This eval makes live API calls. It is NOT a unit test.
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import {
  extractJsonLdBlocks,
  findRestaurantBlock,
  parseMenuItems,
} from "../../../apps/api/services/menuSources/uberEatsSource.js";
import { estimateMacros } from "../../../apps/api/services/macroEstimationService.js";
import type { StructuredMenuItem } from "../../../apps/api/services/menuSources/types.js";

// Load env from apps/api/.env.local (contains ANTHROPIC_API_KEY)
dotenv.config({ path: path.join(__dirname, "../../../apps/api/.env.local") });

// ─── Exit criteria ─────────────────────────────────────────────────────────────

const TARGET_MDAPE = 8; // percent
const TARGET_RED_FLAGS = 12; // out of 60
const TARGET_CATASTROPHIC = 3; // out of 60

// ─── Types ────────────────────────────────────────────────────────────────────

interface GroundTruthItem {
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

interface GroundTruthChain {
  name: string;
  ffnSlug: string;
  uberEatsSlug: string;
  items: GroundTruthItem[];
}

interface GroundTruth {
  chains: GroundTruthChain[];
}

interface ItemComparison {
  chain: string;
  itemName: string;
  groundTruthName: string;
  gtCalories: number;
  estimatedCalories: number;
  caloriePctError: number;
  isRedFlag: boolean;
  isCatastrophic: boolean;
  confidence: string;
  uberEatsFound: boolean;
}

interface ChainResult {
  chain: string;
  uberEatsFound: boolean;
  ueItemCount: number;
  matchedCount: number;
  comparisons: ItemComparison[];
}

interface EvalResults {
  chains: ChainResult[];
  totalMatched: number;
  totalGroundTruth: number;
  mdape: number;
  redFlagCount: number;
  catastrophicCount: number;
  targetMet: boolean;
  targets: {
    mdape: number;
    redFlags: number;
    catastrophic: number;
  };
}

// ─── Uber Eats fetch helpers ──────────────────────────────────────────────────

const UE_BASE = "https://www.ubereats.com";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchUberEatsPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  }
}

/**
 * Try multiple URL patterns for a chain's Uber Eats page.
 * Returns parsed items if found, null otherwise.
 */
async function fetchUberEatsItems(
  chain: GroundTruthChain,
): Promise<StructuredMenuItem[] | null> {
  const slugVariants = [
    chain.uberEatsSlug,
    chain.name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-"),
  ];

  // Deduplicate
  const uniqueSlugs = [...new Set(slugVariants)];

  for (const slug of uniqueSlugs) {
    const url = `${UE_BASE}/store/${slug}`;
    console.log(`    Trying: ${url}`);
    const html = await fetchUberEatsPage(url);
    if (!html) continue;

    const blocks = extractJsonLdBlocks(html);
    const restaurant = findRestaurantBlock(blocks);
    if (!restaurant) continue;

    const items = parseMenuItems(restaurant);
    if (items.length > 0) {
      console.log(`    Found ${items.length} items via JSON-LD`);
      return items;
    }
  }

  return null;
}

// ─── Item matching ────────────────────────────────────────────────────────────

/**
 * Normalize a menu item name for fuzzy matching.
 * Lowercases, removes punctuation, collapses whitespace.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find the best UE item match for a ground-truth item name.
 * Uses substring matching after normalization — handles slight naming differences
 * between FFN and Uber Eats (e.g., "Big Mac" vs "Big Mac Combo").
 */
function findBestMatch(
  gtName: string,
  ueItems: StructuredMenuItem[],
): StructuredMenuItem | null {
  const normGt = normalizeName(gtName);

  // Exact match first
  for (const ueItem of ueItems) {
    if (normalizeName(ueItem.name) === normGt) return ueItem;
  }

  // Substring match: GT name is contained in UE name (catches "Big Mac" in "Big Mac Combo")
  for (const ueItem of ueItems) {
    const normUe = normalizeName(ueItem.name);
    if (normUe.includes(normGt) || normGt.includes(normUe)) return ueItem;
  }

  // Word-overlap score: require at least 2 matching significant words
  const gtWords = normGt.split(" ").filter((w) => w.length > 2);
  let bestItem: StructuredMenuItem | null = null;
  let bestScore = 0;

  for (const ueItem of ueItems) {
    const ueWords = normalizeName(ueItem.name)
      .split(" ")
      .filter((w) => w.length > 2);
    const overlap = gtWords.filter((w) => ueWords.includes(w)).length;
    const score = overlap / Math.max(gtWords.length, ueWords.length);
    if (overlap >= 2 && score > bestScore) {
      bestScore = score;
      bestItem = ueItem;
    }
  }

  return bestItem;
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

function calcMdAPE(comparisons: ItemComparison[]): number {
  if (comparisons.length === 0) return 0;
  const errors = comparisons.map((c) => c.caloriePctError).sort((a, b) => a - b);
  const mid = Math.floor(errors.length / 2);
  return errors.length % 2 === 0
    ? ((errors[mid - 1]! + errors[mid]!) / 2)
    : errors[mid]!;
}

// ─── Main eval ────────────────────────────────────────────────────────────────

async function evalChain(
  chain: GroundTruthChain,
  client: Anthropic,
): Promise<ChainResult> {
  console.log(`\n  Chain: ${chain.name}`);

  // Step 1: Fetch Uber Eats page and extract JSON-LD items
  const ueItems = await fetchUberEatsItems(chain);

  if (!ueItems) {
    console.log(`  [MISS] No Uber Eats JSON-LD found for ${chain.name}`);
    return {
      chain: chain.name,
      uberEatsFound: false,
      ueItemCount: 0,
      matchedCount: 0,
      comparisons: [],
    };
  }

  // Step 2: Match UE items to ground truth items
  const matchedItems: Array<{ gtItem: GroundTruthItem; ueItem: StructuredMenuItem }> = [];

  for (const gtItem of chain.items) {
    const match = findBestMatch(gtItem.name, ueItems);
    if (match) {
      matchedItems.push({ gtItem, ueItem: match });
      console.log(`    Matched: "${gtItem.name}" → "${match.name}"`);
    } else {
      console.log(`    No match: "${gtItem.name}"`);
    }
  }

  if (matchedItems.length === 0) {
    console.log(`  [SKIP] No items matched between UE and ground truth for ${chain.name}`);
    return {
      chain: chain.name,
      uberEatsFound: true,
      ueItemCount: ueItems.length,
      matchedCount: 0,
      comparisons: [],
    };
  }

  // Step 3: Run matched UE items through Haiku estimation
  const itemsToEstimate = matchedItems.map((m) => m.ueItem);

  let estimates: (import("../../../apps/api/services/menuSources/types.js").MacroData | null)[];
  try {
    estimates = await estimateMacros(itemsToEstimate, client);
  } catch (err) {
    console.error(`  [ERROR] Haiku estimation failed for ${chain.name}:`, err);
    return {
      chain: chain.name,
      uberEatsFound: true,
      ueItemCount: ueItems.length,
      matchedCount: matchedItems.length,
      comparisons: [],
    };
  }

  // Step 4: Build comparisons
  const comparisons: ItemComparison[] = [];
  for (let i = 0; i < matchedItems.length; i++) {
    const { gtItem, ueItem } = matchedItems[i]!;
    const estimate = estimates[i];

    if (!estimate) {
      console.log(`    [NULL] Haiku returned null for "${ueItem.name}"`);
      continue;
    }

    const pctError = Math.abs(estimate.calories - gtItem.calories) / gtItem.calories * 100;
    const isRedFlag = pctError > 15;
    const isCatastrophic = pctError > 50;

    const flag = isCatastrophic ? "CATA" : isRedFlag ? "FLAG" : "OK  ";
    console.log(
      `    [${flag}] ${ueItem.name}: est=${estimate.calories} gt=${gtItem.calories} err=${pctError.toFixed(1)}%`,
    );

    comparisons.push({
      chain: chain.name,
      itemName: ueItem.name,
      groundTruthName: gtItem.name,
      gtCalories: gtItem.calories,
      estimatedCalories: estimate.calories,
      caloriePctError: pctError,
      isRedFlag,
      isCatastrophic,
      confidence: estimate.confidence,
      uberEatsFound: true,
    });
  }

  return {
    chain: chain.name,
    uberEatsFound: true,
    ueItemCount: ueItems.length,
    matchedCount: matchedItems.length,
    comparisons,
  };
}

// ─── Report ───────────────────────────────────────────────────────────────────

function printSummary(results: EvalResults): void {
  const sep = "=".repeat(70);
  console.log("\n" + sep);
  console.log("HERO EVAL RESULTS: Uber Eats → Haiku vs FFN Ground Truth");
  console.log(sep);
  console.log("");

  // Per-chain summary
  for (const chain of results.chains) {
    if (!chain.uberEatsFound) {
      console.log(`  ${chain.chain.padEnd(20)}  [NO UE DATA]`);
      continue;
    }
    const chainMdAPE = calcMdAPE(chain.comparisons);
    const flags = chain.comparisons.filter((c) => c.isRedFlag).length;
    const cats = chain.comparisons.filter((c) => c.isCatastrophic).length;
    console.log(
      `  ${chain.chain.padEnd(20)}  matched=${chain.matchedCount}/${chain.comparisons.length}  MdAPE=${chainMdAPE.toFixed(1)}%  flags=${flags}  cata=${cats}`,
    );
  }

  console.log("");
  console.log(sep);
  console.log("OVERALL");
  console.log(sep);
  console.log(`  Total matched items : ${results.totalMatched} (of ${results.totalGroundTruth} ground-truth items)`);
  console.log(`  MdAPE (calories)    : ${results.mdape.toFixed(2)}%  (target: ≤${results.targets.mdape}%)`);
  console.log(`  Red flags (>15%)    : ${results.redFlagCount} / ${results.totalMatched}  (target: ≤${results.targets.redFlags})`);
  console.log(`  Catastrophic (>50%) : ${results.catastrophicCount} / ${results.totalMatched}  (target: ≤${results.targets.catastrophic})`);
  console.log("");

  const mdapePass = results.mdape <= results.targets.mdape;
  const redFlagPass = results.redFlagCount <= results.targets.redFlags;
  const catPass = results.catastrophicCount <= results.targets.catastrophic;

  console.log(`  MdAPE     : ${mdapePass ? "PASS" : "FAIL"}`);
  console.log(`  Red flags : ${redFlagPass ? "PASS" : "FAIL"}`);
  console.log(`  Cata      : ${catPass ? "PASS" : "FAIL"}`);
  console.log("");
  console.log(`  Overall   : ${results.targetMet ? "PASS — all targets met" : "FAIL — one or more targets missed"}`);
  console.log(sep);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Load ground truth
  const gtPath = path.join(__dirname, "ground-truth.json");
  const groundTruth: GroundTruth = JSON.parse(fs.readFileSync(gtPath, "utf-8"));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "ANTHROPIC_API_KEY not set. Set it in apps/api/.env.local or as an environment variable.",
    );
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  console.log("Hero Eval: Uber Eats → Haiku vs FFN Ground Truth");
  console.log(`Chains: ${groundTruth.chains.map((c) => c.name).join(", ")}`);
  console.log("─".repeat(70));

  const chainResults: ChainResult[] = [];

  for (const chain of groundTruth.chains) {
    const result = await evalChain(chain, client);
    chainResults.push(result);
  }

  // Aggregate metrics
  const allComparisons = chainResults.flatMap((c) => c.comparisons);
  const totalGroundTruth = groundTruth.chains.reduce((sum, c) => sum + c.items.length, 0);
  const totalMatched = allComparisons.length;
  const mdape = calcMdAPE(allComparisons);
  const redFlagCount = allComparisons.filter((c) => c.isRedFlag).length;
  const catastrophicCount = allComparisons.filter((c) => c.isCatastrophic).length;

  const targetMet =
    mdape <= TARGET_MDAPE &&
    redFlagCount <= TARGET_RED_FLAGS &&
    catastrophicCount <= TARGET_CATASTROPHIC;

  const results: EvalResults = {
    chains: chainResults,
    totalMatched,
    totalGroundTruth,
    mdape,
    redFlagCount,
    catastrophicCount,
    targetMet,
    targets: {
      mdape: TARGET_MDAPE,
      redFlags: TARGET_RED_FLAGS,
      catastrophic: TARGET_CATASTROPHIC,
    },
  };

  printSummary(results);

  // Print machine-readable JSON blob for CI / downstream consumption
  console.log("\nJSON_RESULTS_START");
  console.log(
    JSON.stringify(
      {
        mdape: parseFloat(mdape.toFixed(2)),
        redFlags: redFlagCount,
        catastrophic: catastrophicCount,
        totalMatched,
        totalGroundTruth,
        targetMet,
        perChain: chainResults.map((c) => ({
          chain: c.chain,
          uberEatsFound: c.uberEatsFound,
          ueItemCount: c.ueItemCount,
          matchedCount: c.matchedCount,
          mdape: parseFloat(calcMdAPE(c.comparisons).toFixed(2)),
          redFlags: c.comparisons.filter((x) => x.isRedFlag).length,
          catastrophic: c.comparisons.filter((x) => x.isCatastrophic).length,
        })),
      },
      null,
      2,
    ),
  );
  console.log("JSON_RESULTS_END");

  process.exit(targetMet ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
