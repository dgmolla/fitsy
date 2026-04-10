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
  /**
   * If set, post-process the raw model response before extracting macros.
   * Used for decomposition prompts where the model returns components
   * and we apply multipliers in code.
   */
  postProcess?: (raw: Record<string, unknown>) => { cal: number; p: number; c: number; f: number; conf: string };
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

// ─── Option A variants ───────────────────────────────────────────────────────

// Hard multipliers (original — too aggressive)
const multiplierHard: PromptDef = {
  id: "mult-hard",
  label: "Hard multipliers (2.5-3x)",
  description: "Explicit numerical multipliers — too aggressive based on prior results",
  buildMessages(item) {
    return {
      system: `You are a nutrition expert estimating macros for a RESTAURANT menu item.

CRITICAL: Restaurant portions are much larger than home cooking or USDA standard servings. Apply these multipliers when estimating:

RESTAURANT PORTION MULTIPLIERS (vs home recipe):
- Pasta/noodles (cooked): 2.5-3x home portion. A restaurant pasta entree is 300-400g cooked (not 140-200g). This alone is 500-700 cal of carbs.
- Rice (cooked): 2-2.5x. Restaurant rice dish = 300-400g cooked.
- Cooking fat (oil/butter): 3-4x. Restaurants use 2-4 tbsp oil/butter PER DISH that is NEVER listed on the menu. This adds 240-480 cal.
- Cheese: 2-3x. Restaurants are generous with cheese.
- Protein: 1.5-2x. Restaurant protein portions are 170-225g, not 85g.
- Bread/dough: 1.5x.

PRICE SIGNAL: Higher-priced items ($25+) at upscale restaurants tend to use MORE butter/oil/cream (richer, not necessarily bigger).

Return ONLY valid JSON (no markdown fences): { "cal": int, "p": number, "c": number, "f": number, "conf": "HIGH"|"MEDIUM"|"LOW" }`,
      user: `Estimate macros for: "${item["name"]}"${item["price"] ? ` ($${item["price"]})` : ""}${item["section"] ? ` [section: ${item["section"]}]` : ""}`,
    };
  },
};

// ─── Option C: Decompose then apply multipliers in code ──────────────────────

// Per-100g macros for common restaurant components (from USDA)
const COMPONENT_MACROS: Record<string, { cal: number; p: number; c: number; f: number }> = {
  "pasta_cooked":     { cal: 131, p: 5.0, c: 25.0, f: 1.1 },
  "rice_cooked":      { cal: 130, p: 2.7, c: 28.0, f: 0.3 },
  "bread_dough":      { cal: 265, p: 9.0, c: 49.0, f: 3.2 },
  "pizza_dough":      { cal: 266, p: 8.0, c: 50.0, f: 3.0 },
  "chicken":          { cal: 165, p: 31.0, c: 0,    f: 3.6 },
  "beef":             { cal: 250, p: 26.0, c: 0,    f: 15.0 },
  "pork":             { cal: 242, p: 27.0, c: 0,    f: 14.0 },
  "shrimp":           { cal: 99,  p: 24.0, c: 0.2,  f: 0.3 },
  "salmon":           { cal: 208, p: 20.0, c: 0,    f: 13.0 },
  "tofu":             { cal: 76,  p: 8.0,  c: 1.9,  f: 4.8 },
  "egg":              { cal: 155, p: 13.0, c: 1.1,  f: 11.0 },
  "cheese_hard":      { cal: 400, p: 28.0, c: 1.3,  f: 33.0 },
  "cheese_soft":      { cal: 300, p: 21.0, c: 1.0,  f: 24.0 },
  "cream":            { cal: 340, p: 2.0,  c: 3.0,  f: 36.0 },
  "butter":           { cal: 717, p: 0.9,  c: 0.1,  f: 81.0 },
  "olive_oil":        { cal: 884, p: 0,    c: 0,    f: 100.0 },
  "tomato_sauce":     { cal: 29,  p: 1.3,  c: 5.4,  f: 0.4 },
  "pesto":            { cal: 387, p: 6.0,  c: 6.0,  f: 38.0 },
  "vegetables":       { cal: 35,  p: 2.0,  c: 7.0,  f: 0.3 },
  "potato":           { cal: 77,  p: 2.0,  c: 17.0, f: 0.1 },
  "beans":            { cal: 127, p: 8.7,  c: 21.0, f: 0.5 },
  "tortilla":         { cal: 312, p: 8.0,  c: 52.0, f: 8.0 },
  "lettuce_greens":   { cal: 15,  p: 1.4,  c: 2.9,  f: 0.2 },
  "nuts":             { cal: 607, p: 20.0, c: 20.0, f: 54.0 },
  "lamb":             { cal: 294, p: 25.0, c: 0,    f: 21.0 },
};

