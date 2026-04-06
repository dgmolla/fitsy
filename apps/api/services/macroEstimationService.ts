/**
 * Macro Estimation Service
 *
 * Accepts already-structured menu items and uses Claude Haiku to estimate
 * macronutrient data for each item. Decoupled from raw markdown extraction —
 * callers are responsible for providing structured items.
 *
 * Input:  StructuredMenuItem[]       (name, description, price, section)
 * Output: (MacroData | null)[]       (one entry per input item, same order)
 *
 * null entries indicate Haiku returned an invalid or unparseable estimate
 * for that item. Callers must handle nulls — do not assume all items succeed.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MacroData, StructuredMenuItem } from "./menuSources/types";

// ─── Internal types ────────────────────────────────────────────────────────────

/** The shape Haiku returns per item. */
interface HaikuEstimate {
  cal: number;
  p: number;
  c: number;
  f: number;
  conf: "HIGH" | "MEDIUM" | "LOW";
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const HAIKU_MODEL = "claude-haiku-4-5" as const;
const MAX_TOKENS = 8192;

const SYSTEM_PROMPT = `You are a nutrition expert. You will receive a JSON array of restaurant menu items that have already been identified. For each item, estimate its macronutrient content.

Return ONLY valid JSON (no markdown fences, no explanation) as an array of objects in the SAME ORDER as the input, with these exact fields:
- cal: calories (integer)
- p: protein in grams (number)
- c: carbohydrates in grams (number)
- f: fat in grams (number)
- conf: confidence level (string: "HIGH", "MEDIUM", or "LOW")

Confidence levels:
- HIGH: known chain item or clear description with specific ingredients
- MEDIUM: typical restaurant item with reasonable description
- LOW: vague name, no description, or unusual item

The output array must have exactly the same number of elements as the input array, in the same order.`;

// ─── Singleton client ──────────────────────────────────────────────────────────

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic();
  }
  return _client;
}

// ─── Main export ───────────────────────────────────────────────────────────────

/**
 * Estimates macros for a list of structured menu items using Claude Haiku.
 *
 * Returns one entry per input item in the same order. Entries are null when
 * Haiku returned an invalid or missing estimate for that position — callers
 * must handle nulls rather than assuming all items succeed.
 *
 * Throws if the API call fails or the top-level response cannot be parsed.
 *
 * @param systemPrompt - Optional override for the system prompt. Defaults to
 *   SYSTEM_PROMPT. Pass a custom prompt to test different estimation strategies
 *   in evals without touching the production default.
 */
export async function estimateMacros(
  items: StructuredMenuItem[],
  client?: Anthropic,
  systemPrompt?: string,
): Promise<(MacroData | null)[]> {
  if (items.length === 0) {
    return [];
  }

  const anthropic = client ?? getClient();

  // Build a compact JSON payload — include only fields Haiku needs for estimation
  const payload = items.map((item) => ({
    name: item.name,
    ...(item.description !== undefined ? { description: item.description } : {}),
    ...(item.price !== undefined ? { price: item.price } : {}),
    ...(item.section !== undefined ? { section: item.section } : {}),
  }));

  const userMessage = `Estimate macros for these ${items.length} menu item(s):\n${JSON.stringify(payload, null, 2)}`;

  const message = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt ?? SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const contentBlock = message.content[0];
  if (!contentBlock || contentBlock.type !== "text") {
    throw new Error("macroEstimationService: unexpected Haiku response type");
  }

  const raw = contentBlock.text.trim();
  // Strip markdown fences if model wraps response despite instructions
  const text = raw
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```\s*$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`macroEstimationService: failed to parse Haiku response: ${text}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("macroEstimationService: Haiku response is not an array");
  }

  if (parsed.length !== items.length) {
    throw new Error(
      `macroEstimationService: Haiku returned ${parsed.length} items for ${items.length} inputs`,
    );
  }

  // Preserve positional contract: one entry per input item, null for invalid estimates
  return parsed.map((item: unknown): MacroData | null => {
    if (
      item === null ||
      typeof item !== "object" ||
      !("cal" in item) ||
      !("p" in item) ||
      !("c" in item) ||
      !("f" in item) ||
      !("conf" in item)
    ) {
      return null;
    }

    const est = item as HaikuEstimate;

    if (
      typeof est.cal !== "number" ||
      typeof est.p !== "number" ||
      typeof est.c !== "number" ||
      typeof est.f !== "number" ||
      !["HIGH", "MEDIUM", "LOW"].includes(est.conf)
    ) {
      return null;
    }

    return {
      calories: est.cal,
      proteinG: est.p,
      carbsG: est.c,
      fatG: est.f,
      confidence: est.conf,
      source: "haiku",
    };
  });
}
