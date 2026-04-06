import * as fs from "fs";
import * as path from "path";
import type {
  GroundTruthItem,
  EvalCase,
  EvalRun,
  EvalItemResult,
  PromptVariant,
} from "./lib/types";
import { createAdapter } from "./lib/models";
import { CostTracker, appendCostLog, getMonthlySpend } from "./lib/costs";
import {
  computeItemMetrics,
  computeAggregateMetrics,
  computeConfidenceCalibration,
  computePerChainBreakdown,
  findRedFlags,
} from "./lib/metrics";
import {
  printCaseReport,
  printComparisonMatrix,
  printPermutations,
  printCaseList,
  saveRunResult,
} from "./lib/reporter";
import { EVAL_CASES, allPermutations } from "./eval-cases";
import { COST_CONFIG } from "./cost-config";

// ─── CLI Parsing ────────────────────────────────────────────────────────────

interface CliArgs {
  caseName?: string;
  tag?: string;
  list: boolean;
  permutations: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { list: false, permutations: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--case" && i + 1 < args.length) {
      result.caseName = args[++i] as string;
    } else if (arg === "--tag" && i + 1 < args.length) {
      result.tag = args[++i] as string;
    } else if (arg === "--list") {
      result.list = true;
    } else if (arg === "--permutations") {
      result.permutations = true;
    }
  }

  return result;
}

// ─── Fixture Loading ────────────────────────────────────────────────────────

function loadFixtures(tag?: string): GroundTruthItem[] {
  const fixturePath = path.join(
    __dirname,
    "fixtures",
    "ground-truth.json",
  );
  const raw = fs.readFileSync(fixturePath, "utf-8");
  let items: GroundTruthItem[] = JSON.parse(raw);

  if (tag) {
    items = items.filter(
      (item) => item.tags && item.tags.includes(tag),
    );
    console.log(`Filtered to ${items.length} items with tag "${tag}"`);
  }

  return items;
}

// ─── Prompt Resolution ──────────────────────────────────────────────────────

