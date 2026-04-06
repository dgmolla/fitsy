import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import type {
  GroundTruthItem,
  EvalItemResult,
  RedFlagItem,
  ChainBreakdown,
  MacroAggregateMetrics,
} from "./lib/types";
import { createAdapter } from "./lib/models";
import {
  computeItemMetrics,
  computeAggregateMetrics,
  computePerChainBreakdown,
  findRedFlags,
} from "./lib/metrics";
import { COST_CONFIG } from "./cost-config";

// ─── Types ──────────────────────────────────────────────────────────────────

interface IterationLog {
  iteration: number;
  timestamp: string;
  change_description: string;
  prompt_text: { system: string; user_template: string };
  metrics: {
    mdAPE: number;
    mape: number;
    p90: number;
    redFlagCount: number;
  };
  decision: "keep" | "revert";
  reason: string;
  evalCostUsd: number;
  proposalCostUsd: number;
  totalCostUsd: number;
  bestMdAPE: number;
}

interface ProposalResult {
  change_description: string;
  system_prompt: string;
  user_template: string;
  costUsd: number;
}

interface EvalResult {
  items: EvalItemResult[];
  aggregate: { calories: MacroAggregateMetrics };
  perChain: ChainBreakdown[];
  redFlags: RedFlagItem[];
  costUsd: number;
}

// ─── CLI Parsing ────────────────────────────────────────────────────────────

interface CliArgs {
  cap: number;
  resume: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { cap: 20, resume: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--cap" && i + 1 < args.length) {
      result.cap = parseFloat(args[++i]!);
    } else if (arg === "--resume") {
      result.resume = true;
    }
  }

  return result;
}

// ─── Fixture Loading ────────────────────────────────────────────────────────

function loadFixtures(): GroundTruthItem[] {
  const fixtureDir = path.join(__dirname, "fixtures");
  const gtPath = path.join(fixtureDir, "ground-truth.json");

  if (!fs.existsSync(gtPath)) {
    throw new Error("ground-truth.json not found");
  }

  const raw = fs.readFileSync(gtPath, "utf-8");
  const items = JSON.parse(raw) as GroundTruthItem[];

  // Only use chain fixtures for the improvement loop — they have verified ground truth.
  // Indie-synthetic fixtures are tested separately after convergence.
  console.log(`Loaded ${items.length} chain fixtures`);
  return items;
}

// ─── Delay Helper ───────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Baseline Prompt ────────────────────────────────────────────────────────

const BASELINE_SYSTEM = `You are a nutrition expert. Estimate the macronutrient content for the given menu item.

Return ONLY valid JSON (no markdown fences, no explanation) with these exact fields:
- cal: calories (integer)
- p: protein in grams (number)
- c: carbohydrates in grams (number)
- f: fat in grams (number)
- conf: confidence level (string: "HIGH", "MEDIUM", or "LOW")
- reasoning: brief explanation of your estimate (string)`;

const BASELINE_USER_TEMPLATE = `Dish: {itemName}\nRestaurant: {chain}`;

// ─── Run Eval ───────────────────────────────────────────────────────────────

async function runEval(
  systemPrompt: string,
  userTemplate: string,
  fixtures: GroundTruthItem[],
): Promise<EvalResult> {
  const model = "claude-haiku-4-5";
  const adapter = createAdapter(model);
  const items: EvalItemResult[] = [];
  let totalCost = 0;

  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i]!;
    const userMessage = userTemplate
      .replace("{itemName}", fixture.itemName)
      .replace("{chain}", fixture.chain)
      .replace("{description}", fixture.description ?? "");

    try {
      const estimated = await adapter.estimate(systemPrompt, userMessage);
      totalCost += estimated.costUsd;
      const itemResult = computeItemMetrics(estimated, fixture);
      items.push(itemResult);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `  [${i + 1}/${fixtures.length}] ERROR: ${fixture.itemName} @ ${fixture.chain} -- ${errorMsg}`,
      );
    }

    // Rate-limit: 500ms between calls
    if (i < fixtures.length - 1) {
      await delay(500);
    }
  }

  const aggregate = computeAggregateMetrics(items);
  const perChain = computePerChainBreakdown(items);
  const redFlags = findRedFlags(items);

  return {
    items,
    aggregate: { calories: aggregate.calories },
    perChain,
    redFlags,
    costUsd: totalCost,
  };
}

// ─── Propose Change ─────────────────────────────────────────────────────────

