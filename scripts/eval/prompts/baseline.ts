import type { PromptVariant } from "../lib/types";

const SYSTEM_PROMPT = `You are a nutrition expert. Estimate the macronutrient content for the given menu item.

Return ONLY valid JSON (no markdown fences, no explanation) with these exact fields:
- cal: calories (integer)
- p: protein in grams (number)
- c: carbohydrates in grams (number)
- f: fat in grams (number)
- conf: confidence level (string: "HIGH", "MEDIUM", or "LOW")
- reasoning: brief explanation of your estimate (string)`;

export const baseline: PromptVariant = {
  name: "baseline",
  description: "Simple single-item macro estimation prompt",
  buildMessages(item) {
    return {
      system: SYSTEM_PROMPT,
      userMessage: `Dish: ${item.itemName}\nRestaurant: ${item.chain}`,
    };
  },
};
