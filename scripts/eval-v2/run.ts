#!/usr/bin/env npx tsx
/**
 * Eval V2 — Prompt lab for macro estimation.
 *
 * Runs every prompt variant against every test case, captures results,
 * and generates an HTML accuracy report opened in the browser.
 *
 * Usage:
 *   npx tsx scripts/eval-v2/run.ts                    # all prompts, all cases
 *   npx tsx scripts/eval-v2/run.ts --prompt few-shot  # single prompt
 *   npx tsx scripts/eval-v2/run.ts --case superba-*   # glob case IDs
 *   npx tsx scripts/eval-v2/run.ts --model claude-sonnet-4-5  # override model
 *   npx tsx scripts/eval-v2/run.ts --list             # list available prompts + cases
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
import { COST_CONFIG } from "../eval/cost-config.js";
import { PROMPTS, PROMPT_MAP } from "./prompts.js";
import { generateReport } from "./report.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TestCase {
  id: string;
  restaurant: string;
  name: string;
  description?: string;
  price?: number;
  section?: string;
  expected: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
  notes?: string;
}

interface CaseResult {
  caseId: string;
  caseName: string;
  restaurant: string;
  expected: TestCase["expected"];
  actual: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    confidence: string;
  };
  errors: {
    calories: number; // absolute % error
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
  latencyMs: number;
  costUsd: number;
}

export interface PromptResult {
  promptId: string;
  promptLabel: string;
  cases: CaseResult[];
  aggregate: {
    meanCalError: number;
    meanProteinError: number;
    meanCarbsError: number;
    meanFatError: number;
    meanOverallError: number; // avg of all four
    totalCostUsd: number;
    totalLatencyMs: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pctError(est: number, exp: number): number {
  if (exp === 0) return est > 0 ? 100 : 0;
  return (Math.abs(est - exp) / exp) * 100;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

interface EstimateResult {
  cal: number;
  p: number;
  c: number;
  f: number;
  conf: string;
  latencyMs: number;
  costUsd: number;
}

function parseModelResponse(raw: string): { cal: number; p: number; c: number; f: number; conf: string } {
  // Strip markdown fences
  let stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```\s*$/, "");

  // Extract first JSON object or array from the response (ignore trailing text)
  const jsonStart = stripped.indexOf("{");
  const arrStart = stripped.indexOf("[");
  const start = jsonStart >= 0 && (arrStart < 0 || jsonStart < arrStart) ? jsonStart : arrStart;
  if (start > 0) stripped = stripped.slice(start);

  // Find matching closing bracket
  const opener = stripped[0];
  const closer = opener === "[" ? "]" : "}";
  let depth = 0;
  let end = -1;
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === opener) depth++;
    else if (stripped[i] === closer) depth--;
    if (depth === 0) { end = i + 1; break; }
  }
  if (end > 0) stripped = stripped.slice(0, end);

  const parsed = JSON.parse(stripped);
  let obj = Array.isArray(parsed) ? parsed[0] : parsed;
  // Handle two-pass nested format: { analysis, estimate: { cal, p, c, f, conf } }
  if (obj.estimate && typeof obj.estimate === "object" && obj.estimate.cal !== undefined) {
    obj = obj.estimate;
  }
  return obj;
}

async function callModelRaw(
  client: Anthropic,
  model: string,
  system: string,
  user: string,
  imageUrl?: string,
): Promise<{ parsed: Record<string, unknown>; latencyMs: number; costUsd: number }> {
  const start = Date.now();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userContent: any = imageUrl
    ? [
        { type: "image", source: { type: "url", url: imageUrl } },
        { type: "text", text: user },
      ]
    : user;

  const message = await client.messages.create({
    model,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: userContent }],
  });
  const latencyMs = Date.now() - start;

  const block = message.content[0];
  if (!block || block.type !== "text") throw new Error("No text in response");

  const parsed = parseModelResponse(block.text);
  const pricing = COST_CONFIG.models[model] ?? COST_CONFIG.models["local"]!;
  const costUsd =
    message.usage.input_tokens * pricing!.input +
    message.usage.output_tokens * pricing!.output;

  return { parsed, latencyMs, costUsd };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Load cases
  const casesPath = join(__dirname, "cases.json");
  const allCases: TestCase[] = JSON.parse(readFileSync(casesPath, "utf-8"));

  // --list
  if (args.includes("--list")) {
    console.log("\nPrompts:");
    for (const p of PROMPTS) {
      console.log(`  ${p.id.padEnd(20)} ${p.label}`);
    }
    console.log(`\nCases (${allCases.length}):`);
    for (const c of allCases) {
      console.log(`  ${c.id.padEnd(30)} ${c.name} (${c.restaurant})`);
    }
    process.exit(0);
  }

  // --model
  const modelIdx = args.indexOf("--model");
  const modelName = modelIdx >= 0 ? args[modelIdx + 1]! : "claude-haiku-4-5";

  // --runs (repeat N times and average)
  const runsIdx = args.indexOf("--runs");
  const numRuns = runsIdx >= 0 ? parseInt(args[runsIdx + 1]!, 10) : 1;

  // --prompt filter
  const promptIdx = args.indexOf("--prompt");
  const promptFilter = promptIdx >= 0 ? args[promptIdx + 1] : null;

  // --case filter (glob-style)
  const caseIdx = args.indexOf("--case");
  const caseFilter = caseIdx >= 0 ? args[caseIdx + 1] : null;

  // --parallel concurrency
  const parallelIdx = args.indexOf("--parallel");
  const concurrency = parallelIdx >= 0 ? parseInt(args[parallelIdx + 1]!, 10) : 1;

  // Filter prompts (comma-separated)
  const prompts = promptFilter
    ? PROMPTS.filter((p) => promptFilter.split(",").includes(p.id))
    : PROMPTS;

  if (prompts.length === 0) {
    console.error(`Unknown prompt: ${promptFilter}`);
    console.error(`Available: ${PROMPTS.map((p) => p.id).join(", ")}`);
    process.exit(1);
  }

  // Filter cases
  const cases = caseFilter
    ? allCases.filter((c) => {
        if (caseFilter.includes("*")) {
          const re = new RegExp("^" + caseFilter.replace(/\*/g, ".*") + "$");
          return re.test(c.id);
        }
        return c.id === caseFilter;
      })
    : allCases;

  if (cases.length === 0) {
    console.error(`No cases match: ${caseFilter}`);
    process.exit(1);
  }

  const totalEvals = prompts.length * cases.length * numRuns;
  console.log(`\nEval V2: ${prompts.length} prompts × ${cases.length} cases × ${numRuns} runs = ${totalEvals} evaluations`);
  console.log(`Model: ${modelName}\n`);

  const client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });

  // Collect all runs per prompt: promptId → run[] → CaseResult[]
  const allRuns = new Map<string, CaseResult[][]>();
  for (const prompt of prompts) {
    allRuns.set(prompt.id, []);
  }

  // Build all tasks: { run, prompt, case } tuples
  type Task = { run: number; promptId: string; caseIdx: number };
  const tasks: Task[] = [];
  for (let run = 0; run < numRuns; run++) {
    for (const prompt of prompts) {
      for (let ci = 0; ci < cases.length; ci++) {
        tasks.push({ run, promptId: prompt.id, caseIdx: ci });
      }
    }
  }

  // Results storage: [promptId][run][caseIdx]
  const resultStore = new Map<string, Map<number, CaseResult[]>>();
  for (const prompt of prompts) {
    const runMap = new Map<number, CaseResult[]>();
    for (let r = 0; r < numRuns; r++) runMap.set(r, []);
    resultStore.set(prompt.id, runMap);
  }

  // Execute with concurrency limit
  let completed = 0;
  let errors = 0;
  const total = tasks.length;

  async function runTask(task: Task): Promise<void> {
    const prompt = PROMPT_MAP.get(task.promptId)!;
    const testCase = cases[task.caseIdx]!;
    const { system, user } = prompt.buildMessages(testCase as unknown as Record<string, unknown>);
    const effectiveModel = prompt.modelOverride ?? modelName;
    const imageUrl = prompt.useImage ? (testCase as unknown as Record<string, unknown>)["imageUrl"] as string | undefined : undefined;

    try {
      let est: { cal: number; p: number; c: number; f: number; conf: string; latencyMs: number; costUsd: number };

      if (task.promptId === "ensemble") {
        // Ensemble: run name-only + decompose-no-mult, average results
        const nameOnlyDef = PROMPT_MAP.get("name-only")!;
        const decomposeDef = PROMPT_MAP.get("decompose-no-mult") ?? PROMPT_MAP.get("decompose-clean")!;
        const noMsg = nameOnlyDef.buildMessages(testCase as unknown as Record<string, unknown>);
        const deMsg = decomposeDef.buildMessages(testCase as unknown as Record<string, unknown>);

        const [noRaw, deRaw] = await Promise.all([
          callModelRaw(client, effectiveModel, noMsg.system, noMsg.user),
          callModelRaw(client, effectiveModel, deMsg.system, deMsg.user),
        ]);

        const noEst = { cal: noRaw.parsed.cal as number, p: noRaw.parsed.p as number, c: noRaw.parsed.c as number, f: noRaw.parsed.f as number };
        const deProcessed = decomposeDef.postProcess!(deRaw.parsed);

        est = {
          cal: Math.round((noEst.cal + deProcessed.cal) / 2),
          p: Math.round(((noEst.p + deProcessed.p) / 2) * 10) / 10,
          c: Math.round(((noEst.c + deProcessed.c) / 2) * 10) / 10,
          f: Math.round(((noEst.f + deProcessed.f) / 2) * 10) / 10,
          conf: "MEDIUM",
          latencyMs: Math.max(noRaw.latencyMs, deRaw.latencyMs),
          costUsd: noRaw.costUsd + deRaw.costUsd,
        };
      } else {
        const raw = await callModelRaw(client, effectiveModel, system, user, imageUrl);
        est = prompt.postProcess
          ? { ...prompt.postProcess(raw.parsed), latencyMs: raw.latencyMs, costUsd: raw.costUsd }
          : { cal: raw.parsed.cal as number, p: raw.parsed.p as number, c: raw.parsed.c as number, f: raw.parsed.f as number, conf: raw.parsed.conf as string, latencyMs: raw.latencyMs, costUsd: raw.costUsd };
      }

      const errs = {
        calories: pctError(est.cal, testCase.expected.calories),
        proteinG: pctError(est.p, testCase.expected.proteinG),
        carbsG: pctError(est.c, testCase.expected.carbsG),
        fatG: pctError(est.f, testCase.expected.fatG),
      };

      resultStore.get(task.promptId)!.get(task.run)!.push({
        caseId: testCase.id,
        caseName: testCase.name,
        restaurant: testCase.restaurant,
        expected: testCase.expected,
        actual: {
          calories: Math.round(est.cal),
          proteinG: est.p,
          carbsG: est.c,
          fatG: est.f,
          confidence: est.conf,
        },
        errors: errs,
        latencyMs: est.latencyMs,
        costUsd: est.costUsd,
      });
    } catch (err) {
      errors++;
      console.error(`  Error [${task.promptId}/${testCase.id}/run${task.run}]: ${err}`);
    }

    completed++;
    if (completed % 20 === 0 || completed === total) {
      process.stdout.write(`\r  Progress: ${completed}/${total} (${errors} errors)`);
    }
  }

  // Semaphore-based parallel execution
  async function runAll(): Promise<void> {
    let idx = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (idx < tasks.length) {
        const task = tasks[idx++]!;
        await runTask(task);
      }
    });
    await Promise.all(workers);
  }

  console.log(`  Concurrency: ${concurrency}`);
  await runAll();
  console.log(); // newline after progress

  // Flatten resultStore into allRuns format
  for (const prompt of prompts) {
    const runMap = resultStore.get(prompt.id)!;
    for (let r = 0; r < numRuns; r++) {
      allRuns.get(prompt.id)!.push(runMap.get(r)!);
    }
  }

  // Aggregate across runs: for each prompt, average the per-case actuals across runs
  const results: PromptResult[] = [];

  for (const prompt of prompts) {
    const runs = allRuns.get(prompt.id)!;

    // For the report, show averaged actuals per case
    const avgCaseResults: CaseResult[] = [];
    const numCases = cases.length;

    for (let ci = 0; ci < numCases; ci++) {
      const caseRuns = runs.map((r) => r[ci]).filter(Boolean) as CaseResult[];
      if (caseRuns.length === 0) continue;

      const first = caseRuns[0]!;
      const avgActual = {
        calories: Math.round(mean(caseRuns.map((r) => r.actual.calories))),
        proteinG: Math.round(mean(caseRuns.map((r) => r.actual.proteinG)) * 10) / 10,
        carbsG: Math.round(mean(caseRuns.map((r) => r.actual.carbsG)) * 10) / 10,
        fatG: Math.round(mean(caseRuns.map((r) => r.actual.fatG)) * 10) / 10,
        confidence: first.actual.confidence, // just use first run's confidence
      };

      const errors = {
        calories: pctError(avgActual.calories, first.expected.calories),
        proteinG: pctError(avgActual.proteinG, first.expected.proteinG),
        carbsG: pctError(avgActual.carbsG, first.expected.carbsG),
        fatG: pctError(avgActual.fatG, first.expected.fatG),
      };

      avgCaseResults.push({
        ...first,
        actual: avgActual,
        errors,
        latencyMs: mean(caseRuns.map((r) => r.latencyMs)),
        costUsd: caseRuns.reduce((s, r) => s + r.costUsd, 0),
      });
    }

    const aggregate = {
      meanCalError: mean(avgCaseResults.map((r) => r.errors.calories)),
      meanProteinError: mean(avgCaseResults.map((r) => r.errors.proteinG)),
      meanCarbsError: mean(avgCaseResults.map((r) => r.errors.carbsG)),
      meanFatError: mean(avgCaseResults.map((r) => r.errors.fatG)),
      meanOverallError: mean(
        avgCaseResults.flatMap((r) => [r.errors.calories, r.errors.proteinG, r.errors.carbsG, r.errors.fatG]),
      ),
      totalCostUsd: avgCaseResults.reduce((s, r) => s + r.costUsd, 0),
      totalLatencyMs: avgCaseResults.reduce((s, r) => s + r.latencyMs, 0),
    };

    results.push({
      promptId: prompt.id,
      promptLabel: prompt.label,
      cases: avgCaseResults,
      aggregate,
    });

    if (numRuns > 1) {
      // Show per-run spread
      const perRunErrors = runs.map((r) =>
        mean(r.flatMap((cr) => [cr.errors.calories, cr.errors.proteinG, cr.errors.carbsG, cr.errors.fatG])),
      );
      const min = Math.min(...perRunErrors);
      const max = Math.max(...perRunErrors);
      console.log(`  ${prompt.id.padEnd(20)} avg: ${aggregate.meanOverallError.toFixed(1)}%  range: [${min.toFixed(1)}% – ${max.toFixed(1)}%]  cost: $${aggregate.totalCostUsd.toFixed(4)}`);
    }
  }

  // Sort by best overall accuracy
  results.sort((a, b) => a.aggregate.meanOverallError - b.aggregate.meanOverallError);

  // Save JSON
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const jsonPath = join(__dirname, `results-${timestamp}.json`);
  writeFileSync(jsonPath, JSON.stringify({ model: modelName, timestamp, results }, null, 2));
  console.log(`\nJSON saved: ${jsonPath}`);

  // Generate and open HTML report
  const htmlPath = join(__dirname, `report-${timestamp}.html`);
  const html = generateReport(modelName, timestamp, results, cases[0] as unknown as Record<string, unknown>, numRuns);
  writeFileSync(htmlPath, html);
  console.log(`HTML report: ${htmlPath}`);

  try {
    execSync(`open "${htmlPath}"`);
  } catch {
    // non-macOS — just print the path
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
