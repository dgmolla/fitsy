/**
 * Hero Eval: Parametrizable macro estimation accuracy vs FFN ground truth (S-72)
 *
 * Each run is driven by an EvalConfig (strategy × promptId):
 *   strategy  — how StructuredMenuItems are built from ground truth
 *     name-only   : { name, section: chainName }  — no UE scraping
 *     ue-markdown : Firecrawl → UE Markdown → name + calories extracted
 *                   When matched: calorie score = UE calorie vs FFN (no Haiku needed)
 *                   Falls back to name-only if scrape fails or no items found.
 *   promptId  — which system prompt Haiku receives for unmatched items (see prompts.ts)
 *
 * FFN (fastfoodnutrition.org) is the benchmark — official published values.
 *
 * Metrics (per config):
 *   MdAPE ≤ 8%  |  red flags (>15%) ≤ 30/160  |  catastrophic (>50%) ≤ 7/160
 *
 * CLI:
 *   npx tsx scripts/eval/hero-eval/run.ts
 *     → runs all configs, prints comparison table
 *
 *   npx tsx scripts/eval/hero-eval/run.ts --config name-only-default
 *     → runs one config
 *
 *   npx tsx scripts/eval/hero-eval/run.ts --config name-only-default,ue-markdown-default
 *     → runs two configs and compares
 *
 *   npx tsx scripts/eval/hero-eval/run.ts --list
 *     → prints available config ids and exits
 *
 * Env:
 *   ANTHROPIC_API_KEY  (required)
 *   FIRECRAWL_API_KEY  (required for ue-markdown strategy)
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { estimateMacros } from "../../../apps/api/services/macroEstimationService.js";
import {
  scrapeUberEatsMarkdown,
  parseUberEatsMarkdown,
} from "../../../apps/api/services/menuSources/uberEatsSource.js";
import type { StructuredMenuItem } from "../../../apps/api/services/menuSources/types.js";
import { CONFIGS, CONFIG_MAP } from "./configs.js";
import type { EvalConfig } from "./configs.js";
import { PROMPTS } from "./prompts.js";

// Load env from apps/api/.env.local
dotenv.config({ path: path.join(__dirname, "../../../apps/api/.env.local") });

// ─── Exit criteria ─────────────────────────────────────────────────────────────

const TARGET_MDAPE = 8; // percent
const TARGET_RED_FLAGS = 30; // out of 160 (~18.75% — same ratio as original 12/64)
const TARGET_CATASTROPHIC = 7; // out of 160 (~4.4% — same ratio as original 3/64)

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
  uberEatsUrl?: string;
  items: GroundTruthItem[];
}

interface GroundTruth {
  chains: GroundTruthChain[];
}

type EvalMode = "ue-markdown" | "name-only";

interface ItemComparison {
  chain: string;
  itemName: string;
  mode: EvalMode;
  gtCalories: number;
  estimatedCalories: number;
  caloriePctError: number;
  isRedFlag: boolean;
  isCatastrophic: boolean;
  confidence: string;
}

interface ChainResult {
  chain: string;
  mode: EvalMode;
  itemCount: number;
  ueItemsFound: number;
  comparisons: ItemComparison[];
}

interface EvalResults {
  configId: string;
  configLabel: string;
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

// ─── Item matching ────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

/**
 * Find the best-matching UberEats item for an FFN item name.
 * Tries exact match, then substring containment in either direction.
 */
