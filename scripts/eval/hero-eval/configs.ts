/**
 * Named eval configurations for the hero eval.
 *
 * Each config is a (strategy × promptId) pair.
 * Strategy controls how StructuredMenuItems are built from ground truth;
 * promptId selects which system prompt Haiku receives.
 *
 * Usage (run.ts CLI):
 *   --config name-only-default          run one config
 *   --config name-only-default,ue-jsonld-default  run two and compare
 *   (no flag)                           run all configs and compare
 *   --list                              print available config ids
 */

import type { PromptId } from "./prompts.js";

export type Strategy = "name-only" | "ue-markdown";

export interface EvalConfig {
  /** Unique id used in --config CLI flag and JSON output. */
  id: string;
  /** Human-readable label shown in reports. */
  label: string;
  /**
   * How to build the StructuredMenuItem fed to Haiku:
   *   name-only   – { name, section: chainName }  (no UE scraping)
   *   ue-markdown – Firecrawl → UE Markdown → item name + calories extracted
   *                 Falls back to name-only if scrape fails or no items found.
   *                 When matched, UE calories are used directly (not estimated).
   */
  strategy: Strategy;
  /** Which system prompt to send to Haiku (key in PROMPTS). */
  promptId: PromptId;
}

export const CONFIGS: EvalConfig[] = [
  // ── Baseline ──────────────────────────────────────────────────────────────
  {
    id: "name-only-default",
    label: "Name-only + default prompt (baseline)",
    strategy: "name-only",
    promptId: "default",
  },

  // ── UE Markdown × prompt variants ─────────────────────────────────────────
  {
    id: "ue-markdown-default",
    label: "UE Markdown + default prompt",
    strategy: "ue-markdown",
    promptId: "default",
  },
  {
    id: "ue-markdown-description-focus",
    label: "UE Markdown + description-focus prompt",
    strategy: "ue-markdown",
    promptId: "description-focus",
  },

  // ── Few-shot ──────────────────────────────────────────────────────────────
  {
    id: "name-only-few-shot",
    label: "Name-only + few-shot prompt",
    strategy: "name-only",
    promptId: "few-shot",
  },
  {
    id: "ue-markdown-few-shot",
    label: "UE Markdown + few-shot prompt",
    strategy: "ue-markdown",
    promptId: "few-shot",
  },

  // ── Serving-size-aware ────────────────────────────────────────────────────
  {
    id: "name-only-serving-size-aware",
    label: "Name-only + serving-size-aware prompt",
    strategy: "name-only",
    promptId: "serving-size-aware",
  },
  {
    id: "ue-markdown-serving-size-aware",
    label: "UE Markdown + serving-size-aware prompt",
    strategy: "ue-markdown",
    promptId: "serving-size-aware",
  },

  // ── Conservative ──────────────────────────────────────────────────────────
  {
    id: "name-only-conservative",
    label: "Name-only + conservative prompt",
    strategy: "name-only",
    promptId: "conservative",
  },
  {
    id: "ue-markdown-conservative",
    label: "UE Markdown + conservative prompt",
    strategy: "ue-markdown",
    promptId: "conservative",
  },
];

export const CONFIG_MAP = new Map<string, EvalConfig>(
  CONFIGS.map((c) => [c.id, c]),
);
