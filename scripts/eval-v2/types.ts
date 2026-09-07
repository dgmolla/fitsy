/**
 * Shared result shapes for the eval-v2 runner and reporter.
 * Lives here so report.ts does not import run.ts (was a circular import,
 * flagged by dependency-cruiser 2026-09-07).
 */

export interface TestCase {
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

export interface CaseResult {
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
