import * as fs from "fs";
import * as path from "path";
import type {
  EvalRun,
  EvalCase,
} from "./types";
import { median } from "./metrics";
import { COST_CONFIG } from "../cost-config";

// ─── Helpers ────────────────────────────────────────────────────────────────

function pad(str: string, len: number): string {
  return str.padEnd(len);
}

function rpad(str: string, len: number): string {
  return str.padStart(len);
}

function pctStr(val: number): string {
  return `${val.toFixed(1)}%`;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

function formatTimestamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${y}${mo}${d}-${h}${mi}${s}`;
}

// ─── Case Report ────────────────────────────────────────────────────────────

export function printCaseReport(run: EvalRun): void {
  const divider = "=".repeat(80);

  // Header
  console.log(`\n${divider}`);
  console.log(
    `=== ${run.caseName} (${run.model} × ${run.promptVariant}) — ${run.itemCount} items ===`,
  );
  console.log(divider);

  // Aggregate metrics table (calories)
  const cal = run.aggregate.calories;
  console.log("\nCalories Aggregate Metrics:");
  console.log(`  ${pad("MdAPE:", 12)} ${pctStr(cal.medianAbsPctError)}`);
  console.log(`  ${pad("MAPE:", 12)} ${pctStr(cal.meanAbsPctError)}`);
  console.log(`  ${pad("P90:", 12)} ${pctStr(cal.p90AbsPctError)}`);
  console.log(
    `  ${pad("Median Signed:", 18)} ${cal.medianSignedPctError >= 0 ? "+" : ""}${pctStr(cal.medianSignedPctError)}`,
  );

  // Per-chain breakdown
  if (run.perChain.length > 0) {
    console.log("\nPer-Chain Breakdown:");
    console.log(
      `  ${pad("Chain", 25)} ${rpad("Count", 7)} ${rpad("Med Cal Err", 12)}`,
    );
    console.log(`  ${"-".repeat(44)}`);
    for (const chain of run.perChain) {
      console.log(
        `  ${pad(chain.chain, 25)} ${rpad(String(chain.count), 7)} ${rpad(pctStr(chain.medianCalError), 12)}`,
      );
    }
  }

  // Confidence calibration
  if (run.confidenceCalibration.length > 0) {
    console.log("\nConfidence Calibration:");
    console.log(
      `  ${pad("Confidence", 14)} ${rpad("Count", 7)} ${rpad("Med Cal Err", 12)}`,
    );
    console.log(`  ${"-".repeat(33)}`);
    for (const cc of run.confidenceCalibration) {
      console.log(
        `  ${pad(cc.confidence, 14)} ${rpad(String(cc.count), 7)} ${rpad(pctStr(cc.medianCalError), 12)}`,
      );
    }
  }

  // Red flags
  if (run.redFlags.length > 0) {
    console.log(`\nRed Flags (${run.redFlags.length}):`);
    for (const flag of run.redFlags) {
      const sign = flag.pctError >= 0 ? "+" : "";
      console.log(
        `  ${flag.itemName} @ ${flag.chain} (${sign}${pctStr(flag.pctError)})`,
      );
      console.log(
        `    Diagnosis: ${flag.diagnosis} — ${flag.diagnosisDetail}`,
      );
      if (flag.modelReasoning) {
        console.log(
          `    Model said: ${truncate(flag.modelReasoning, 100)}`,
        );
      }
    }
  } else {
    console.log("\nRed Flags: none");
  }

  // Cost
  const perItem =
    run.itemCount > 0 ? run.totalCostUsd / run.itemCount : 0;
  console.log(`\nCost: $${run.totalCostUsd.toFixed(4)} total, $${perItem.toFixed(6)}/item avg`);
  console.log("");
}

// ─── Comparison Matrix ──────────────────────────────────────────────────────

export function printComparisonMatrix(runs: EvalRun[]): void {
  if (runs.length === 0) return;

  console.log("\nCOMPARISON MATRIX:");
  console.log(
    `  ${pad("Case", 22)} ${pad("Model", 22)} ${pad("Prompt", 14)} ${rpad("MdAPE", 8)} ${rpad("Red Flags", 11)} ${rpad("Cost", 10)}`,
  );
  console.log(`  ${"-".repeat(87)}`);

  for (const run of runs) {
    const modelShort = run.model;
    console.log(
      `  ${pad(run.caseName, 22)} ${pad(modelShort, 22)} ${pad(run.promptVariant, 14)} ${rpad(pctStr(run.aggregate.calories.medianAbsPctError), 8)} ${rpad(String(run.redFlags.length), 11)} ${rpad("$" + run.totalCostUsd.toFixed(3), 10)}`,
    );
  }

  // Find best: lowest MdAPE + fewest red flags (simple: sort by MdAPE then red flags)
  const sorted = [...runs].sort((a, b) => {
    const mdapeA = a.aggregate.calories.medianAbsPctError;
    const mdapeB = b.aggregate.calories.medianAbsPctError;
    if (mdapeA !== mdapeB) return mdapeA - mdapeB;
    return a.redFlags.length - b.redFlags.length;
  });
  const best = sorted[0]!;
  console.log(
    `BEST: ${best.caseName} (MdAPE ${pctStr(best.aggregate.calories.medianAbsPctError)}, ${best.redFlags.length} red flags)`,
  );
  console.log("");
}

// ─── Permutations ───────────────────────────────────────────────────────────

export function printPermutations(models: string[], prompts: string[]): void {
  console.log("\nModel × Prompt Permutation Matrix:");
  console.log(`  ${pad("", 22)} ${prompts.map((p) => pad(p, 16)).join("")}`);
  console.log(`  ${"-".repeat(22 + prompts.length * 16)}`);
  for (const model of models) {
    const cells = prompts.map((prompt) => {
      const name = `${model.split("-").pop() ?? model}-${prompt}`;
      return pad(name, 16);
    });
    console.log(`  ${pad(model, 22)} ${cells.join("")}`);
  }
  console.log("");
}

// ─── Case List ──────────────────────────────────────────────────────────────

export function printCaseList(cases: EvalCase[], fixtureCount: number): void {
  console.log(`\nConfigured Eval Cases (${cases.length} cases, ${fixtureCount} fixtures):\n`);

  const avgInput = COST_CONFIG.estimates.avgTokensPerItem.input;
  const avgOutput = COST_CONFIG.estimates.avgTokensPerItem.output;

  console.log(
    `  ${pad("Case", 24)} ${pad("Model", 22)} ${pad("Prompt", 16)} ${rpad("Est. Cost", 10)}`,
  );
  console.log(`  ${"-".repeat(72)}`);

  for (const c of cases) {
    const pricing = COST_CONFIG.models[c.model] ?? COST_CONFIG.models["local"]!;
    const perItem =
      avgInput * pricing!.input + avgOutput * pricing!.output;
    const totalEst = perItem * fixtureCount;
    console.log(
      `  ${pad(c.name, 24)} ${pad(c.model, 22)} ${pad(c.prompt, 16)} ${rpad("$" + totalEst.toFixed(4), 10)}`,
    );
  }
  console.log("");
}

// ─── Save Result ────────────────────────────────────────────────────────────

export function saveRunResult(run: EvalRun): void {
  const ts = formatTimestamp();
  const filename = `${ts}-${run.caseName}.json`;
  const resultsDir = path.join(__dirname, "..", "results");

  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const filePath = path.join(resultsDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(run, null, 2), "utf-8");
  console.log(`Result saved: ${filePath}`);
}
