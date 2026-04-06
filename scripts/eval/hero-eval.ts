/**
 * Hero Eval: New Pipeline (UE structured context) vs Old Pipeline (name only)
 *
 * Compares Haiku macro estimation accuracy when given rich UberEats menu
 * context (description, price, section) versus just the item name + chain.
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import type { GroundTruthItem, MacroEstimateResult, EvalItemResult } from "./lib/types";
import {
  computeItemMetrics,
  computeAggregateMetrics,
  computePerChainBreakdown,
  findRedFlags,
  median,
} from "./lib/metrics";

// ─── Types ──────────────────────────────────────────────────────────────────

interface UeMenuItem {
  name: string;
  description: string;
  price: string;
  section: string;
}

interface UeRestaurant {
  restaurant: string;
  address: string;
  storeUrl: string;
  items: UeMenuItem[];
}

interface MatchedItem {
  groundTruth: GroundTruthItem;
  ueItem: UeMenuItem;
  ueRestaurantKey: string;
}

interface HeroEvalItemResult {
  groundTruth: GroundTruthItem;
  ueItem: UeMenuItem;
  newFlow: { estimate: MacroEstimateResult; calPctError: number };
  oldFlow: { estimate: MacroEstimateResult; calPctError: number };
  delta: number; // positive = new is better
}

// ─── Config ─────────────────────────────────────────────────────────────────

const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 8192;
const DELAY_MS = 500;

const SYSTEM_PROMPT = `You are a nutrition expert. Estimate the macronutrient content for the given menu item.

Return ONLY valid JSON (no markdown fences, no explanation) with these exact fields:
- cal: calories (integer)
- p: protein in grams (number)
- c: carbohydrates in grams (number)
- f: fat in grams (number)
- conf: confidence level (string: "HIGH", "MEDIUM", or "LOW")
- reasoning: brief explanation of your estimate (string)`;

// ─── Chain name mapping (ground truth chain -> UE menu key) ─────────────────

const CHAIN_KEY_MAP: Record<string, string> = {
  "McDonald's": "McDonald's",
  "Chick-fil-A": "Chick-fil-A",
  "Starbucks": "Starbucks",
  "Denny's": "Denny's Restaurant",
  "Chipotle": "Chipotle",
  "Subway": "Subway",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[®™©]/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9 &'()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Reject UE items that are clearly meals/combos/bundles (includes sides + drinks)
const MEAL_SUFFIXES = /\b(meal|combo|bundle|value|package|deal|box)\b/i;

function isMealItem(name: string): boolean {
  return MEAL_SUFFIXES.test(name);
}

// Levenshtein distance for similarity scoring
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

interface ScoredMatch {
  item: { name: string; description?: string; price?: string; section?: string };
  score: number;
}

function findBestMatch(
  gtName: string,
  ueItems: Array<{ name: string; description?: string; price?: string; section?: string }>,
): ScoredMatch | null {
  const gtNorm = normalize(gtName);
  const gtBase = gtNorm.replace(/\s*\(.*?\)\s*/g, "").trim();

  let best: ScoredMatch | null = null;

  for (const ueItem of ueItems) {
    const ueNorm = normalize(ueItem.name);

    // Hard reject: meal/combo items unless ground truth is also a meal
    if (isMealItem(ueNorm) && !isMealItem(gtNorm)) continue;

    // Score: exact normalized match = 1.0
    if (gtNorm === ueNorm) {
      return { item: ueItem, score: 1.0 };
    }

    // Score: exact after stripping parentheticals
    const ueBase = ueNorm.replace(/\s*\(.*?\)\s*/g, "").trim();
    if (gtBase === ueBase) {
      const score = 0.95;
      if (!best || score > best.score) best = { item: ueItem, score };
      continue;
    }

    // Score: Levenshtein similarity on full normalized names
    const sim = similarity(gtNorm, ueNorm);
    if (sim >= 0.7 && (!best || sim > best.score)) {
      best = { item: ueItem, score: sim };
    }

    // Also try base names (without parentheticals) for similarity
    const baseSim = similarity(gtBase, ueBase);
    if (baseSim >= 0.7 && (!best || baseSim > best.score)) {
      best = { item: ueItem, score: baseSim };
    }
  }

  // Only accept matches above 0.7 similarity
  return best && best.score >= 0.7 ? best : null;
}

