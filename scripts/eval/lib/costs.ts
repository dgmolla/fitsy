import * as fs from "fs";
import * as path from "path";
import { COST_CONFIG } from "../cost-config";
import type { CostLogEntry } from "./types";

const COST_LOG_PATH = path.join(__dirname, "..", "results", "cost-log.jsonl");

export class CostTracker {
  private model: string;
  private totalUsd = 0;

  constructor(model: string) {
    this.model = model;
  }

  track(inputTokens: number, outputTokens: number): void {
    const pricing = this.getModelPricing();
    this.totalUsd += inputTokens * pricing.input + outputTokens * pricing.output;
    this.checkCap();
  }

  getRunningTotal(): number {
    return this.totalUsd;
  }

  checkCap(): void {
    if (this.totalUsd > COST_CONFIG.caps.evalRunMaxUsd) {
      throw new Error("Cost cap exceeded");
    }
    if (this.totalUsd > COST_CONFIG.caps.evalRunWarnUsd) {
      console.warn(
        `[CostTracker] Warning: running total $${this.totalUsd.toFixed(4)} exceeds warn threshold $${COST_CONFIG.caps.evalRunWarnUsd}`,
      );
    }
  }

  getModelPricing(): { input: number; output: number } {
    const exact = COST_CONFIG.models[this.model];
    if (exact) {
      return exact;
    }
    // Fall back to "local" pricing for local models
    const local = COST_CONFIG.models["local"]!;
    return local;
  }

  toLogEntry(caseName: string, promptName: string, itemCount: number): CostLogEntry {
    return {
      date: new Date().toISOString(),
      caseName,
      model: this.model,
      prompt: promptName,
      items: itemCount,
      costUsd: this.totalUsd,
    };
  }
}

export function appendCostLog(entry: CostLogEntry): void {
  const dir = path.dirname(COST_LOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(COST_LOG_PATH, JSON.stringify(entry) + "\n");
}

export function readCostLog(): CostLogEntry[] {
  if (!fs.existsSync(COST_LOG_PATH)) {
    return [];
  }
  const content = fs.readFileSync(COST_LOG_PATH, "utf-8").trim();
  if (!content) {
    return [];
  }
  return content.split("\n").map((line) => JSON.parse(line) as CostLogEntry);
}

export function getMonthlySpend(): number {
  const entries = readCostLog();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  return entries
    .filter((entry) => {
      const d = new Date(entry.date);
      return d.getFullYear() === year && d.getMonth() === month;
    })
    .reduce((sum, entry) => sum + entry.costUsd, 0);
}
