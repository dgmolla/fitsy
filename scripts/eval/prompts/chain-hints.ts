import type { PromptVariant } from "../lib/types";

const SYSTEM_PROMPT = `You are a nutrition expert. Estimate the macronutrient content for the given menu item.

Return ONLY valid JSON (no markdown fences, no explanation) with these exact fields:
- cal: calories (integer)
- p: protein in grams (number)
- c: carbohydrates in grams (number)
- f: fat in grams (number)
- conf: confidence level (string: "HIGH", "MEDIUM", or "LOW")
- reasoning: brief explanation of your estimate (string)`;

export const chainHints: PromptVariant = {
  name: "chain-hints",
  description: "Baseline system prompt with chain-specific context in the user message",
  buildMessages(item) {
    return {
      system: SYSTEM_PROMPT,
      userMessage: `Dish: ${item.itemName}\nRestaurant: ${item.chain}\n\nThis is a menu item from ${item.chain}, a major chain restaurant. This chain publishes official nutrition data. Use your knowledge of this chain's standard menu items, portion sizes, and preparation methods for your estimate.`,
    };
  },
};
