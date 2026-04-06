export interface EvalCase {
  name: string;
  model: string;
  prompt: string;
  tags?: string[];
}

export interface GroundTruthItem {
  id: string;
  chain: string;
  itemName: string;
  description?: string;
  category?: string;
  servingSize?: string;
  source: string;
  officialMacros: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
  tags?: string[];
}

export interface PromptVariant {
  name: string;
  description: string;
  buildMessages(item: GroundTruthItem): {
    system: string;
    userMessage: string;
  };
}

export interface MacroEstimateResult {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasoning?: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number;
}

export interface ModelAdapter {
  name: string;
  estimate(system: string, userMessage: string): Promise<MacroEstimateResult>;
}

export type RedFlagDiagnosis =
  | "SERVING_TYPE"
  | "SERVING_SIZE"
  | "PORTION_COUNT"
  | "MACRO_RATIO"
  | "UNKNOWN";

export interface EvalItemResult {
  groundTruth: GroundTruthItem;
  estimated: MacroEstimateResult;
  errors: {
    calories: { absolute: number; pct: number; signed: number };
    proteinG: { absolute: number; pct: number; signed: number };
    carbsG: { absolute: number; pct: number; signed: number };
    fatG: { absolute: number; pct: number; signed: number };
  };
}

export interface RedFlagItem {
  id: string;
  chain: string;
  itemName: string;
  officialCalories: number;
  estimatedCalories: number;
  pctError: number;
  diagnosis: RedFlagDiagnosis;
  diagnosisDetail: string;
  modelReasoning?: string;
}

export interface MacroAggregateMetrics {
  medianAbsPctError: number;
  meanAbsPctError: number;
  p90AbsPctError: number;
  medianSignedPctError: number;
}

export interface ConfidenceCalibration {
  confidence: "HIGH" | "MEDIUM" | "LOW";
  count: number;
  medianCalError: number;
}

export interface ChainBreakdown {
  chain: string;
  count: number;
  medianCalError: number;
}

export interface EvalRun {
  caseName: string;
  model: string;
  promptVariant: string;
  timestamp: string;
  itemCount: number;
  aggregate: {
    calories: MacroAggregateMetrics;
    proteinG: MacroAggregateMetrics;
    carbsG: MacroAggregateMetrics;
    fatG: MacroAggregateMetrics;
  };
  confidenceCalibration: ConfidenceCalibration[];
  perChain: ChainBreakdown[];
  redFlags: RedFlagItem[];
  totalCostUsd: number;
  totalLatencyMs: number;
  items: EvalItemResult[];
}

export interface CostLogEntry {
  date: string;
  caseName: string;
  model: string;
  prompt: string;
  items: number;
  costUsd: number;
}