// Haiku pricing (as of 2025): $0.80 / MTok input, $4.00 / MTok output
const INPUT_COST_PER_TOKEN = 0.80 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 4.00 / 1_000_000;

function computeCost(inputTokens: number, outputTokens: number): number {
  return inputTokens * INPUT_COST_PER_TOKEN + outputTokens * OUTPUT_COST_PER_TOKEN;
}

async function callHaiku(
  client: Anthropic,
  systemPrompt: string,
  userMessage: string,
): Promise<MacroEstimateResult> {
  const start = Date.now();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const latencyMs = Date.now() - start;
  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;

  // Parse JSON from response (strip markdown fences if present)
  const cleaned = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error(`  [WARN] Failed to parse JSON: ${cleaned.slice(0, 200)}`);
    parsed = { cal: 0, p: 0, c: 0, f: 0, conf: "LOW", reasoning: "parse error" };
  }

  return {
    calories: parsed.cal ?? 0,
    proteinG: parsed.p ?? 0,
    carbsG: parsed.c ?? 0,
    fatG: parsed.f ?? 0,
    confidence: parsed.conf ?? "LOW",
    reasoning: parsed.reasoning ?? "",
    inputTokens,
    outputTokens,
    latencyMs,
    costUsd: computeCost(inputTokens, outputTokens),
  };
}

function calPctError(estimated: number, official: number): number {
  if (official === 0) return estimated > 0 ? 100 : 0;
  return (Math.abs(estimated - official) / official) * 100;
}

function meanAbsPctError(errors: number[]): number {
  if (errors.length === 0) return 0;
  return errors.reduce((a, b) => a + b, 0) / errors.length;
}

