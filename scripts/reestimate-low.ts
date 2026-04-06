/**
 * Re-estimate macro nutrition data for MacroEstimate records with LOW confidence.
 *
 * Usage:
 *   set -a && source .env.local && set +a && npx tsx scripts/reestimate-low.ts
 */

import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";

const prisma = new PrismaClient();
const anthropic = new Anthropic({
  apiKey: process.env["ANTHROPIC_API_KEY"],
});

interface MacroResult {
  cal: number;
  p: number;
  c: number;
  f: number;
  conf: "HIGH" | "MEDIUM" | "LOW";
  reasoning: string;
}

async function main() {
  console.log("[reestimate-low] Starting...");

  // Query all LOW confidence MacroEstimate records
  const lowEstimates = await prisma.macroEstimate.findMany({
    where: { confidence: "LOW" },
    include: {
      menuItem: {
        include: {
          restaurant: true,
        },
      },
    },
  });

  console.log(`[reestimate-low] Found ${lowEstimates.length} LOW confidence estimates`);

  let updated = 0;
  let failed = 0;

  for (const est of lowEstimates) {
    const itemName = est.menuItem.name;
    const restaurantName = est.menuItem.restaurant.name;
    const description = est.menuItem.description ?? "";

    console.log(`\n[reestimate-low] Processing: "${itemName}" @ ${restaurantName} (id: ${est.id})`);

    try {
      const userMessage = `Estimate the macronutrient content for this specific restaurant menu item:

Dish: ${itemName}
Restaurant: ${restaurantName}${description ? `\nDescription: ${description}` : ""}

Return ONLY valid JSON (no markdown fences) with these fields:
- cal: estimated calories (integer)
- p: protein in grams (number)
- c: carbs in grams (number)
- f: fat in grams (number)
- conf: confidence level, one of "HIGH", "MEDIUM", or "LOW"
- reasoning: a string (2-4 sentences) explaining your estimate, including what you assume about the dish, typical portion size, and key ingredients

Be as accurate as possible. If the dish name is ambiguous, state your assumptions in the reasoning.`;

      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 8192,
        system:
          "You are a nutrition expert. Given a dish name and restaurant, estimate its macronutrient content. Always return valid JSON only, no markdown code fences.",
        messages: [{ role: "user", content: userMessage }],
      });

      const contentBlock = message.content[0];
      if (!contentBlock || contentBlock.type !== "text") {
        throw new Error("No text content in response");
      }

      const raw = contentBlock.text.trim();
      // Strip markdown fences if present
      const jsonStr = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      const result: MacroResult = JSON.parse(jsonStr);

      // Validate
      if (
        typeof result.cal !== "number" ||
        typeof result.p !== "number" ||
        typeof result.c !== "number" ||
        typeof result.f !== "number" ||
        !["HIGH", "MEDIUM", "LOW"].includes(result.conf) ||
        typeof result.reasoning !== "string"
      ) {
        throw new Error(`Invalid response shape: ${JSON.stringify(result)}`);
      }

      // Update the record
      await prisma.macroEstimate.update({
        where: { id: est.id },
        data: {
          calories: Math.round(result.cal),
          proteinG: result.p,
          carbsG: result.c,
          fatG: result.f,
          confidence: result.conf,
          reasoning: result.reasoning,
          estimatedAt: new Date(),
        },
      });

      console.log(
        `  => Updated: ${result.cal} cal, ${result.p}p/${result.c}c/${result.f}f, confidence: ${result.conf}`
      );
      console.log(`     Reasoning: ${result.reasoning}`);
      updated++;
    } catch (err) {
      console.error(`  => FAILED: ${String(err)}`);
      failed++;
    }

    // Small delay to avoid rate limits
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n[reestimate-low] Done. Updated: ${updated}, Failed: ${failed}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[reestimate-low] Fatal error:", err);
  prisma.$disconnect();
  process.exit(1);
});
