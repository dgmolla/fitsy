/**
 * Two-Path Eval: Resolver Pipeline vs FFN Ground Truth (S-76)
 *
 * Validates the production two-path estimation strategy:
 *   Path 1 (chains): FFN/FatSecret → official macros (expected: 0% error)
 *   Path 2 (indies): UberEats/Firecrawl → Haiku estimation
 *
 * For each chain in ground-truth.json:
 *   1. Run FFNSource.lookup() and FatSecretSource.lookup()
 *   2. Match returned items to ground truth by name
 *   3. Compare official macros to ground truth (should be near-zero error)
 *   4. For unmatched items, fall back to UberEats → Haiku estimation
 *   5. Track which path each item took and compare baselines
 *
 * Metrics:
 *   - Path 1 items: error should be 0% (official data)
 *   - Path 2 items: MdAPE compared against previous baseline
 *   - Overall: combined MdAPE, red flags, catastrophic errors
 *
 * Usage:
 *   npx tsx scripts/eval/hero-eval/two-path-eval.ts
 *
 * Requires:
 *   - ANTHROPIC_API_KEY (from apps/api/.env.local or process env)
 *   - Network access to fastfoodnutrition.org, foods.fatsecret.com, ubereats.com
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { FFNSource } from "../../../apps/api/services/menuSources/ffnSource.js";
import { FatSecretSource } from "../../../apps/api/services/menuSources/fatSecretSource.js";
import {
  extractJsonLdBlocks,
  findRestaurantBlock,
  parseMenuItems,
} from "../../../apps/api/services/menuSources/uberEatsSource.js";
import { estimateMacros } from "../../../apps/api/services/macroEstimationService.js";
import type {
  MacroData,
  StructuredMenuItem,
} from "../../../apps/api/services/menuSources/types.js";

dotenv.config({ path: path.join(__dirname, "../../../apps/api/.env.local") });

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

type EstimationPath = "ffn" | "fatsecret" | "haiku" | "unmatched";

interface ItemComparison {
  chain: string;
  itemName: string;
  path: EstimationPath;
  gtCalories: number;
  estimatedCalories: number;
  caloriePctError: number;
  isRedFlag: boolean;
  isCatastrophic: boolean;
  confidence: string;
}

interface ChainResult {
  chain: string;
  ffnItemCount: number;
  fatSecretItemCount: number;
  haikuItemCount: number;
  unmatchedCount: number;
  comparisons: ItemComparison[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function findMacroMatch(
  gtName: string,
  macros: Map<string, MacroData>,
): MacroData | null {
  const norm = normalizeName(gtName);

  // Exact match
  const exact = macros.get(norm);
  if (exact) return exact;

  // Substring match in either direction
  for (const [key, macro] of macros) {
    if (key.includes(norm) || norm.includes(key)) return macro;
  }

  return null;
}

function findUeMatch(
  gtName: string,
  ueItems: StructuredMenuItem[],
): StructuredMenuItem | null {
  const norm = normalizeName(gtName);

  for (const item of ueItems) {
    if (normalizeName(item.name) === norm) return item;
  }
  for (const item of ueItems) {
    const normUe = normalizeName(item.name);
    if (normUe.includes(norm) || norm.includes(normUe)) return item;
  }

  return null;
}

function calcMdAPE(comparisons: ItemComparison[]): number {
  if (comparisons.length === 0) return 0;
  const errors = comparisons.map((c) => c.caloriePctError).sort((a, b) => a - b);
  const mid = Math.floor(errors.length / 2);
  return errors.length % 2 === 0
    ? ((errors[mid - 1]! + errors[mid]!) / 2)
    : errors[mid]!;
}

// ─── UE fetch ─────────────────────────────────────────────────────────────────

const UE_BASE = "https://www.ubereats.com";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchUeItems(slug: string): Promise<StructuredMenuItem[]> {
  try {
    const url = `${UE_BASE}/store/${slug}`;
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) return [];
    const html = await resp.text();
    const blocks = extractJsonLdBlocks(html);
    const restaurant = findRestaurantBlock(blocks);
    if (!restaurant) return [];
    return parseMenuItems(restaurant);
  } catch {
    return [];
  }
}

// ─── Per-chain eval ───────────────────────────────────────────────────────────

async function evalChain(
  chain: GroundTruthChain,
  client: Anthropic,
): Promise<ChainResult> {
  console.log(`\n  Chain: ${chain.name} (${chain.items.length} items)`);

  // Path 1: Try FFN
  const ffnSource = new FFNSource();
  const ffnResult = await ffnSource.lookup(chain.name, "");
  const ffnMacros = ffnResult.macros ?? new Map<string, MacroData>();
  console.log(`    FFN: ${ffnMacros.size} items`);

  // Path 1: Try FatSecret
  const fatSecretSource = new FatSecretSource();
  const fsResult = await fatSecretSource.lookup(chain.name, "");
  const fsMacros = fsResult.macros ?? new Map<string, MacroData>();
  console.log(`    FatSecret: ${fsMacros.size} items`);

  // Path 2: Try UberEats
  const ueItems = await fetchUeItems(chain.uberEatsSlug);
  console.log(`    UberEats: ${ueItems.length} items`);

  // Match each ground truth item to the best available source
  const comparisons: ItemComparison[] = [];
  const unmatchedForHaiku: Array<{ gtItem: GroundTruthItem; ueItem: StructuredMenuItem }> = [];
  let ffnCount = 0;
  let fsCount = 0;
  let unmatchedCount = 0;

  for (const gtItem of chain.items) {
    // Try FFN first
    const ffnMacro = findMacroMatch(gtItem.name, ffnMacros);
    if (ffnMacro) {
      const pctError = Math.abs(ffnMacro.calories - gtItem.calories) / gtItem.calories * 100;
      comparisons.push({
        chain: chain.name,
        itemName: gtItem.name,
        path: "ffn",
        gtCalories: gtItem.calories,
        estimatedCalories: ffnMacro.calories,
        caloriePctError: pctError,
        isRedFlag: pctError > 15,
        isCatastrophic: pctError > 50,
        confidence: "HIGH",
      });
      ffnCount++;
      const flag = pctError > 15 ? "FLAG" : "OK  ";
      console.log(`    [${flag}][FFN] ${gtItem.name}: est=${ffnMacro.calories} gt=${gtItem.calories} err=${pctError.toFixed(1)}%`);
      continue;
    }

    // Try FatSecret
    const fsMacro = findMacroMatch(gtItem.name, fsMacros);
    if (fsMacro) {
      const pctError = Math.abs(fsMacro.calories - gtItem.calories) / gtItem.calories * 100;
      comparisons.push({
        chain: chain.name,
        itemName: gtItem.name,
        path: "fatsecret",
        gtCalories: gtItem.calories,
        estimatedCalories: fsMacro.calories,
        caloriePctError: pctError,
        isRedFlag: pctError > 15,
        isCatastrophic: pctError > 50,
        confidence: "HIGH",
      });
      fsCount++;
      const flag = pctError > 15 ? "FLAG" : "OK  ";
      console.log(`    [${flag}][FS ] ${gtItem.name}: est=${fsMacro.calories} gt=${gtItem.calories} err=${pctError.toFixed(1)}%`);
      continue;
    }

    // Path 2: try UberEats match for Haiku estimation
    const ueMatch = findUeMatch(gtItem.name, ueItems);
    if (ueMatch) {
      unmatchedForHaiku.push({ gtItem, ueItem: ueMatch });
    } else {
      unmatchedCount++;
      console.log(`    [MISS]      ${gtItem.name}: no source found`);
    }
  }

  // Run Haiku for Path 2 items
  if (unmatchedForHaiku.length > 0) {
    const itemsToEstimate = unmatchedForHaiku.map((m) => m.ueItem);
    try {
      const estimates = await estimateMacros(itemsToEstimate, client);
      for (let i = 0; i < unmatchedForHaiku.length; i++) {
        const { gtItem, ueItem } = unmatchedForHaiku[i]!;
        const estimate = estimates[i];
        if (!estimate) {
          unmatchedCount++;
          console.log(`    [NULL][HAI] ${ueItem.name}: Haiku returned null`);
          continue;
        }
        const pctError = Math.abs(estimate.calories - gtItem.calories) / gtItem.calories * 100;
        const flag = pctError > 50 ? "CATA" : pctError > 15 ? "FLAG" : "OK  ";
        console.log(`    [${flag}][HAI] ${ueItem.name}: est=${estimate.calories} gt=${gtItem.calories} err=${pctError.toFixed(1)}%`);
        comparisons.push({
          chain: chain.name,
          itemName: ueItem.name,
          path: "haiku",
          gtCalories: gtItem.calories,
          estimatedCalories: estimate.calories,
          caloriePctError: pctError,
          isRedFlag: pctError > 15,
          isCatastrophic: pctError > 50,
          confidence: estimate.confidence,
        });
      }
    } catch (err) {
      console.error(`    [ERROR] Haiku failed:`, err);
      unmatchedCount += unmatchedForHaiku.length;
    }
  }

  const haikuCount = comparisons.filter((c) => c.path === "haiku").length;

  return {
    chain: chain.name,
    ffnItemCount: ffnCount,
    fatSecretItemCount: fsCount,
    haikuItemCount: haikuCount,
    unmatchedCount,
    comparisons,
  };
}

// ─── Report ───────────────────────────────────────────────────────────────────

function printSummary(
  chains: ChainResult[],
  totalGroundTruth: number,
): void {
  const sep = "=".repeat(70);
  const all = chains.flatMap((c) => c.comparisons);
  const path1 = all.filter((c) => c.path === "ffn" || c.path === "fatsecret");
  const path2 = all.filter((c) => c.path === "haiku");

  console.log("\n" + sep);
  console.log("TWO-PATH EVAL RESULTS");
  console.log(sep);

  for (const chain of chains) {
    const chainMdAPE = calcMdAPE(chain.comparisons);
    const flags = chain.comparisons.filter((c) => c.isRedFlag).length;
    console.log(
      `  ${chain.chain.padEnd(20)}  ffn=${chain.ffnItemCount}  fs=${chain.fatSecretItemCount}  haiku=${chain.haikuItemCount}  miss=${chain.unmatchedCount}  MdAPE=${chainMdAPE.toFixed(1)}%  flags=${flags}`,
    );
  }

  console.log("\n" + sep);
  console.log("PATH BREAKDOWN");
  console.log(sep);
  console.log(`  Path 1 (FFN/FatSecret) : ${path1.length} items  MdAPE=${calcMdAPE(path1).toFixed(2)}%`);
  console.log(`  Path 2 (Haiku)         : ${path2.length} items  MdAPE=${calcMdAPE(path2).toFixed(2)}%`);
  console.log(`  Total matched          : ${all.length} / ${totalGroundTruth}`);

  console.log("\n" + sep);
  console.log("OVERALL");
  console.log(sep);
  const mdape = calcMdAPE(all);
  const redFlags = all.filter((c) => c.isRedFlag).length;
  const catastrophic = all.filter((c) => c.isCatastrophic).length;
  console.log(`  MdAPE (calories) : ${mdape.toFixed(2)}%  (target ≤8%)`);
  console.log(`  Red flags >15%   : ${redFlags} / ${all.length}  (target ≤12)`);
  console.log(`  Catastrophic >50%: ${catastrophic} / ${all.length}  (target ≤3)`);

  const pass = mdape <= 8 && redFlags <= 12 && catastrophic <= 3;
  console.log(`  Overall          : ${pass ? "PASS" : "FAIL"}`);
  console.log(sep);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const gtPath = path.join(__dirname, "ground-truth.json");
  const groundTruth: GroundTruth = JSON.parse(fs.readFileSync(gtPath, "utf-8"));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not set.");
    process.exit(1);
  }
  const client = new Anthropic({ apiKey });

  console.log("Two-Path Eval: Resolver Pipeline vs FFN Ground Truth (S-76)");
  console.log(`Chains: ${groundTruth.chains.map((c) => c.name).join(", ")}`);
  console.log("─".repeat(70));

  const chainResults: ChainResult[] = [];
  for (const chain of groundTruth.chains) {
    const result = await evalChain(chain, client);
    chainResults.push(result);
  }

  const totalGroundTruth = groundTruth.chains.reduce((sum, c) => sum + c.items.length, 0);
  printSummary(chainResults, totalGroundTruth);

  // Save results JSON
  const all = chainResults.flatMap((c) => c.comparisons);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const resultsPath = path.join(__dirname, "..", "results", `two-path-eval-${timestamp}.json`);

  const output = {
    timestamp: new Date().toISOString(),
    eval: "two-path",
    totalMatched: all.length,
    totalGroundTruth,
    path1Count: all.filter((c) => c.path === "ffn" || c.path === "fatsecret").length,
    path2Count: all.filter((c) => c.path === "haiku").length,
    mdape: parseFloat(calcMdAPE(all).toFixed(2)),
    path1Mdape: parseFloat(calcMdAPE(all.filter((c) => c.path !== "haiku")).toFixed(2)),
    path2Mdape: parseFloat(calcMdAPE(all.filter((c) => c.path === "haiku")).toFixed(2)),
    redFlags: all.filter((c) => c.isRedFlag).length,
    catastrophic: all.filter((c) => c.isCatastrophic).length,
    perChain: chainResults.map((c) => ({
      chain: c.chain,
      ffnItems: c.ffnItemCount,
      fatSecretItems: c.fatSecretItemCount,
      haikuItems: c.haikuItemCount,
      unmatched: c.unmatchedCount,
      mdape: parseFloat(calcMdAPE(c.comparisons).toFixed(2)),
      redFlags: c.comparisons.filter((x) => x.isRedFlag).length,
    })),
    items: all,
  };

  fs.writeFileSync(resultsPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to ${resultsPath}`);

  const pass = output.mdape <= 8 && output.redFlags <= 12 && output.catastrophic <= 3;
  process.exit(pass ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
