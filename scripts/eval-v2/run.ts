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

async function callModel(
  client: Anthropic,
  model: string,
  system: string,
  user: string,
  imageUrl?: string,
): Promise<EstimateResult> {
  const start = Date.now();

  // Build user content — text only, or text + image
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

  return { ...parsed, latencyMs, costUsd };
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

  // Filter prompts
  const prompts = promptFilter
    ? PROMPTS.filter((p) => p.id === promptFilter)
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

  for (let run = 0; run < numRuns; run++) {
    if (numRuns > 1) console.log(`── Run ${run + 1}/${numRuns} ──`);

    for (const prompt of prompts) {
      const caseResults: CaseResult[] = [];
      process.stdout.write(`  ${prompt.id.padEnd(20)}`);

      for (const testCase of cases) {
        const { system, user } = prompt.buildMessages(testCase as unknown as Record<string, unknown>);
        const effectiveModel = prompt.modelOverride ?? modelName;
        const imageUrl = prompt.useImage ? (testCase as unknown as Record<string, unknown>)["imageUrl"] as string | undefined : undefined;

        try {
          const est = await callModel(client, effectiveModel, system, user, imageUrl);
          const errors = {
            calories: pctError(est.cal, testCase.expected.calories),
            proteinG: pctError(est.p, testCase.expected.proteinG),
            carbsG: pctError(est.c, testCase.expected.carbsG),
            fatG: pctError(est.f, testCase.expected.fatG),
          };

          caseResults.push({
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
            errors,
            latencyMs: est.latencyMs,
            costUsd: est.costUsd,
          });

          const avgErr = mean([errors.calories, errors.proteinG, errors.carbsG, errors.fatG]);
          process.stdout.write(avgErr < 15 ? "✓" : avgErr < 30 ? "~" : "✗");
        } catch (err) {
          process.stdout.write("E");
          console.error(`\n    Error on ${testCase.id}: ${err}`);
        }
      }

      allRuns.get(prompt.id)!.push(caseResults);

      const avgErr = mean(
        caseResults.flatMap((r) => [r.errors.calories, r.errors.proteinG, r.errors.carbsG, r.errors.fatG]),
      );
      console.log(`  avg err: ${avgErr.toFixed(1)}%`);
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