// Restaurant portion multiplier: how much MORE than a "standard" amount
const PORTION_MULTIPLIER = 1.4; // restaurant portions are ~1.4x what the model would estimate

const decompose: PromptDef = {
  id: "decompose",
  label: "Decompose + code multipliers",
  description: "LLM breaks dish into components with gram weights, code applies USDA macros with restaurant portion multiplier",
  buildMessages(item) {
    const componentList = Object.keys(COMPONENT_MACROS).join(", ");
    return {
      system: `You are a culinary expert. Break down a restaurant dish into its components with estimated weights in grams.

For each component, estimate the RESTAURANT portion weight (not home cooking — restaurants serve larger portions).

Available component types: ${componentList}

Return ONLY valid JSON (no markdown fences):
{
  "components": [
    { "type": "<component_type>", "grams": <number> },
    ...
  ],
  "conf": "HIGH"|"MEDIUM"|"LOW"
}

Include ALL components including cooking fats (butter, olive_oil) that restaurants add but don't list on the menu. Most sauteed/pasta dishes use 20-40g of butter or oil.`,
      user: `Break down this restaurant dish into components with gram weights:\n"${item["name"]}"${item["description"] ? `\nIngredients listed: ${item["description"]}` : ""}${item["price"] ? `\nPrice: $${item["price"]}` : ""}`,
    };
  },
  postProcess(raw: Record<string, unknown>) {
    const components = raw["components"] as Array<{ type: string; grams: number }>;
    const conf = (raw["conf"] as string) || "MEDIUM";

    let cal = 0, p = 0, c = 0, f = 0;

    for (const comp of components) {
      const macros = COMPONENT_MACROS[comp.type];
      if (!macros) continue;
      const factor = (comp.grams / 100) * PORTION_MULTIPLIER;
      cal += macros.cal * factor;
      p += macros.p * factor;
      c += macros.c * factor;
      f += macros.f * factor;
    }

    return {
      cal: Math.round(cal),
      p: Math.round(p * 10) / 10,
      c: Math.round(c * 10) / 10,
      f: Math.round(f * 10) / 10,
      conf,
    };
  },
};

// Same as decompose but without the multiplier — to isolate the multiplier's impact
const decomposeNoMult: PromptDef = {
  id: "decompose-no-mult",
  label: "Decompose, no multiplier",
  description: "Same decomposition but no 1.4x multiplier — tests if LLM already estimates restaurant portions",
  buildMessages: decompose.buildMessages,
  postProcess(raw: Record<string, unknown>) {
    const components = raw["components"] as Array<{ type: string; grams: number }>;
    const conf = (raw["conf"] as string) || "MEDIUM";

    let cal = 0, p = 0, c = 0, f = 0;

    for (const comp of components) {
      const macros = COMPONENT_MACROS[comp.type];
      if (!macros) continue;
      const factor = comp.grams / 100; // no multiplier
      cal += macros.cal * factor;
      p += macros.p * factor;
      c += macros.c * factor;
      f += macros.f * factor;
    }

    return {
      cal: Math.round(cal),
      p: Math.round(p * 10) / 10,
      c: Math.round(c * 10) / 10,
      f: Math.round(f * 10) / 10,
      conf,
    };
  },
};

// ─── Soft nudge — no numbers, just directional guidance ──────────────────────

const softNudge: PromptDef = {
  id: "soft-nudge",
  label: "Soft nudge (no numbers)",
  description: "Gently reminds Haiku that restaurant portions are bigger, especially fats",
  buildMessages(item) {
    return {
      system: `You are a nutrition expert estimating macros for a restaurant menu item.

Keep in mind: restaurant portions are significantly larger than home cooking or standard reference servings. Restaurants are especially generous with cooking fats (butter, oil, cream) — most dishes have considerably more fat than you might initially estimate. Err on the higher side for calories and fat.

Return ONLY valid JSON (no markdown fences): { "cal": int, "p": number, "c": number, "f": number, "conf": "HIGH"|"MEDIUM"|"LOW" }`,
      user: `Estimate macros for: "${item["name"]}"${item["price"] ? ` ($${item["price"]})` : ""}`,
    };
  },
};

// ─── Soft nudge + cuisine context ────────────────────────────────────────────

