/**
 * Eval V2 — Prompt variants to test against indie restaurant items.
 *
 * Each prompt receives a single item and returns a single JSON object.
 * The `buildMessages` function receives the full case (any fields) and
 * decides what to include in the user message.
 */

export interface PromptDef {
  id: string;
  label: string;
  description: string;
  /** If true, include the item's imageUrl in the API call (vision model required) */
  useImage?: boolean;
  /** If set, override the model for this prompt (e.g. "claude-sonnet-4-5") */
  modelOverride?: string;
  /** If set, run a two-pass estimation (first pass returns reasoning, second pass returns macros) */
  twoPass?: boolean;
  buildMessages(item: Record<string, unknown>): {
    system: string;
    user: string;
  };
}

// ─── Helper: format item fields into a compact JSON block ────────────────────

function itemPayload(
  item: Record<string, unknown>,
  fields: string[] = ["name", "description", "price", "section"],
): string {
  const obj: Record<string, unknown> = {};
  for (const f of fields) {
    if (item[f] !== undefined) obj[f] = item[f];
  }
  return JSON.stringify(obj, null, 2);
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const production: PromptDef = {
  id: "production",
  label: "Production (current)",
  description: "Matches the current macroEstimationService.ts system prompt exactly",
  buildMessages(item) {
    return {
      system: `You are a nutrition expert. You will receive a JSON array of restaurant menu items that have already been identified. For each item, estimate its macronutrient content and dietary tags.

Return ONLY valid JSON (no markdown fences, no explanation) as an array of objects in the SAME ORDER as the input, with these exact fields:
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

The output array must have exactly the same number of elements as the input array, in the same order.`,
      user: `Estimate macros for these 1 menu item(s):\n[${itemPayload(item)}]`,
    };
  },
};

const nameAware: PromptDef = {
  id: "name-aware",
  label: "Name-aware base dish",
  description: "Explicitly tells the model to infer the base dish from the item name",
  buildMessages(item) {
    return {
      system: `You are a nutrition expert estimating macros for restaurant menu items.

IMPORTANT: Restaurant menu descriptions list FEATURED INGREDIENTS (toppings, garnishes, sauces) — NOT the full dish. The base dish (pasta, rice, bread, tortilla) and cooking fats (oil, butter, cream) are almost never listed but dominate the macros.

Use the item NAME to identify the base dish type:
- "tagliatelle", "penne", "spaghetti" → pasta (60-100g carbs for a restaurant portion)
- "burger" → bun + patty (40-60g carbs from bun alone)
- "salad" → greens base (low carb, but dressing adds 15-30g fat)
- "rice bowl" → rice base (60-80g carbs)
- "sandwich", "wrap" → bread/tortilla base

Then ADD the macros from the listed ingredients on top.

For a restaurant entree ($18-35), assume a generous portion (1.5-2x home cooking).

Return ONLY valid JSON (no markdown fences): { "cal": int, "p": number, "c": number, "f": number, "conf": "HIGH"|"MEDIUM"|"LOW" }`,
      user: `Estimate macros for this restaurant menu item:\n${itemPayload(item)}`,
    };
  },
};

const pricePortionAware: PromptDef = {
  id: "price-portion",
  label: "Price → portion inference",
  description: "Uses price to infer portion size and restaurant tier",
  buildMessages(item) {
    return {
      system: `You are a nutrition expert estimating macros for restaurant menu items.

Key rules:
1. The "description" field lists FEATURED INGREDIENTS only — not the full dish. Identify the BASE DISH from the item name (e.g. "tagliatelle" = pasta, "burger" = bun + patty).
2. Use PRICE to infer portion size:
   - $8-14: casual/fast-casual, standard portions
   - $15-22: mid-range restaurant, generous portions (1.5x standard)
   - $23-35: upscale casual, large/rich portions (1.5-2x standard, more butter/oil/cream)
   - $36+: fine dining, may be smaller artistic portions
3. Cooking fats are NEVER listed but always present: pasta dishes use olive oil/butter (add 15-30g fat), grilled items use oil (add 10-15g fat).

Return ONLY valid JSON (no markdown fences): { "cal": int, "p": number, "c": number, "f": number, "conf": "HIGH"|"MEDIUM"|"LOW" }`,
      user: `Estimate macros for this restaurant menu item:\n${itemPayload(item)}`,
    };
  },
};

const fewShot: PromptDef = {
  id: "few-shot",
  label: "Few-shot examples",
  description: "Includes worked examples of similar indie restaurant items",
  buildMessages(item) {
    return {
      system: `You are a nutrition expert estimating macros for restaurant menu items.

Restaurant descriptions list featured ingredients, NOT the full dish. The base (pasta, bread, rice) and cooking fats (oil, butter) are implied by the item name.

Here are correctly estimated examples:

Example 1:
Input: { "name": "Mushroom Truffle Rigatoni", "description": "wild mushrooms, truffle cream, parmesan", "price": 24, "section": "Pasta" }
Output: { "cal": 880, "p": 24, "c": 92, "f": 46, "conf": "MEDIUM" }
Why: rigatoni = pasta base (~80g carbs), truffle cream = heavy fat, restaurant portion.

Example 2:
Input: { "name": "Grilled Salmon Bowl", "description": "avocado, pickled onion, furikake, citrus ponzu", "price": 22, "section": "Bowls" }
Output: { "cal": 720, "p": 42, "c": 65, "f": 32, "conf": "MEDIUM" }
Why: bowl = rice base (~60g carbs), salmon = protein, avocado = fat.

Example 3:
Input: { "name": "Crispy Chicken Sandwich", "description": "pickles, slaw, spicy aioli", "price": 16, "section": "Sandwiches" }
Output: { "cal": 780, "p": 35, "c": 58, "f": 42, "conf": "MEDIUM" }
Why: sandwich = bun (~40g carbs), fried chicken = protein + fat, aioli = fat.

Now estimate this item. Return ONLY valid JSON (no markdown fences): { "cal": int, "p": number, "c": number, "f": number, "conf": "HIGH"|"MEDIUM"|"LOW" }`,
      user: `${itemPayload(item)}`,
    };
  },
};

const nameOnly: PromptDef = {
  id: "name-only",
  label: "Name only (no description)",
  description: "Passes only the item name — tests if description hurts more than it helps",
  buildMessages(item) {
    return {
      system: `You are a nutrition expert. Estimate macros for a restaurant menu item based on its name. Assume a typical restaurant portion.

Return ONLY valid JSON (no markdown fences): { "cal": int, "p": number, "c": number, "f": number, "conf": "HIGH"|"MEDIUM"|"LOW" }`,
      user: `Estimate macros for: "${item["name"]}"${item["price"] ? ` ($${item["price"]})` : ""}`,
    };
  },
};

const withImage: PromptDef = {
  id: "with-image",
  label: "Name + image (vision)",
  description: "Sends the dish photo alongside the name. Tests if visual portion cues help.",
  useImage: true,
  buildMessages(item) {
    return {
      system: `You are a nutrition expert. You will see a photo of a restaurant dish along with its menu listing. Use the PHOTO to judge portion size, ingredient density, and cooking method. The photo is the most reliable signal for portion estimation.

Return ONLY valid JSON (no markdown fences): { "cal": int, "p": number, "c": number, "f": number, "conf": "HIGH"|"MEDIUM"|"LOW" }`,
      user: `Estimate macros for this restaurant dish:\n${itemPayload(item)}`,
    };
  },
};

const twoPass: PromptDef = {
  id: "two-pass",
  label: "Two-pass (reason then estimate)",
  description: "First identifies the dish type and portion, then estimates macros.",
  twoPass: true,
  buildMessages(item) {
    return {
      system: `You are a nutrition expert. First, analyze the dish in detail, then estimate macros.

Step 1 - ANALYZE (think out loud):
- What is the base dish? (pasta, rice, bread, etc.)
- What is a typical restaurant portion for this base?
- What cooking fats are implied but not listed? (oil, butter, cream)
- What price tier is this? What does that imply about portion size?

Step 2 - ESTIMATE:
Based on your analysis, provide the macro estimate.

Return your response as JSON with TWO fields:
{ "analysis": "your reasoning here", "estimate": { "cal": int, "p": number, "c": number, "f": number, "conf": "HIGH"|"MEDIUM"|"LOW" } }`,
      user: `Analyze and estimate macros for this restaurant dish:\n${itemPayload(item)}`,
    };
  },
};

const sonnetNameOnly: PromptDef = {
  id: "sonnet-name-only",
  label: "Sonnet + name only",
  description: "Uses the more capable Sonnet model with just the item name.",
  modelOverride: "claude-sonnet-4-5",
  buildMessages(item) {
    return {
      system: `You are a nutrition expert. Estimate macros for a restaurant menu item based on its name. Assume a typical restaurant portion.

Return ONLY valid JSON (no markdown fences): { "cal": int, "p": number, "c": number, "f": number, "conf": "HIGH"|"MEDIUM"|"LOW" }`,
      user: `Estimate macros for: "${item["name"]}"${item["price"] ? ` ($${item["price"]})` : ""}`,
    };
  },
};

const sonnetWithImage: PromptDef = {
  id: "sonnet-image",
  label: "Sonnet + name + image",
  description: "Sonnet with dish photo for best possible accuracy.",
  useImage: true,
  modelOverride: "claude-sonnet-4-5",
  buildMessages(item) {
    return {
      system: `You are a nutrition expert. You will see a photo of a restaurant dish along with its menu listing. Use the PHOTO to judge portion size, ingredient density, and cooking method.

Return ONLY valid JSON (no markdown fences): { "cal": int, "p": number, "c": number, "f": number, "conf": "HIGH"|"MEDIUM"|"LOW" }`,
      user: `Estimate macros for this restaurant dish:\n${itemPayload(item)}`,
    };
  },
};

// ─── Registry ────────────────────────────────────────────────────────────────

export const PROMPTS: PromptDef[] = [
  production,
  nameAware,
  pricePortionAware,
  fewShot,
  nameOnly,
  withImage,
  twoPass,
  sonnetNameOnly,
  sonnetWithImage,
];

export const PROMPT_MAP = new Map(PROMPTS.map((p) => [p.id, p]));