function formatRedFlags(redFlags: RedFlagItem[]): string {
  if (redFlags.length === 0) return "None";
  return redFlags
    .slice(0, 15) // Limit to top 15 to keep prompt manageable
    .map(
      (rf) =>
        `- ${rf.itemName} @ ${rf.chain}: estimated ${rf.estimatedCalories} vs official ${rf.officialCalories} (${rf.pctError.toFixed(1)}% error)\n  Diagnosis: ${rf.diagnosis} -- ${rf.diagnosisDetail}${rf.modelReasoning ? `\n  Model said: ${rf.modelReasoning.slice(0, 150)}` : ""}`,
    )
    .join("\n");
}

function formatPerChain(perChain: ChainBreakdown[]): string {
  return perChain
    .map((c) => `- ${c.chain}: ${c.count} items, median cal error ${c.medianCalError.toFixed(1)}%`)
    .join("\n");
}

function formatHistory(history: IterationLog[]): string {
  if (history.length === 0) return "No previous iterations.";
  return history
    .slice(-10) // Last 10 iterations
    .map(
      (h) =>
        `- Iter ${h.iteration}: ${h.change_description} -> ${h.decision.toUpperCase()} (MdAPE: ${h.metrics.mdAPE.toFixed(1)}%)`,
    )
    .join("\n");
}

async function proposeChange(
  currentSystem: string,
  currentUserTemplate: string,
  mdAPE: number,
  redFlags: RedFlagItem[],
  perChain: ChainBreakdown[],
  history: IterationLog[],
): Promise<ProposalResult> {
  const anthropic = new Anthropic({
    apiKey: process.env["ANTHROPIC_API_KEY"],
  });

  const currentPrompt = `SYSTEM PROMPT:\n${currentSystem}\n\nUSER MESSAGE TEMPLATE:\n${currentUserTemplate}`;

  const proposalPrompt = `You are optimizing a nutrition estimation prompt. Here is the current best prompt:
---
${currentPrompt}
---

Recent eval results (MdAPE: ${mdAPE.toFixed(1)}%, ${redFlags.length} red flags):

Red flags with diagnosis:
${formatRedFlags(redFlags)}

Per-chain accuracy:
${formatPerChain(perChain)}

Past iterations:
${formatHistory(history)}

Propose ONE focused change to the prompt to reduce estimation error.
- Target a specific failure pattern (e.g., serving size, portion count, product variant confusion)
- Don't make the prompt too long -- concise instructions work better
- Explain what pattern you're targeting and why
- The goal is to improve the model's REASONING about food, not its recall of specific chain data
- We are testing on chains because they have verified data, but the prompt will be used on independent restaurants with no published nutrition data
- Available placeholders for user template: {itemName}, {chain}, {description} (menu description if available, empty string if not)
- The prompt MUST always instruct the model to return valid JSON -- never remove that instruction

Return your response as JSON:
{
  "change_description": "what you changed and why",
  "system_prompt": "the full updated system prompt text",
  "user_template": "the full updated user message template (use {itemName}, {chain}, and optionally {description} placeholders)"
}`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4096,
    messages: [{ role: "user", content: proposalPrompt }],
  });

  const contentBlock = message.content[0];
  if (!contentBlock || contentBlock.type !== "text") {
    throw new Error("No text content in proposal response");
  }

  let rawText = contentBlock.text
    .trim()
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```\s*$/, "");

  // Try to extract JSON object if there's surrounding text
  const jsonMatch = rawText.match(/\{[\s\S]*"system_prompt"[\s\S]*\}/);
  if (jsonMatch) {
    rawText = jsonMatch[0];
  }

  const parsed = JSON.parse(rawText) as {
    change_description: string;
    system_prompt: string;
    user_template: string;
  };

  const pricing = COST_CONFIG.models["claude-haiku-4-5"]!;
  const costUsd =
    message.usage.input_tokens * pricing.input +
    message.usage.output_tokens * pricing.output;

  return {
    change_description: parsed.change_description,
    system_prompt: parsed.system_prompt,
    user_template: parsed.user_template,
    costUsd,
  };
}

// ─── Save Prompt File ───────────────────────────────────────────────────────

function savePromptFile(
  iteration: number,
  systemPrompt: string,
  userTemplate: string,
  description: string,
): void {
  const promptsDir = path.join(__dirname, "prompts");
  const filePath = path.join(promptsDir, `auto-${iteration}.ts`);

  // Build camelCase export name
  const exportName = `auto${iteration}`;

  const content = `import type { PromptVariant } from "../lib/types";