const softNudgeCuisine: PromptDef = {
  id: "soft-nudge-cuisine",
  label: "Soft nudge + restaurant context",
  description: "Soft nudge plus restaurant name for cuisine/tier inference",
  buildMessages(item) {
    return {
      system: `You are a nutrition expert estimating macros for a restaurant menu item.

Keep in mind: restaurant portions are significantly larger than home cooking or standard reference servings. Restaurants are especially generous with cooking fats (butter, oil, cream) — most dishes have considerably more fat than you might initially estimate.

Italian restaurants finish almost every dish with extra butter/oil. Asian restaurants use generous amounts of cooking oil. American casual restaurants serve the largest portions overall.

Err on the higher side for calories and fat.

Return ONLY valid JSON (no markdown fences): { "cal": int, "p": number, "c": number, "f": number, "conf": "HIGH"|"MEDIUM"|"LOW" }`,
      user: `Restaurant: ${item["restaurant"] || "unknown"}\nItem: "${item["name"]}"${item["price"] ? ` ($${item["price"]})` : ""}`,
    };
  },
};

// ─── Decompose without gram weights ──────────────────────────────────────────

const decomposeNoWeights: PromptDef = {
  id: "decompose-no-weights",
  label: "Decompose (no gram weights)",
  description: "LLM lists components without weights, then estimates total macros holistically",
  buildMessages(item) {
    return {
      system: `You are a nutrition expert. Estimate macros for a restaurant menu item using this process:

Step 1: List the likely components of this dish (including cooking fats that restaurants add but don't list — butter, oil, cream).

Step 2: Considering that this is a RESTAURANT portion (larger than home cooking, generous with fats), estimate the total macros for the complete dish.

Return ONLY valid JSON (no markdown fences):
{
  "components": ["component1", "component2", ...],
  "cal": int, "p": number, "c": number, "f": number,
  "conf": "HIGH"|"MEDIUM"|"LOW"
}`,
      user: `Estimate macros for: "${item["name"]}"${item["price"] ? ` ($${item["price"]})` : ""}${item["restaurant"] ? ` from ${item["restaurant"]}` : ""}`,
    };
  },
};

// ─── Softer deterministic multiplier (1.15x) ─────────────────────────────────

const decomposeGentleMult: PromptDef = {
  id: "decompose-gentle",
  label: "Decompose + gentle 1.15x mult",
  description: "Decomposition with a gentle 1.15x multiplier instead of 1.4x",
  buildMessages: decompose.buildMessages,
  postProcess(raw: Record<string, unknown>) {
    const components = raw["components"] as Array<{ type: string; grams: number }>;
    const conf = (raw["conf"] as string) || "MEDIUM";
    const GENTLE_MULT = 1.15;

    let cal = 0, p = 0, c = 0, f = 0;
    for (const comp of components) {
      const macros = COMPONENT_MACROS[comp.type];
      if (!macros) continue;
      const factor = (comp.grams / 100) * GENTLE_MULT;
      cal += macros.cal * factor;
      p += macros.p * factor;
      c += macros.c * factor;
      f += macros.f * factor;
    }

    return {
      cal: Math.round(cal),
      p: Math.round(p * 10) / 10,
      c: Math.round(c * 10) / 10,
      f: Math.round(f * 10) / 10,
      conf,
    };
  },
};

// ─── Ensemble: average name-only + decompose-no-mult ─────────────────────────

const ensemble: PromptDef = {
  id: "ensemble",
  label: "Ensemble (avg name-only + decompose)",
  description: "Runs two calls — holistic name-only + decomposition — and averages the results",
  // Special flag: handled in runner
  buildMessages(item) {
    // Uses name-only prompt (the decompose call is handled separately in the runner)
    return nameOnly.buildMessages(item);
  },
};

// ─── Decompose WITHOUT the hidden fats instruction ───────────────────────────

const decomposeClean: PromptDef = {
  id: "decompose-clean",
  label: "Decompose (no fat instruction, no mult)",
  description: "Decomposition without telling Haiku to add hidden fats — tests if the fat instruction causes overestimate",
  buildMessages(item) {
    const componentList = Object.keys(COMPONENT_MACROS).join(", ");
    return {
      system: `You are a culinary expert. Break down a restaurant dish into its components with estimated weights in grams.

Available component types: ${componentList}

Return ONLY valid JSON (no markdown fences):
{
  "components": [
    { "type": "<component_type>", "grams": <number> },
    ...
  ],
  "conf": "HIGH"|"MEDIUM"|"LOW"
}`,
      user: `Break down this restaurant dish into components with gram weights:\n"${item["name"]}"${item["description"] ? `\nIngredients: ${item["description"]}` : ""}${item["price"] ? `\nPrice: $${item["price"]}` : ""}`,
    };
  },
  postProcess(raw: Record<string, unknown>) {
    const components = raw["components"] as Array<{ type: string; grams: number }>;
    const conf = (raw["conf"] as string) || "MEDIUM";
    let cal = 0, p = 0, c = 0, f = 0;
    for (const comp of components) {
      const macros = COMPONENT_MACROS[comp.type];
      if (!macros) continue;
      const factor = comp.grams / 100;
      cal += macros.cal * factor;
      p += macros.p * factor;
      c += macros.c * factor;
      f += macros.f * factor;
    }
    return { cal: Math.round(cal), p: Math.round(p * 10) / 10, c: Math.round(c * 10) / 10, f: Math.round(f * 10) / 10, conf };
  },
};

