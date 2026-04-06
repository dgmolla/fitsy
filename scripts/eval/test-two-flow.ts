/**
 * test-two-flow.ts
 *
 * Compares the old pipeline flow (name-only estimation) vs the new flow
 * (structured context from Uber Eats JSON-LD menu data).
 *
 * Usage:
 *   set -a && source .env.local && set +a && npx tsx scripts/eval/test-two-flow.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { COST_CONFIG } from "./cost-config";

// ─── Config ──────────────────────────────────────────────────────────────────

const MODEL = "claude-haiku-4-5";
const DELAY_MS = 500;
const MAX_ITEMS_PER_RESTAURANT = 10;

const CACHE_PATH = path.join(__dirname, "fixtures", "cached-ue-menus.json");

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const RESTAURANTS = [
  { name: "All Time", address: "2040 Hillhurst Ave, Los Angeles" },
  { name: "Denny's Restaurant", address: "6100 Sunset Blvd, Los Angeles" },
  { name: "Found Oyster", address: "4880 Fountain Ave, Los Angeles" },
  { name: "Great White", address: "244 N Larchmont Blvd, Los Angeles" },
  { name: "Kuya Lord", address: "5003 Melrose Ave, Los Angeles" },
  { name: "Leo's Tacos Truck", address: "5525 Sunset Blvd, Los Angeles" },
  { name: "Luv2eat Thai Bistro", address: "6660 Sunset Blvd, Los Angeles" },
  { name: "Mirate", address: "1712 N Vermont Ave, Los Angeles" },
  { name: "NORMS Restaurant", address: "5453 Hollywood Blvd, Los Angeles" },
  { name: "Saffy's", address: "4845 Fountain Ave, Los Angeles" },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface MenuItem {
  name: string;
  description: string;
  price: string;
  section: string;
}

interface RestaurantMenu {
  restaurant: string;
  address: string;
  storeUrl: string;
  items: MenuItem[];
  fetchedAt: string;
}

interface CachedMenus {
  [restaurantName: string]: RestaurantMenu;
}

interface MacroEstimate {
  cal: number;
  p: number;
  c: number;
  f: number;
  conf: "HIGH" | "MEDIUM" | "LOW";
  reasoning: string;
}

interface FlowResult {
  item: MenuItem;
  restaurant: string;
  estimate: MacroEstimate;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

// ─── Firecrawl Search ────────────────────────────────────────────────────────

async function firecrawlSearch(query: string, limit = 1): Promise<Array<{ url: string; title?: string }>> {
  const apiKey = process.env["FIRECRAWL_API_KEY"];
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set");

  const response = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      limit,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firecrawl search failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    success: boolean;
    data: Array<{ url: string; title?: string; markdown?: string }>;
  };

  if (!data.success || !data.data) return [];
  return data.data.map((d) => ({ url: d.url, ...(d.title !== undefined ? { title: d.title } : {}) }));
}

// ─── JSON-LD Extraction ─────────────────────────────────────────────────────

function extractJsonLdMenuItems(html: string): MenuItem[] {
  const items: MenuItem[] = [];
  const scriptRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]!);
      const restaurants = Array.isArray(data) ? data : [data];

      for (const obj of restaurants) {
        if (obj["@type"] === "Restaurant" && obj.hasMenu) {
          const menu = obj.hasMenu;
          const sections = menu.hasMenuSection || [];
          for (const section of Array.isArray(sections) ? sections : [sections]) {
            const sectionName = section.name || "Unknown";
            const menuItems = section.hasMenuItem || [];
            for (const mi of Array.isArray(menuItems) ? menuItems : [menuItems]) {
              items.push({
                name: mi.name || "",
                description: mi.description || "",
                price: mi.offers?.price?.toString() || mi.offers?.priceCurrency || "",
                section: sectionName,
              });
            }
          }
        }
      }
    } catch {
      // Skip malformed JSON-LD blocks
    }
  }

  return items;
}

// ─── Fetch UE Menu ──────────────────────────────────────────────────────────

async function fetchUberEatsMenu(
  name: string,
  address: string,
): Promise<RestaurantMenu | null> {
  console.log(`  Searching for "${name}" on Uber Eats...`);

  try {
    const results = await firecrawlSearch(`${name} uber eats ${address}`, 3);
    const ueResult = results.find((r) =>
      r.url.includes("ubereats.com/store"),
    );

    if (!ueResult) {
      console.log(`    No Uber Eats store URL found.`);
      return null;
    }

    const storeUrl = ueResult.url;
    console.log(`    Found: ${storeUrl}`);

    // Raw fetch the store page for JSON-LD
    const html = await fetch(storeUrl, {
      headers: { "User-Agent": BROWSER_UA },
    }).then((r) => r.text());

    const items = extractJsonLdMenuItems(html);

    if (items.length === 0) {
      console.log(`    No JSON-LD menu items found on page.`);
      return null;
    }

    console.log(`    Extracted ${items.length} menu items.`);

    return {
      restaurant: name,
      address,
      storeUrl,
      items,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.log(`    Error: ${(err as Error).message}`);
    return null;
  }
}

// ─── Load or Fetch Menus ────────────────────────────────────────────────────

async function loadOrFetchMenus(): Promise<CachedMenus> {
  // Check cache
  if (fs.existsSync(CACHE_PATH)) {
    console.log("Loading cached UE menus...");
    const cached: CachedMenus = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
    const cachedCount = Object.keys(cached).length;
    console.log(`  ${cachedCount} restaurants in cache.\n`);
    return cached;
  }

  console.log("Fetching Uber Eats menus (will cache results)...\n");
  const menus: CachedMenus = {};
  let firecrawlCost = 0;

  for (const r of RESTAURANTS) {
    const menu = await fetchUberEatsMenu(r.name, r.address);
    if (menu) {
      menus[r.name] = menu;
    }
    firecrawlCost += COST_CONFIG.services.firecrawl.perSearch;
    // Small delay between Firecrawl requests
    await sleep(300);
  }

  // Cache to disk
  fs.writeFileSync(CACHE_PATH, JSON.stringify(menus, null, 2));
  console.log(`\nCached ${Object.keys(menus).length} menus to ${CACHE_PATH}`);
  console.log(`Firecrawl search cost: $${firecrawlCost.toFixed(3)}\n`);

  return menus;
}

// ─── LLM Estimation ─────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });

const SYSTEM_PROMPT =
  "You are a nutrition expert. Estimate the macronutrients for the given dish. Return ONLY a JSON object with these fields: { cal, p, c, f, conf, reasoning }. cal = calories, p = protein grams, c = carb grams, f = fat grams, conf = HIGH/MEDIUM/LOW confidence. reasoning = 1-2 sentence explanation.";

function buildOldFlowMessage(itemName: string, restaurant: string): string {
  return `Dish: ${itemName}\nRestaurant: ${restaurant}`;
}

function buildNewFlowMessage(
  item: MenuItem,
  restaurant: string,
): string {
  let msg = `Dish: ${item.name}\nRestaurant: ${restaurant}`;
  if (item.description) msg += `\nDescription: ${item.description}`;
  if (item.price) msg += `\nPrice: $${item.price}`;
  if (item.section) msg += `\nMenu Section: ${item.section}`;
  return msg;
}

function parseEstimateJson(raw: string): MacroEstimate {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```\s*$/, "");
  return JSON.parse(stripped) as MacroEstimate;
}

async function estimateItem(
  userMessage: string,
): Promise<{ estimate: MacroEstimate; inputTokens: number; outputTokens: number; costUsd: number; latencyMs: number }> {
  const start = Date.now();

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const latencyMs = Date.now() - start;

  const block = message.content[0];
  if (!block || block.type !== "text") throw new Error("No text in response");

  const estimate = parseEstimateJson(block.text);
  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;

  const pricing = COST_CONFIG.models[MODEL]!;
  const costUsd = inputTokens * pricing.input + outputTokens * pricing.output;

  return { estimate, inputTokens, outputTokens, costUsd, latencyMs };
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

function macroCalConsistency(e: MacroEstimate): number {
  const computed = e.p * 4 + e.c * 4 + e.f * 9;
  if (e.cal === 0) return computed === 0 ? 0 : 1;
  return Math.abs(e.cal - computed) / e.cal;
}

// ─── Utils ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  TWO-FLOW COMPARISON: Name-Only vs. Structured Context   ");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Part A: Get menus
  const menus = await loadOrFetchMenus();
  const foundCount = Object.keys(menus).length;

  if (foundCount === 0) {
    console.log("No Uber Eats menus found. Exiting.");
    process.exit(1);
  }

  // Collect all items to test
  const testItems: Array<{ restaurant: string; item: MenuItem }> = [];
  for (const [restaurant, menu] of Object.entries(menus)) {
    const selected = menu.items.slice(0, MAX_ITEMS_PER_RESTAURANT);
    for (const item of selected) {
      testItems.push({ restaurant, item });
    }
  }

  console.log(`\nRestaurants found on UE: ${foundCount} / ${RESTAURANTS.length}`);
  console.log(`Total menu items to test: ${testItems.length}\n`);

  // Part B: Run both flows
  const oldResults: FlowResult[] = [];
  const newResults: FlowResult[] = [];
  let totalCost = 0;

  console.log("Running estimations...\n");

  for (let i = 0; i < testItems.length; i++) {
    const { restaurant, item } = testItems[i]!;
    const label = `[${i + 1}/${testItems.length}] ${restaurant} — ${item.name}`;
    process.stdout.write(`  ${label}...`);

    try {
      // Old flow
      const oldMsg = buildOldFlowMessage(item.name, restaurant);
      const oldRes = await estimateItem(oldMsg);
      oldResults.push({
        item,
        restaurant,
        ...oldRes,
      });
      totalCost += oldRes.costUsd;

      await sleep(DELAY_MS);

      // New flow
      const newMsg = buildNewFlowMessage(item, restaurant);
      const newRes = await estimateItem(newMsg);
      newResults.push({
        item,
        restaurant,
        ...newRes,
      });
      totalCost += newRes.costUsd;

      const oldConsistency = (macroCalConsistency(oldRes.estimate) * 100).toFixed(1);
      const newConsistency = (macroCalConsistency(newRes.estimate) * 100).toFixed(1);

      console.log(` old=${oldRes.estimate.cal}cal/${oldRes.estimate.conf} new=${newRes.estimate.cal}cal/${newRes.estimate.conf}  consistency: ${oldConsistency}% vs ${newConsistency}%`);
    } catch (err) {
      console.log(` ERROR: ${(err as Error).message}`);
    }

    if (i < testItems.length - 1) await sleep(DELAY_MS);
  }

  // Part C: Compute metrics
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  RESULTS                                                  ");
  console.log("═══════════════════════════════════════════════════════════\n");

  // 1. Coverage
  console.log(`1. Restaurants found on UE: ${foundCount} / ${RESTAURANTS.length}`);
  for (const [name, menu] of Object.entries(menus)) {
    console.log(`   - ${name}: ${menu.items.length} items (tested ${Math.min(menu.items.length, MAX_ITEMS_PER_RESTAURANT)})`);
  }
  console.log(`\n2. Total items tested: ${oldResults.length}\n`);

  // 3. Macro-calorie consistency
  const oldConsistencies = oldResults.map((r) => macroCalConsistency(r.estimate));
  const newConsistencies = newResults.map((r) => macroCalConsistency(r.estimate));

  console.log("3. Macro-Calorie Consistency (|cal - (p*4+c*4+f*9)| / cal)");
  console.log("   Lower = more internally consistent\n");
  console.log(`   ${"Metric".padEnd(30)} ${"Old Flow".padStart(12)} ${"New Flow".padStart(12)}`);
  console.log(`   ${"─".repeat(54)}`);
  console.log(`   ${"Mean consistency error".padEnd(30)} ${(mean(oldConsistencies) * 100).toFixed(1).padStart(11)}% ${(mean(newConsistencies) * 100).toFixed(1).padStart(11)}%`);
  console.log(`   ${"Median consistency error".padEnd(30)} ${(median(oldConsistencies) * 100).toFixed(1).padStart(11)}% ${(median(newConsistencies) * 100).toFixed(1).padStart(11)}%`);

  // Confidence distribution
  const oldConfDist = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  const newConfDist = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const r of oldResults) oldConfDist[r.estimate.conf]++;
  for (const r of newResults) newConfDist[r.estimate.conf]++;

  console.log("\n4. Confidence Distribution\n");
  console.log(`   ${"Confidence".padEnd(12)} ${"Old Flow".padStart(12)} ${"New Flow".padStart(12)}`);
  console.log(`   ${"─".repeat(36)}`);
  for (const level of ["HIGH", "MEDIUM", "LOW"] as const) {
    const oldPct = oldResults.length > 0 ? ((oldConfDist[level] / oldResults.length) * 100).toFixed(0) : "0";
    const newPct = newResults.length > 0 ? ((newConfDist[level] / newResults.length) * 100).toFixed(0) : "0";
    console.log(
      `   ${level.padEnd(12)} ${`${oldConfDist[level]} (${oldPct}%)`.padStart(12)} ${`${newConfDist[level]} (${newPct}%)`.padStart(12)}`,
    );
  }

  // Calorie difference between flows
  console.log("\n5. Calorie Differences Between Flows\n");
  const calDiffs: Array<{
    restaurant: string;
    item: string;
    oldCal: number;
    newCal: number;
    diff: number;
    oldConf: string;
    newConf: string;
    oldConsistency: number;
    newConsistency: number;
    description: string;
  }> = [];

  for (let i = 0; i < oldResults.length; i++) {
    const old = oldResults[i]!;
    const nw = newResults[i]!;
    calDiffs.push({
      restaurant: old.restaurant,
      item: old.item.name,
      oldCal: old.estimate.cal,
      newCal: nw.estimate.cal,
      diff: Math.abs(old.estimate.cal - nw.estimate.cal),
      oldConf: old.estimate.conf,
      newConf: nw.estimate.conf,
      oldConsistency: macroCalConsistency(old.estimate),
      newConsistency: macroCalConsistency(nw.estimate),
      description: old.item.description,
    });
  }

  // Sort by biggest calorie difference
  calDiffs.sort((a, b) => b.diff - a.diff);

  // Show top 10 biggest differences
  const topN = Math.min(10, calDiffs.length);
  console.log(`   Top ${topN} items with biggest calorie differences:\n`);
  console.log(
    `   ${"Restaurant".padEnd(20)} ${"Item".padEnd(30)} ${"Old Cal".padStart(8)} ${"New Cal".padStart(8)} ${"Diff".padStart(8)} ${"Old Conf".padStart(9)} ${"New Conf".padStart(9)}`,
  );
  console.log(`   ${"─".repeat(92)}`);

  for (let i = 0; i < topN; i++) {
    const d = calDiffs[i]!;
    console.log(
      `   ${d.restaurant.slice(0, 19).padEnd(20)} ${d.item.slice(0, 29).padEnd(30)} ${String(d.oldCal).padStart(8)} ${String(d.newCal).padStart(8)} ${String(d.diff).padStart(8)} ${d.oldConf.padStart(9)} ${d.newConf.padStart(9)}`,
    );
  }

  // Show detailed reasoning for top 3
  console.log("\n6. Detailed Reasoning (Top 3 Biggest Differences)\n");
  for (let i = 0; i < Math.min(3, calDiffs.length); i++) {
    const d = calDiffs[i]!;
    const oldR = oldResults.find((r) => r.item.name === d.item && r.restaurant === d.restaurant)!;
    const newR = newResults.find((r) => r.item.name === d.item && r.restaurant === d.restaurant)!;

    console.log(`   ── ${d.restaurant} / ${d.item} ──`);
    if (d.description) console.log(`   Description: ${d.description.slice(0, 100)}`);
    console.log(`   Old flow (${d.oldCal} cal, ${d.oldConf}): ${oldR.estimate.reasoning}`);
    console.log(`   New flow (${d.newCal} cal, ${d.newConf}): ${newR.estimate.reasoning}`);
    console.log();
  }

  // Confidence upgrades/downgrades
  let upgrades = 0;
  let downgrades = 0;
  let same = 0;
  const confOrder = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  for (let i = 0; i < oldResults.length; i++) {
    const oldLevel = confOrder[oldResults[i]!.estimate.conf];
    const newLevel = confOrder[newResults[i]!.estimate.conf];
    if (newLevel > oldLevel) upgrades++;
    else if (newLevel < oldLevel) downgrades++;
    else same++;
  }

  console.log("7. Confidence Changes (Old -> New)\n");
  console.log(`   Upgrades:   ${upgrades} (${oldResults.length > 0 ? ((upgrades / oldResults.length) * 100).toFixed(0) : 0}%)`);
  console.log(`   Downgrades: ${downgrades} (${oldResults.length > 0 ? ((downgrades / oldResults.length) * 100).toFixed(0) : 0}%)`);
  console.log(`   Unchanged:  ${same} (${oldResults.length > 0 ? ((same / oldResults.length) * 100).toFixed(0) : 0}%)`);

  // Cost summary
  const firecrawlCost = foundCount * COST_CONFIG.services.firecrawl.perSearch;
  console.log("\n8. Cost Summary\n");
  console.log(`   LLM calls: ${oldResults.length + newResults.length}`);
  console.log(`   LLM cost:       $${totalCost.toFixed(4)}`);
  console.log(`   Firecrawl cost:  $${firecrawlCost.toFixed(4)}`);
  console.log(`   Total cost:      $${(totalCost + firecrawlCost).toFixed(4)}`);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  DONE                                                     ");
  console.log("═══════════════════════════════════════════════════════════\n");
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