function findMatchingUEItem(
  ffnName: string,
  ueItems: StructuredMenuItem[],
): StructuredMenuItem | null {
  const target = normalize(ffnName);

  let match = ueItems.find((item) => normalize(item.name) === target);
  if (match) return match;

  match = ueItems.find((item) => normalize(item.name).includes(target));
  if (match) return match;

  match = ueItems.find((item) => target.includes(normalize(item.name)));
  if (match) return match;

  return null;
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

// ─── Per-chain eval ───────────────────────────────────────────────────────────

async function evalChain(
  chain: GroundTruthChain,
  config: EvalConfig,
  client: Anthropic,
): Promise<ChainResult> {
  console.log(`\n  Chain: ${chain.name} (${chain.items.length} items)`);

  let ueItems: StructuredMenuItem[] = [];
  let mode: EvalMode = "name-only";

  if (config.strategy === "ue-markdown" && chain.uberEatsUrl) {
    process.stdout.write(`    Scraping UberEats via Firecrawl (markdown)... `);
    const markdown = await scrapeUberEatsMarkdown(chain.uberEatsUrl);
    if (markdown) {
      ueItems = parseUberEatsMarkdown(markdown);
    }

    if (ueItems.length > 0) {
      mode = "ue-markdown";
      console.log(`found ${ueItems.length} UE items (mode: ue-markdown)`);
    } else {
      console.log(`no items found in markdown — falling back to name-only`);
    }
  } else if (config.strategy === "ue-markdown") {
    console.log(`    No uberEatsUrl — using name-only fallback`);
  } else {
    console.log(`    Strategy: name-only`);
  }

  // Build StructuredMenuItems for each FFN ground-truth item
  const structuredItems: StructuredMenuItem[] = chain.items.map((gtItem) => {
    if (mode === "ue-markdown") {
      const matched = findMatchingUEItem(gtItem.name, ueItems);
      if (matched) return matched;
    }
    return { name: gtItem.name, section: chain.name };
  });

  // Run Haiku estimation with this config's prompt
  const systemPrompt = PROMPTS[config.promptId];
  let estimates: (import("../../../apps/api/services/menuSources/types.js").MacroData | null)[];
  try {
    estimates = await estimateMacros(structuredItems, client, systemPrompt);
  } catch (err) {
    console.error(`  [ERROR] Haiku estimation failed for ${chain.name}:`, err);
    return { chain: chain.name, mode, itemCount: chain.items.length, ueItemsFound: ueItems.length, comparisons: [] };
  }

  // Compare estimates to FFN ground truth
  const comparisons: ItemComparison[] = [];
  for (let i = 0; i < chain.items.length; i++) {
    const gtItem = chain.items[i]!;
    const estimate = estimates[i];

    // For ue-markdown items: if UE has calorie data, use it directly (bypass Haiku)
    const ueMatch = mode === "ue-markdown" ? findMatchingUEItem(gtItem.name, ueItems) : null;
    const ueCalories = ueMatch?.calories;

    const itemMode: EvalMode = ueCalories !== undefined ? "ue-markdown" : "name-only";

    let estimatedCalories: number;
    let confidence: string;

    if (ueCalories !== undefined) {
      // UE calorie data — authoritative, no Haiku needed for calories
      estimatedCalories = ueCalories;
      confidence = "HIGH";
    } else {
      if (!estimate) {
        console.log(`    [NULL] Haiku returned null for "${gtItem.name}"`);
        continue;
      }
      estimatedCalories = estimate.calories;
      confidence = estimate.confidence;
    }

    const pctError = Math.abs(estimatedCalories - gtItem.calories) / gtItem.calories * 100;
    const isRedFlag = pctError > 15;
    const isCatastrophic = pctError > 50;

    const flag = isCatastrophic ? "CATA" : isRedFlag ? "FLAG" : "OK  ";
    const modeTag = itemMode === "ue-markdown" ? "UE" : "NO";
    console.log(
      `    [${flag}][${modeTag}] ${gtItem.name}: est=${estimatedCalories} gt=${gtItem.calories} err=${pctError.toFixed(1)}%`,
    );

    comparisons.push({
      chain: chain.name,
      itemName: gtItem.name,
      mode: itemMode,
      gtCalories: gtItem.calories,
      estimatedCalories,
      caloriePctError: pctError,
      isRedFlag,
      isCatastrophic,
      confidence,
    });
  }

  return { chain: chain.name, mode, itemCount: chain.items.length, ueItemsFound: ueItems.length, comparisons };
}

// ─── Single config run ────────────────────────────────────────────────────────

async function runConfig(
  config: EvalConfig,
  groundTruth: GroundTruth,
  client: Anthropic,
): Promise<EvalResults> {
  console.log(`\n${"─".repeat(70)}`);
  console.log(`Config: ${config.id}  |  ${config.label}`);
  console.log(`Strategy: ${config.strategy}  |  Prompt: ${config.promptId}`);
  console.log("─".repeat(70));

  const chainResults: ChainResult[] = [];

  for (const chain of groundTruth.chains) {
    const result = await evalChain(chain, config, client);
    chainResults.push(result);
  }

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

  return {
    configId: config.id,
    configLabel: config.label,
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
}

// ─── Report ───────────────────────────────────────────────────────────────────

function printSingleResult(results: EvalResults): void {
  const sep = "=".repeat(70);
  console.log("\n" + sep);
  console.log(`RESULTS: ${results.configLabel}`);
  console.log(sep);

  for (const chain of results.chains) {
    const chainMdAPE = calcMdAPE(chain.comparisons);
    const flags = chain.comparisons.filter((c) => c.isRedFlag).length;
    const cats = chain.comparisons.filter((c) => c.isCatastrophic).length;
    const modeLabel = chain.mode === "ue-markdown" ? "ue-markdown" : "name-only";
    console.log(
      `  ${chain.chain.padEnd(20)}  mode=${modeLabel.padEnd(9)}  ue=${chain.ueItemsFound.toString().padStart(3)}  matched=${chain.comparisons.length}/${chain.itemCount}  MdAPE=${chainMdAPE.toFixed(1)}%  flags=${flags}  cata=${cats}`,
    );
  }

  console.log("");
  console.log(sep);
  console.log("OVERALL");
  console.log(sep);
  console.log(`  Items matched    : ${results.totalMatched} / ${results.totalGroundTruth}`);
  console.log(`  MdAPE (calories) : ${results.mdape.toFixed(2)}%  (target ≤${results.targets.mdape}%)  ${results.mdape <= results.targets.mdape ? "PASS" : "FAIL"}`);
  console.log(`  Red flags >15%   : ${results.redFlagCount} / ${results.totalMatched}  (target ≤${results.targets.redFlags})  ${results.redFlagCount <= results.targets.redFlags ? "PASS" : "FAIL"}`);
  console.log(`  Catastrophic >50%: ${results.catastrophicCount} / ${results.totalMatched}  (target ≤${results.targets.catastrophic})  ${results.catastrophicCount <= results.targets.catastrophic ? "PASS" : "FAIL"}`);
  console.log(`  Overall          : ${results.targetMet ? "PASS" : "FAIL"}`);
  console.log(sep);
}

function printComparisonTable(allResults: EvalResults[]): void {
  const sep = "=".repeat(90);
  console.log("\n" + sep);
  console.log("COMPARISON TABLE");
  console.log(sep);

  const header = [
    "config".padEnd(30),
    "strategy".padEnd(10),
    "prompt".padEnd(22),
    "MdAPE".padStart(7),
    "flags".padStart(6),
    "cata".padStart(5),
    "pass".padStart(5),
  ].join("  ");
  console.log("  " + header);
  console.log("  " + "─".repeat(header.length));

  for (const r of allResults) {
    const config = CONFIG_MAP.get(r.configId)!;
    const row = [
      r.configId.padEnd(30),
      config.strategy.padEnd(10),
      config.promptId.padEnd(22),
      `${r.mdape.toFixed(1)}%`.padStart(7),
      r.redFlagCount.toString().padStart(6),
      r.catastrophicCount.toString().padStart(5),
      (r.targetMet ? "YES" : "no").padStart(5),
    ].join("  ");
    console.log("  " + row);
  }

  console.log(sep);

  // Best config by MdAPE
  const best = allResults.reduce((a, b) => (a.mdape < b.mdape ? a : b));
  console.log(`\n  Best MdAPE: ${best.configId} (${best.mdape.toFixed(2)}%)`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // --list: print available configs and exit
  if (args.includes("--list")) {
    console.log("Available eval configs:\n");
    for (const c of CONFIGS) {
      console.log(`  ${c.id.padEnd(32)}  ${c.label}`);
    }
    process.exit(0);
  }

  // --config id1,id2,...: select specific configs
  const configFlag = args.find((a) => a.startsWith("--config=") || a === "--config");
  let selectedConfigs: EvalConfig[];

  if (configFlag) {
    const rawValue = configFlag === "--config"
      ? args[args.indexOf("--config") + 1]
      : configFlag.slice("--config=".length);

    if (!rawValue) {
      console.error("--config requires a value. Use --list to see available configs.");
      process.exit(1);
    }

    const ids = rawValue.split(",").map((s) => s.trim());
    selectedConfigs = [];
    for (const id of ids) {
      const c = CONFIG_MAP.get(id);
      if (!c) {
        console.error(`Unknown config id: "${id}". Use --list to see available configs.`);
        process.exit(1);
      }
      selectedConfigs.push(c);
    }
  } else {
    // Default: run all configs
    selectedConfigs = CONFIGS;
  }

  const gtPath = path.join(__dirname, "ground-truth.json");
  const groundTruth: GroundTruth = JSON.parse(fs.readFileSync(gtPath, "utf-8"));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not set. Set it in apps/api/.env.local.");
    process.exit(1);
  }

  const hasFirecrawl = !!process.env.FIRECRAWL_API_KEY;
  const chainsWithUrl = groundTruth.chains.filter((c) => c.uberEatsUrl).length;
  const needsFirecrawl = selectedConfigs.some((c) => c.strategy === "ue-markdown");

  console.log("Hero Eval: Parametrizable Macro Estimation vs FFN Ground Truth");
  console.log(`Chains  : ${groundTruth.chains.map((c) => c.name).join(", ")}`);
  console.log(`Configs : ${selectedConfigs.map((c) => c.id).join(", ")}`);
  console.log(`Firecrawl: ${hasFirecrawl ? "available" : "NOT SET — ue-markdown configs will fall back to name-only"}`);
  if (needsFirecrawl) {
    console.log(`UberEats URLs populated: ${chainsWithUrl} / ${groundTruth.chains.length}`);
  }

  const client = new Anthropic({ apiKey });

  const allResults: EvalResults[] = [];
  for (const config of selectedConfigs) {
    const result = await runConfig(config, groundTruth, client);
    allResults.push(result);
    printSingleResult(result);
  }

  if (allResults.length > 1) {
    printComparisonTable(allResults);
  }

  // Machine-readable JSON for CI / downstream consumption
  const anyTargetMet = allResults.some((r) => r.targetMet);
  console.log("\nJSON_RESULTS_START");
  console.log(
    JSON.stringify(
      allResults.map((r) => ({
        configId: r.configId,
        configLabel: r.configLabel,
        mdape: parseFloat(r.mdape.toFixed(2)),
        redFlags: r.redFlagCount,
        catastrophic: r.catastrophicCount,
        totalMatched: r.totalMatched,
        totalGroundTruth: r.totalGroundTruth,
        targetMet: r.targetMet,
        perChain: r.chains.map((c) => ({
          chain: c.chain,
          mode: c.mode,
          itemCount: c.itemCount,
          ueItemsFound: c.ueItemsFound,
          estimatedCount: c.comparisons.length,
          mdape: parseFloat(calcMdAPE(c.comparisons).toFixed(2)),
          redFlags: c.comparisons.filter((x) => x.isRedFlag).length,
          catastrophic: c.comparisons.filter((x) => x.isCatastrophic).length,
        })),
      })),
      null,
      2,
    ),
  );
  console.log("JSON_RESULTS_END");

  process.exit(anyTargetMet ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