// ─── Name-only + post-hoc 1.15x multiplier ──────────────────────────────────

const nameOnlyMult: PromptDef = {
  id: "name-only-1.15x",
  label: "Name only + 1.15x post-hoc",
  description: "Name-only prompt with a 1.15x multiplier applied in code after",
  buildMessages: nameOnly.buildMessages,
  postProcess(raw: Record<string, unknown>) {
    const M = 1.15;
    return {
      cal: Math.round((raw["cal"] as number) * M),
      p: Math.round((raw["p"] as number) * M * 10) / 10,
      c: Math.round((raw["c"] as number) * M * 10) / 10,
      f: Math.round((raw["f"] as number) * M * 10) / 10,
      conf: (raw["conf"] as string) || "MEDIUM",
    };
  },
};

const nameOnlyMult12: PromptDef = {
  id: "name-only-1.2x",
  label: "Name only + 1.2x post-hoc",
  description: "Name-only prompt with a 1.2x multiplier applied in code after",
  buildMessages: nameOnly.buildMessages,
  postProcess(raw: Record<string, unknown>) {
    const M = 1.2;
    return {
      cal: Math.round((raw["cal"] as number) * M),
      p: Math.round((raw["p"] as number) * M * 10) / 10,
      c: Math.round((raw["c"] as number) * M * 10) / 10,
      f: Math.round((raw["f"] as number) * M * 10) / 10,
      conf: (raw["conf"] as string) || "MEDIUM",
    };
  },
};

// ─── Macro-specific multipliers ──────────────────────────────────────────────

function macroSpecificPostProcess(
  pMult: number, cMult: number, fMult: number,
): (raw: Record<string, unknown>) => { cal: number; p: number; c: number; f: number; conf: string } {
  return (raw) => {
    const p = (raw["p"] as number) * pMult;
    const c = (raw["c"] as number) * cMult;
    const f = (raw["f"] as number) * fMult;
    // Recalculate calories from adjusted macros
    const cal = p * 4 + c * 4 + f * 9;
    return {
      cal: Math.round(cal),
      p: Math.round(p * 10) / 10,
      c: Math.round(c * 10) / 10,
      f: Math.round(f * 10) / 10,
      conf: (raw["conf"] as string) || "MEDIUM",
    };
  };
}

const fatOnly13: PromptDef = {
  id: "fat-only-1.3x",
  label: "Name only + fat 1.3x (P/C untouched)",
  description: "Only multiply fat by 1.3x, recalculate calories from macros",
  buildMessages: nameOnly.buildMessages,
  postProcess: macroSpecificPostProcess(1.0, 1.0, 1.3),
};

const carbFat: PromptDef = {
  id: "carb-fat-mult",
  label: "Name only + C 1.08x + F 1.3x",
  description: "Multiply carbs 1.08x, fat 1.3x, protein untouched",
  buildMessages: nameOnly.buildMessages,
  postProcess: macroSpecificPostProcess(1.0, 1.08, 1.3),
};

const fatOnly125: PromptDef = {
  id: "fat-only-1.25x",
  label: "Name only + fat 1.25x",
  description: "Gentler fat multiplier",
  buildMessages: nameOnly.buildMessages,
  postProcess: macroSpecificPostProcess(1.0, 1.0, 1.25),
};

const fatOnly135: PromptDef = {
  id: "fat-only-1.35x",
  label: "Name only + fat 1.35x",
  description: "Slightly more aggressive fat multiplier",
  buildMessages: nameOnly.buildMessages,
  postProcess: macroSpecificPostProcess(1.0, 1.0, 1.35),
};

// ─── Registry ────────────────────────────────────────────────────────────────

export const PROMPTS: PromptDef[] = [
  nameOnly,
  nameOnlyMult,
  nameOnlyMult12,
  fatOnly125,
  fatOnly13,
  fatOnly135,
  carbFat,
];

export const PROMPT_MAP = new Map(PROMPTS.map((p) => [p.id, p]));
