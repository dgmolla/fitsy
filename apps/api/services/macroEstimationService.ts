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
  /**
   * Echo of the input item name. Requested so results can be matched back to
   * inputs by identity instead of array position — see reconcile() below.
   * Optional so that a response from an older prompt still parses.
   */
  name?: string;
  cal: number;
  p: number;
  c: number;
  f: number;
  conf: "HIGH" | "MEDIUM" | "LOW";
  tags?: string[]; // optional — Haiku may omit if not following prompt exactly
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const HAIKU_MODEL = "claude-haiku-4-5" as const;
const MAX_TOKENS = 8192;

const VALID_TAGS = new Set(["vegan", "vegetarian", "gluten-free", "keto", "dairy-free"]);

const SYSTEM_PROMPT = `You are a nutrition expert. You will receive a JSON array of restaurant menu items that have already been identified. For each item, estimate its macronutrient content and dietary tags.

Return ONLY valid JSON (no markdown fences, no explanation) as an array of objects in the SAME ORDER as the input, with these exact fields:
- name: the item name, copied EXACTLY from the input
- cal: calories (integer)
- p: protein in grams (number)
- c: carbohydrates in grams (number)
- f: fat in grams (number)
- conf: confidence level (string: "HIGH", "MEDIUM", or "LOW")
- tags: array of applicable dietary tags (strings). Only include tags from this list: "vegan", "vegetarian", "gluten-free", "keto", "dairy-free". Use an empty array if none apply or you are unsure.

Confidence levels:
- HIGH: known chain item or clear description with specific ingredients
- MEDIUM: typical restaurant item with reasonable description
- LOW: vague name, no description, or unusual item

The output array must have exactly the same number of elements as the input array, in the same order.`;

// ─── Response hardening ────────────────────────────────────────────────────────

/**
 * C0 control characters are illegal in JSON outside string literals, and models
 * occasionally emit one — a single stray 0x08 (backspace) in an otherwise
 * well-formed 46-object array was observed killing a whole 100-item menu, since
 * JSON.parse throws and the caller loses every item in the batch.
 *
 * Tab / newline / carriage return are left alone: they are legal as whitespace
 * between tokens, and JSON.parse rejects them inside strings anyway, so
 * stripping them would mask a genuinely malformed response.
 */
export function stripControlChars(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

/**
 * Maps model output back onto the input items.
 *
 * The model is asked to echo each item's name. When it does, we match on that
 * name rather than array position, because position is not a reliable contract:
 * on 50-item batches the model returns the wrong number of objects ~15% of the
 * time (measured on claude-haiku-4-5 over 2,708 items; other models are worse).
 * Under positional matching a single dropped or duplicated entry silently
 * shifts every subsequent item's macros onto the wrong dish, with nothing able
 * to detect it. Nutrition data is a documented Danger Zone — a null is
 * recoverable, macros attached to the wrong food are not.
 *
 * Falls back to positional matching when the response carries no names at all,
 * so an older prompt or a model that ignores the field still works as before.
 *
 * @returns entries aligned to `items`, plus how the alignment was achieved.
 */
export function reconcile(
  items: StructuredMenuItem[],
  parsed: unknown[],
): { aligned: (unknown | null)[]; strategy: "name" | "position"; unmatched: number } {
  const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

  const named = parsed.filter(
    (p): p is Record<string, unknown> =>
      p !== null && typeof p === "object" && typeof (p as Record<string, unknown>)["name"] === "string",
  );

  // Require most of the response to carry names before trusting name matching;
  // a handful of stray name fields is not a reliable index.
  if (named.length < parsed.length * 0.8 || named.length === 0) {
    return {
      aligned: Array.from({ length: items.length }, (_, i) => parsed[i] ?? null),
      strategy: "position",
      unmatched: 0,
    };
  }

  const byName = new Map<string, unknown>();
  for (const p of named) {
    const key = norm(String(p["name"]));
    // First write wins: if the model duplicated a name, prefer its first answer
    // rather than letting a later duplicate overwrite a correct earlier one.
    if (!byName.has(key)) byName.set(key, p);
  }

  let unmatched = 0;
  const aligned = items.map((item) => {
    const hit = byName.get(norm(item.name));
    if (hit === undefined) {
      unmatched++;
      return null;
    }
    return hit;
  });

  return { aligned, strategy: "name", unmatched };
}

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
// Maximum items per Haiku call — prevents output truncation on large menus
const CHUNK_SIZE = 50;

export async function estimateMacros(
  items: StructuredMenuItem[],
  client?: Anthropic,
  systemPrompt?: string,
): Promise<(MacroData | null)[]> {
  if (items.length === 0) {
    return [];
  }

  // Chunk large menus to avoid output truncation
  if (items.length > CHUNK_SIZE) {
    const results: (MacroData | null)[] = [];
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      const chunkResults = await estimateMacros(chunk, client, systemPrompt);
      results.push(...chunkResults);
    }
    return results;
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
  // Strip markdown fences if model wraps response despite instructions,
  // then drop stray control characters (see stripControlChars).
  const text = stripControlChars(
    raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, ""),
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`macroEstimationService: failed to parse Haiku response: ${text}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("macroEstimationService: Haiku response is not an array");
  }

  // Count drift is common on full-size batches, so this is expected rather than
  // exceptional — reconcile() is what makes it safe.
  if (parsed.length !== items.length) {
    console.warn(
      `[macroEstimation] Haiku returned ${parsed.length} items for ${items.length} inputs`,
    );
  }

  const { aligned, strategy, unmatched } = reconcile(items, parsed);
  if (strategy === "position" && parsed.length !== items.length) {
    // No usable names AND a count mismatch: entries after the first drift are
    // very likely attributed to the wrong dish, and we cannot tell which.
    console.warn(
      "[macroEstimation] positional fallback on a mismatched batch — alignment is unverified",
    );
  }
  if (unmatched > 0) {
    console.warn(
      `[macroEstimation] ${unmatched}/${items.length} items had no matching name in the response`,
    );
  }

  return aligned.map((item: unknown): MacroData | null => {
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

    const dietaryTags = Array.isArray(est.tags)
      ? est.tags.filter((t): t is string => typeof t === "string" && VALID_TAGS.has(t))
      : [];

    // Post-hoc calibration: Haiku systematically underestimates restaurant
    // portions — especially cooking fats (butter/oil) and carb bases (pasta/rice).
    // Protein is accurate. Multipliers derived from eval-v2 (100-run, 8 indie cases).
    const CARB_MULT = 1.08;
    const FAT_MULT = 1.3;
    const adjCarbs = est.c * CARB_MULT;
    const adjFat = est.f * FAT_MULT;
    const adjCal = est.p * 4 + adjCarbs * 4 + adjFat * 9;

    return {
      calories: Math.round(adjCal),
      proteinG: Math.round(est.p),
      carbsG: Math.round(adjCarbs),
      fatG: Math.round(adjFat),
      confidence: est.conf,
      source: "haiku",
      dietaryTags,
    };
  });
}