// Prompt files export named constants (e.g., baseline, servingSize, chainHints).
// We map prompt case names to their module export names.
function promptNameToExport(promptName: string): string {
  // Convert kebab-case to camelCase: "chain-hints" -> "chainHints"
  return promptName.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

async function resolvePromptVariant(
  promptName: string,
): Promise<PromptVariant> {
  const modulePath = `./prompts/${promptName}.js`;
  const promptModule = await import(modulePath);

  // Try default export first, then named export matching the prompt name
  if (promptModule.default) {
    return promptModule.default as PromptVariant;
  }

  const exportName = promptNameToExport(promptName);
  if (promptModule[exportName]) {
    return promptModule[exportName] as PromptVariant;
  }

  // Fallback: grab the first export that looks like a PromptVariant
  for (const key of Object.keys(promptModule)) {
    const val = promptModule[key];
    if (val && typeof val === "object" && "buildMessages" in val) {
      return val as PromptVariant;
    }
  }

  throw new Error(
    `Could not resolve prompt variant "${promptName}" from ${modulePath}`,
  );
}

// ─── Delay Helper ───────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Run Single Case ────────────────────────────────────────────────────────

async function runCase(
  evalCase: EvalCase,
  fixtures: GroundTruthItem[],
): Promise<EvalRun> {
  console.log(
    `\nStarting case: ${evalCase.name} (${evalCase.model} × ${evalCase.prompt})`,
  );
  console.log(`Fixtures: ${fixtures.length} items\n`);

  const promptVariant = await resolvePromptVariant(evalCase.prompt);
  const adapter = createAdapter(evalCase.model);
  const costTracker = new CostTracker(evalCase.model);

  const items: EvalItemResult[] = [];
  const total = fixtures.length;

  for (let i = 0; i < total; i++) {
    const fixture = fixtures[i]!;

    try {
      const { system, userMessage } = promptVariant.buildMessages(fixture);
      const estimated = await adapter.estimate(system, userMessage);

      costTracker.track(estimated.inputTokens, estimated.outputTokens);

      const itemResult = computeItemMetrics(estimated, fixture);
      items.push(itemResult);

      const errorPct = itemResult.errors.calories.pct;
      console.log(
        `[${i + 1}/${total}] ${fixture.itemName} @ ${fixture.chain} → ${estimated.calories} cal (${errorPct.toFixed(1)}%)`,
      );
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : String(err);
      console.error(
        `[${i + 1}/${total}] ERROR: ${fixture.itemName} @ ${fixture.chain} — ${errorMsg}`,
      );
      // Skip this item, don't abort the run
    }

    // Rate-limit delay between calls (skip after last item)
    if (i < total - 1) {
      await delay(500);
    }
  }

  // Compute aggregates
  const aggregate = computeAggregateMetrics(items);
  const confidenceCalibration = computeConfidenceCalibration(items);
  const perChain = computePerChainBreakdown(items);
  const redFlags = findRedFlags(items);

  const totalCostUsd = items.reduce(
    (sum, item) => sum + item.estimated.costUsd,
    0,
  );
  const totalLatencyMs = items.reduce(
    (sum, item) => sum + item.estimated.latencyMs,
    0,
  );

  const run: EvalRun = {
    caseName: evalCase.name,
    model: evalCase.model,
    promptVariant: evalCase.prompt,
    timestamp: new Date().toISOString(),
    itemCount: items.length,
    aggregate,
    confidenceCalibration,
    perChain,
    redFlags,
    totalCostUsd,
    totalLatencyMs,
    items,
  };

  return run;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cli = parseArgs();

  // --permutations: print full matrix and exit
  if (cli.permutations) {
    const models = [...new Set(EVAL_CASES.map((c) => c.model))];
    const prompts = [...new Set(EVAL_CASES.map((c) => c.prompt))];
    printPermutations(models, prompts);
    return;
  }

  // --list: print configured cases and exit
  if (cli.list) {
    const fixtures = loadFixtures(cli.tag);
    printCaseList(EVAL_CASES, fixtures.length);
    return;
  }

  // Load fixtures
  const fixtures = loadFixtures(cli.tag);
  if (fixtures.length === 0) {
    console.error("No fixtures found. Check ground-truth.json or --tag filter.");
    process.exit(1);
  }

  // Determine which cases to run
  let casesToRun: EvalCase[];
  if (cli.caseName) {
    const found = EVAL_CASES.find((c) => c.name === cli.caseName);
    if (!found) {
      console.error(
        `Case "${cli.caseName}" not found. Available: ${EVAL_CASES.map((c) => c.name).join(", ")}`,
      );
      process.exit(1);
    }
    casesToRun = [found];
  } else {
    casesToRun = EVAL_CASES;
  }

  console.log(
    `Running ${casesToRun.length} case(s) against ${fixtures.length} fixtures`,
  );

  // Run each case
  const completedRuns: EvalRun[] = [];

  for (const evalCase of casesToRun) {
    const run = await runCase(evalCase, fixtures);

    // Print report
    printCaseReport(run);

    // Save result JSON
    saveRunResult(run);

    // Append cost log
    const costEntry = {
      date: new Date().toISOString(),
      caseName: run.caseName,
      model: run.model,
      prompt: run.promptVariant,
      items: run.itemCount,
      costUsd: run.totalCostUsd,
    };
    appendCostLog(costEntry);

    completedRuns.push(run);
  }

  // Comparison matrix if multiple cases ran
  if (completedRuns.length > 1) {
    printComparisonMatrix(completedRuns);
  }

  // Monthly spend summary
  const monthlySpend = getMonthlySpend();
  const budget = COST_CONFIG.caps.monthlyBudgetUsd;
  console.log(
    `Monthly spend: $${monthlySpend.toFixed(4)} / $${budget.toFixed(2)} budget (${((monthlySpend / budget) * 100).toFixed(1)}%)`,
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