const SYSTEM_PROMPT = ${JSON.stringify(systemPrompt)};

const USER_TEMPLATE = ${JSON.stringify(userTemplate)};

export const ${exportName}: PromptVariant = {
  name: "auto-${iteration}",
  description: ${JSON.stringify(description)},
  buildMessages(item) {
    return {
      system: SYSTEM_PROMPT,
      userMessage: USER_TEMPLATE
        .replace("{itemName}", item.itemName)
        .replace("{chain}", item.chain),
    };
  },
};
`;

  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`  Saved prompt: ${filePath}`);
}

// ─── Log Entry ──────────────────────────────────────────────────────────────

function appendLog(entry: IterationLog): void {
  const resultsDir = path.join(__dirname, "results");
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  const logPath = path.join(resultsDir, "auto-improve-log.jsonl");
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\n");
}

function readLog(): IterationLog[] {
  const logPath = path.join(__dirname, "results", "auto-improve-log.jsonl");
  if (!fs.existsSync(logPath)) return [];
  const content = fs.readFileSync(logPath, "utf-8").trim();
  if (!content) return [];
  return content.split("\n").map((line) => JSON.parse(line) as IterationLog);
}

// ─── Resume Support ─────────────────────────────────────────────────────────

interface ResumeState {
  bestSystem: string;
  bestUserTemplate: string;
  bestMdAPE: number;
  totalCost: number;
  iteration: number;
  history: IterationLog[];
}

function loadResumeState(): ResumeState | null {
  const history = readLog();
  if (history.length === 0) return null;

  // Find the last "keep" entry to get best prompt
  const lastKeep = [...history].reverse().find((h) => h.decision === "keep");
  const lastEntry = history[history.length - 1]!;

  if (lastKeep) {
    return {
      bestSystem: lastKeep.prompt_text.system,
      bestUserTemplate: lastKeep.prompt_text.user_template,
      bestMdAPE: lastEntry.bestMdAPE,
      totalCost: lastEntry.totalCostUsd,
      iteration: lastEntry.iteration,
      history,
    };
  }

  // All reverted -- best is still baseline
  return {
    bestSystem: BASELINE_SYSTEM,
    bestUserTemplate: BASELINE_USER_TEMPLATE,
    bestMdAPE: lastEntry.bestMdAPE,
    totalCost: lastEntry.totalCostUsd,
    iteration: lastEntry.iteration,
    history,
  };
}

// ─── Main Loop ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cli = parseArgs();
  const costCap = cli.cap;

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  AUTO-IMPROVE LOOP (Karpathy autoresearch-style)`);
  console.log(`  Cost cap: $${costCap.toFixed(2)}`);
  console.log(`${"=".repeat(70)}\n`);

  // Load fixtures
  const fixtures = loadFixtures();
  if (fixtures.length === 0) {
    console.error("No fixtures found. Check ground-truth.json.");
    process.exit(1);
  }

  let bestSystem: string;
  let bestUserTemplate: string;
  let bestMdAPE: number;
  let totalCost: number;
  let iteration: number;
  let history: IterationLog[];
  let bestRedFlags: RedFlagItem[];
  let bestPerChain: ChainBreakdown[];

  // Resume or start fresh
  if (cli.resume) {
    const state = loadResumeState();
    if (state) {
      bestSystem = state.bestSystem;
      bestUserTemplate = state.bestUserTemplate;
      bestMdAPE = state.bestMdAPE;
      totalCost = state.totalCost;
      iteration = state.iteration;
      history = state.history;

      console.log(`Resumed from iteration ${iteration}`);
      console.log(`  Best MdAPE: ${bestMdAPE.toFixed(1)}%`);
      console.log(`  Total cost so far: $${totalCost.toFixed(4)}`);
      console.log(`  History: ${history.length} entries\n`);

      // Re-run eval on best prompt to get current red flags and per-chain
      console.log("Re-evaluating best prompt to get current state...");
      const reEval = await runEval(bestSystem, bestUserTemplate, fixtures);
      totalCost += reEval.costUsd;
      bestRedFlags = reEval.redFlags;
      bestPerChain = reEval.perChain;
      bestMdAPE = reEval.aggregate.calories.medianAbsPctError;
      console.log(`  Current MdAPE: ${bestMdAPE.toFixed(1)}%, ${bestRedFlags.length} red flags\n`);
    } else {
      console.log("No previous run found. Starting fresh.\n");
      bestSystem = BASELINE_SYSTEM;
      bestUserTemplate = BASELINE_USER_TEMPLATE;
      bestMdAPE = 0;
      totalCost = 0;
      iteration = 0;
      history = [];
      bestRedFlags = [];
      bestPerChain = [];
    }
  } else {
    bestSystem = BASELINE_SYSTEM;
    bestUserTemplate = BASELINE_USER_TEMPLATE;
    bestMdAPE = 0;
    totalCost = 0;
    iteration = 0;
    history = [];
    bestRedFlags = [];
    bestPerChain = [];
  }

  // Run initial baseline eval if starting fresh
  if (iteration === 0) {
    console.log("Running baseline eval...");
    const baselineResult = await runEval(bestSystem, bestUserTemplate, fixtures);
    totalCost += baselineResult.costUsd;
    bestMdAPE = baselineResult.aggregate.calories.medianAbsPctError;
    bestRedFlags = baselineResult.redFlags;
    bestPerChain = baselineResult.perChain;

    console.log(`\nBaseline: MdAPE ${bestMdAPE.toFixed(1)}%, ${bestRedFlags.length} red flags, cost $${baselineResult.costUsd.toFixed(4)}`);
    console.log(`${"─".repeat(70)}\n`);
  }

  const startingMdAPE = bestMdAPE;
  let keptCount = 0;
  let revertedCount = 0;
  let consecutiveReverts = 0;

  // Build set of items with >50% error for catastrophic check
  let bestCatastrophicIds = new Set(
    bestRedFlags
      .filter((rf) => rf.pctError > 50)
      .map((rf) => rf.id),
  );

  // Main loop
  while (totalCost < costCap) {
    iteration++;

    console.log(`\n[Iteration ${iteration}] ─────────────────────────────────────`);

    // Step 1: Propose a change
    console.log("  Proposing change...");
    let proposal: ProposalResult | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        proposal = await proposeChange(
          bestSystem,
          bestUserTemplate,
          bestMdAPE,
          bestRedFlags,
          bestPerChain,
          history,
        );
        totalCost += proposal.costUsd;
        break;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`  Proposal attempt ${attempt + 1}/3 failed: ${errorMsg}`);
        await delay(1000);
      }
    }
    if (!proposal) {
      console.error("  All 3 proposal attempts failed, skipping iteration");
      // Don't count proposal failures toward convergence
      continue;
    }

    console.log(`  Change: ${proposal.change_description}`);
    console.log(`  Proposal cost: $${proposal.costUsd.toFixed(4)}`);

    // Check cost cap before running eval
    if (totalCost >= costCap) {
      console.log("  Cost cap reached before eval. Stopping.");
      break;
    }

    // Step 2: Run eval with new prompt
    console.log("  Running eval...");
    let evalResult: EvalResult;
    try {
      evalResult = await runEval(proposal.system_prompt, proposal.user_template, fixtures);
      totalCost += evalResult.costUsd;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`  Eval failed: ${errorMsg}`);
      consecutiveReverts++;

      const logEntry: IterationLog = {
        iteration,
        timestamp: new Date().toISOString(),
        change_description: proposal.change_description,
        prompt_text: {
          system: proposal.system_prompt,
          user_template: proposal.user_template,
        },
        metrics: { mdAPE: 0, mape: 0, p90: 0, redFlagCount: 0 },
        decision: "revert",
        reason: `eval failed: ${errorMsg}`,
        evalCostUsd: 0,
        proposalCostUsd: proposal.costUsd,
        totalCostUsd: totalCost,
        bestMdAPE,
      };
      appendLog(logEntry);
      history.push(logEntry);

      if (consecutiveReverts >= 8) {
        console.log("\nConverged -- no improvement in 8 iterations");
        break;
      }
      continue;
    }

    const newMdAPE = evalResult.aggregate.calories.medianAbsPctError;
    const newMAPE = computeAggregateMetrics(evalResult.items).calories.meanAbsPctError;
    const newP90 = evalResult.aggregate.calories.p90AbsPctError;
    const newRedFlagCount = evalResult.redFlags.length;

    // Step 3: Decide keep/revert
    const improvement = bestMdAPE - newMdAPE;

    // Check for new catastrophic errors (>50% error on items that weren't >50% before)
    const newCatastrophicIds = new Set(
      evalResult.redFlags
        .filter((rf) => rf.pctError > 50)
        .map((rf) => rf.id),
    );
    let hasNewCatastrophic = false;
    for (const id of newCatastrophicIds) {
      if (!bestCatastrophicIds.has(id)) {
        hasNewCatastrophic = true;
        break;
      }
    }

    let decision: "keep" | "revert";
    let reason: string;

    if (improvement > 1.0 && !hasNewCatastrophic) {
      decision = "keep";
      reason = `MdAPE improved by ${improvement.toFixed(1)}pp`;
      bestMdAPE = newMdAPE;
      bestSystem = proposal.system_prompt;
      bestUserTemplate = proposal.user_template;
      bestRedFlags = evalResult.redFlags;
      bestPerChain = evalResult.perChain;
      bestCatastrophicIds = newCatastrophicIds;
      keptCount++;
      consecutiveReverts = 0;

      // Save prompt file
      savePromptFile(
        iteration,
        proposal.system_prompt,
        proposal.user_template,
        proposal.change_description,
      );
    } else {
      decision = "revert";
      if (hasNewCatastrophic) {
        reason = "introduced catastrophic error (>50% on new items)";
      } else {
        reason = `improvement too small (${improvement.toFixed(1)}pp, need >1.0pp)`;
      }
      revertedCount++;
      consecutiveReverts++;
    }

    // Step 4: Log
    const logEntry: IterationLog = {
      iteration,
      timestamp: new Date().toISOString(),
      change_description: proposal.change_description,
      prompt_text: {
        system: proposal.system_prompt,
        user_template: proposal.user_template,
      },
      metrics: {
        mdAPE: newMdAPE,
        mape: newMAPE,
        p90: newP90,
        redFlagCount: newRedFlagCount,
      },
      decision,
      reason,
      evalCostUsd: evalResult.costUsd,
      proposalCostUsd: proposal.costUsd,
      totalCostUsd: totalCost,
      bestMdAPE,
    };
    appendLog(logEntry);
    history.push(logEntry);

    // Step 5: Print progress
    const arrow = decision === "keep" ? ">>>" : "-->";
    console.log(
      `  [iter ${iteration}] MdAPE: ${(newMdAPE + improvement).toFixed(1)}% ${arrow} ${newMdAPE.toFixed(1)}% (delta ${improvement >= 0 ? "+" : ""}${improvement.toFixed(1)}%) | Red flags: ${bestRedFlags.length} | Decision: ${decision.toUpperCase()} | Cost: $${totalCost.toFixed(2)}/$${costCap}`,
    );
    if (decision === "revert") {
      console.log(`  Reason: ${reason}`);
    }

    // Convergence check
    if (consecutiveReverts >= 5) {
      console.log("\nConverged -- no improvement in 5 iterations");
      break;
    }
  }

  // ─── Final Summary ──────────────────────────────────────────────────────

  console.log(`\n${"=".repeat(70)}`);
  console.log("  AUTO-IMPROVE FINAL SUMMARY");
  console.log(`${"=".repeat(70)}`);
  console.log(`  Total iterations:  ${iteration}`);
  console.log(`  Kept:              ${keptCount}`);
  console.log(`  Reverted:          ${revertedCount}`);
  console.log(`  Starting MdAPE:    ${startingMdAPE.toFixed(1)}%`);
  console.log(`  Final MdAPE:       ${bestMdAPE.toFixed(1)}%`);
  console.log(`  Improvement:       ${(startingMdAPE - bestMdAPE).toFixed(1)}pp`);
  console.log(`  Total cost:        $${totalCost.toFixed(4)}`);

  console.log(`\n  Best prompt (system):`);
  console.log(`  ${"─".repeat(60)}`);
  for (const line of bestSystem.split("\n")) {
    console.log(`  ${line}`);
  }
  console.log(`  ${"─".repeat(60)}`);

  console.log(`\n  Best prompt (user template):`);
  console.log(`  ${"─".repeat(60)}`);
  for (const line of bestUserTemplate.split("\n")) {
    console.log(`  ${line}`);
  }
  console.log(`  ${"─".repeat(60)}`);

  if (bestRedFlags.length > 0) {
    console.log(`\n  Remaining red flags (${bestRedFlags.length}):`);
    for (const rf of bestRedFlags.slice(0, 10)) {
      console.log(
        `    - ${rf.itemName} @ ${rf.chain}: ${rf.pctError.toFixed(1)}% error (${rf.diagnosis})`,
      );
    }
    if (bestRedFlags.length > 10) {
      console.log(`    ... and ${bestRedFlags.length - 10} more`);
    }
  } else {
    console.log("\n  Remaining red flags: none");
  }

  console.log(`\n${"=".repeat(70)}\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