function p90(errors: number[]): number {
  if (errors.length === 0) return 0;
  const sorted = [...errors].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.9);
  return sorted[Math.min(idx, sorted.length - 1)]!;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== HERO EVAL: New Pipeline vs Old Pipeline ===\n");

  // Step 1: Load data
  const fixturesDir = path.join(__dirname, "fixtures");
  const groundTruth: GroundTruthItem[] = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, "ground-truth.json"), "utf-8"),
  );
  const ueMenus: Record<string, UeRestaurant> = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, "cached-ue-menus.json"), "utf-8"),
  );

  console.log(`Loaded ${groundTruth.length} ground truth items`);
  console.log(`Loaded ${Object.keys(ueMenus).length} UE restaurants\n`);

  // Step 2: Match items
  const matched: MatchedItem[] = [];
  const misses: GroundTruthItem[] = [];

  for (const gt of groundTruth) {
    const ueKey = CHAIN_KEY_MAP[gt.chain];
    if (!ueKey || !ueMenus[ueKey]) {
      console.log(`  [MISS] No UE menu for chain: ${gt.chain}`);
      misses.push(gt);
      continue;
    }

    const ueRestaurant = ueMenus[ueKey]!;
    const bestMatch = findBestMatch(gt.itemName, ueRestaurant.items);

    if (bestMatch) {
      matched.push({ groundTruth: gt, ueItem: bestMatch.item as UeMenuItem, ueRestaurantKey: ueKey });
      console.log(`  [MATCH] ${gt.itemName} → ${bestMatch.item.name} (score: ${bestMatch.score.toFixed(2)})`);
    } else {
      misses.push(gt);
      console.log(`  [MISS]  ${gt.itemName} @ ${gt.chain}`);
    }
  }

  console.log(`\nMatched: ${matched.length} / ${groundTruth.length}`);
  console.log(`Misses: ${misses.length}\n`);

  // Step 3: Run estimation (both flows)
  const client = new Anthropic({
    apiKey: process.env["ANTHROPIC_API_KEY"],
  });
  const results: HeroEvalItemResult[] = [];
  let totalCost = 0;

  for (let i = 0; i < matched.length; i++) {
    const { groundTruth: gt, ueItem, ueRestaurantKey } = matched[i]!;
    const officialCal = gt.officialMacros.calories;

    console.log(
      `[${i + 1}/${matched.length}] ${gt.itemName} @ ${gt.chain}`,
    );

    // Flow A: New pipeline (structured UE context)
    const newUserMsg = [
      `Dish: ${ueItem.name}`,
      `Description: ${ueItem.description}`,
      `Price: $${ueItem.price}`,
      `Menu Section: ${ueItem.section}`,
      `Restaurant: ${gt.chain}`,
    ].join("\n");

    const newEstimate = await callHaiku(client, SYSTEM_PROMPT, newUserMsg);
    totalCost += newEstimate.costUsd;
    await sleep(DELAY_MS);

    // Flow B: Old pipeline (name only)
    const oldUserMsg = [
      `Dish: ${gt.itemName}`,
      `Restaurant: ${gt.chain}`,
    ].join("\n");

    const oldEstimate = await callHaiku(client, SYSTEM_PROMPT, oldUserMsg);
    totalCost += oldEstimate.costUsd;
    await sleep(DELAY_MS);

    const newErr = calPctError(newEstimate.calories, officialCal);
    const oldErr = calPctError(oldEstimate.calories, officialCal);
    const delta = oldErr - newErr; // positive = new is better

    results.push({
      groundTruth: gt,
      ueItem,
      newFlow: { estimate: newEstimate, calPctError: newErr },
      oldFlow: { estimate: oldEstimate, calPctError: oldErr },
      delta,
    });

    console.log(
      `  New: ${newEstimate.calories} cal (${newErr.toFixed(1)}% err) | Old: ${oldEstimate.calories} cal (${oldErr.toFixed(1)}% err) | Delta: ${delta > 0 ? "+" : ""}${delta.toFixed(1)}pp`,
    );
  }

  // Step 4 & 5: Compute metrics and report
  console.log("\n" + "=".repeat(60));
  console.log("=== HERO EVAL: New Pipeline vs Old Pipeline ===");
  console.log("=".repeat(60));

  console.log(`\nItems matched: ${matched.length} / ${groundTruth.length}`);
  console.log(`Items estimated: ${results.length} (both flows)\n`);

  // Build EvalItemResults for metric functions
  const newEvalItems: EvalItemResult[] = results.map((r) =>
    computeItemMetrics(r.newFlow.estimate, r.groundTruth),
  );
  const oldEvalItems: EvalItemResult[] = results.map((r) =>
    computeItemMetrics(r.oldFlow.estimate, r.groundTruth),
  );

  const newAgg = computeAggregateMetrics(newEvalItems);
  const oldAgg = computeAggregateMetrics(oldEvalItems);

  // Raw calorie errors for simpler aggregate
  const newCalErrors = results.map((r) => r.newFlow.calPctError);
  const oldCalErrors = results.map((r) => r.oldFlow.calPctError);

  console.log("Aggregate Comparison:");
  console.log(
    `${"".padEnd(22)}${"New (UE context)".padEnd(20)}${"Old (name only)".padEnd(20)}`,
  );
  console.log(
    `  ${"MdAPE (cal):".padEnd(20)}${newAgg.calories.medianAbsPctError.toFixed(1).padEnd(20)}%${oldAgg.calories.medianAbsPctError.toFixed(1)}%`,
  );
  console.log(
    `  ${"MAPE (cal):".padEnd(20)}${newAgg.calories.meanAbsPctError.toFixed(1).padEnd(20)}%${oldAgg.calories.meanAbsPctError.toFixed(1)}%`,
  );
  console.log(
    `  ${"P90 (cal):".padEnd(20)}${newAgg.calories.p90AbsPctError.toFixed(1).padEnd(20)}%${oldAgg.calories.p90AbsPctError.toFixed(1)}%`,
  );

  // Per-chain breakdown
  const newByChain = computePerChainBreakdown(newEvalItems);
  const oldByChain = computePerChainBreakdown(oldEvalItems);

  console.log("\nPer-Chain Breakdown:");
  console.log(
    `  ${"Chain".padEnd(22)}${"New".padEnd(12)}${"Old".padEnd(12)}${"Delta"}`,
  );
  for (const nc of newByChain) {
    const oc = oldByChain.find((o) => o.chain === nc.chain);
    const oldMed = oc?.medianCalError ?? 0;
    const delta = oldMed - nc.medianCalError;
    console.log(
      `  ${nc.chain.padEnd(22)}${(nc.medianCalError.toFixed(1) + "%").padEnd(12)}${(oldMed.toFixed(1) + "%").padEnd(12)}${delta > 0 ? "+" : ""}${delta.toFixed(1)}pp`,
    );
  }

  // Red flags
  const newRedFlags = findRedFlags(newEvalItems, 15);
  const oldRedFlags = findRedFlags(oldEvalItems, 15);

  console.log(`\nRed Flags (>15% error):`);
  console.log(`  New flow: ${newRedFlags.length} flags`);
  console.log(`  Old flow: ${oldRedFlags.length} flags`);

  // Items that improved / got worse
  const improved = results
    .filter((r) => r.delta > 1) // at least 1pp improvement
    .sort((a, b) => b.delta - a.delta);
  const worsened = results
    .filter((r) => r.delta < -1)
    .sort((a, b) => a.delta - b.delta);

  console.log(`\nItems that IMPROVED with structured context (${improved.length}):`);
  for (const r of improved) {
    console.log(
      `  ${r.groundTruth.itemName} @ ${r.groundTruth.chain}: old ${r.oldFlow.calPctError.toFixed(1)}% -> new ${r.newFlow.calPctError.toFixed(1)}% (saved ${r.delta.toFixed(1)}pp)`,
    );
  }

  console.log(`\nItems that GOT WORSE with structured context (${worsened.length}):`);
  for (const r of worsened) {
    console.log(
      `  ${r.groundTruth.itemName} @ ${r.groundTruth.chain}: old ${r.oldFlow.calPctError.toFixed(1)}% -> new ${r.newFlow.calPctError.toFixed(1)}% (lost ${Math.abs(r.delta).toFixed(1)}pp)`,
    );
  }

  // Biggest wins and losses (top 5 each)
  console.log("\nBiggest wins (top 5):");
  for (const r of improved.slice(0, 5)) {
    console.log(
      `  ${r.groundTruth.itemName} @ ${r.groundTruth.chain}: ${r.oldFlow.calPctError.toFixed(1)}% -> ${r.newFlow.calPctError.toFixed(1)}% (${r.delta.toFixed(1)}pp)`,
    );
  }

  console.log("\nBiggest losses (top 5):");
  for (const r of worsened.slice(0, 5)) {
    console.log(
      `  ${r.groundTruth.itemName} @ ${r.groundTruth.chain}: ${r.oldFlow.calPctError.toFixed(1)}% -> ${r.newFlow.calPctError.toFixed(1)}% (${Math.abs(r.delta).toFixed(1)}pp)`,
    );
  }

  console.log(`\nCost: $${totalCost.toFixed(4)} total`);

  // Step 6: Save results
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const resultsDir = path.join(__dirname, "results");
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const outputPath = path.join(resultsDir, `hero-eval-${timestamp}.json`);
  const output = {
    timestamp: new Date().toISOString(),
    model: MODEL,
    itemsMatched: matched.length,
    itemsTotal: groundTruth.length,
    itemsEstimated: results.length,
    aggregate: {
      new: {
        mdape: newAgg.calories.medianAbsPctError,
        mape: newAgg.calories.meanAbsPctError,
        p90: newAgg.calories.p90AbsPctError,
      },
      old: {
        mdape: oldAgg.calories.medianAbsPctError,
        mape: oldAgg.calories.meanAbsPctError,
        p90: oldAgg.calories.p90AbsPctError,
      },
    },
    perChain: newByChain.map((nc) => {
      const oc = oldByChain.find((o) => o.chain === nc.chain);
      return {
        chain: nc.chain,
        count: nc.count,
        newMdAPE: nc.medianCalError,
        oldMdAPE: oc?.medianCalError ?? 0,
        delta: (oc?.medianCalError ?? 0) - nc.medianCalError,
      };
    }),
    redFlags: { new: newRedFlags.length, old: oldRedFlags.length },
    totalCostUsd: totalCost,
    items: results.map((r) => ({
      id: r.groundTruth.id,
      chain: r.groundTruth.chain,
      itemName: r.groundTruth.itemName,
      officialCal: r.groundTruth.officialMacros.calories,
      ueItemName: r.ueItem.name,
      newEstCal: r.newFlow.estimate.calories,
      newCalPctError: r.newFlow.calPctError,
      newConf: r.newFlow.estimate.confidence,
      newReasoning: r.newFlow.estimate.reasoning,
      oldEstCal: r.oldFlow.estimate.calories,
      oldCalPctError: r.oldFlow.calPctError,
      oldConf: r.oldFlow.estimate.confidence,
      oldReasoning: r.oldFlow.estimate.reasoning,
      delta: r.delta,
    })),
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
