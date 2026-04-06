import type { PromptVariant } from "../lib/types";

const SYSTEM_PROMPT = `You are a nutrition expert. Estimate the macronutrient content for the given menu item.

Return ONLY valid JSON (no markdown fences, no explanation) with these exact fields:
- cal: calories (integer)
- p: protein in grams (number)
- c: carbohydrates in grams (number)
- f: fat in grams (number)
- conf: confidence level (string: "HIGH", "MEDIUM", or "LOW")
- reasoning: brief explanation of your estimate (string)

IMPORTANT: Pay close attention to serving size. Consider:
- A "spread" or "sauce" is a small condiment packet, not a full dish
- "Pocket" sandwiches (like at Starbucks) are small items (~150-200g), not full wraps
- For countable items (nuggets, wings, tacos), estimate for the standard count specified in the item name
- A single cookie is one cookie, not a box
- Drinks should be estimated for the size specified (small, medium, grande, etc.)
Always match your estimate to what the restaurant actually serves as one order of this item.`;

export const servingSize: PromptVariant = {
  name: "serving-size",
  description: "Baseline prompt with additional serving size awareness instructions",
  buildMessages(item) {
    return {
      system: SYSTEM_PROMPT,
      userMessage: `Dish: ${item.itemName}\nRestaurant: ${item.chain}`,
    };
  },
};
