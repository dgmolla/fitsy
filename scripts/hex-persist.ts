/**
 * Hex-Level Atomic Persistence + Checkpoint (S-139)
 *
 * Wraps ALL restaurant persists for a single hex in one DB transaction,
 * then records the PipelineCompletedHex checkpoint in the same transaction.
 *
 * Spec invariant: "Checkpoint lives in the DB (not a file) for atomicity
 * with data persistence."  If any operation fails, the entire transaction
 * rolls back — no partial data, no phantom checkpoint.
 */

import type { PrismaClient } from "@prisma/client";
import type { ValidatedPair } from "./pipeline-utils.js";
import { decodeHtml } from "./pipeline-utils.js";

// ─── Per-restaurant persist (inlined from pipeline-utils, uses tx) ──────────

/**
 * Persist a single restaurant's items inside an existing transaction context.
 * Mirrors the SQL pattern from `persistItems` in pipeline-utils.ts but accepts
 * any Prisma-compatible transaction client (`tx`) instead of a top-level client.
 */
async function persistRestaurantInTx(
  restaurantId: string,
  inputPairs: ValidatedPair[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
): Promise<number> {
  if (inputPairs.length === 0) return 0;

  // Dedup by item name (same logic as pipeline-utils persistItems)
  const seen = new Set<string>();
  const validPairs = inputPairs.filter((p) => {
    const key = p.item.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Delete existing items (cascade deletes estimates via FK)
  await tx.$executeRaw`
    DELETE FROM "MacroEstimate" WHERE "menuItemId" IN (
      SELECT "id" FROM "MenuItem" WHERE "restaurantId" = ${restaurantId}
    )
  `;
  await tx.$executeRaw`
    DELETE FROM "MenuItem" WHERE "restaurantId" = ${restaurantId}
  `;

  // Bulk insert menu items
  const names = validPairs.map((p) => decodeHtml(p.item.name)!);
  const descriptions = validPairs.map((p) => decodeHtml(p.item.description) ?? null);
  const categories = validPairs.map((p) => decodeHtml(p.item.category) ?? null);
  const sections = validPairs.map((p) => decodeHtml(p.item.section) ?? null);
  const prices = validPairs.map((p) => p.item.price ?? null);
  const dietaryTagsJson = validPairs.map((p) => JSON.stringify(p.macro.dietaryTags ?? []));

  const menuItemRows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "MenuItem" (
      "id", "restaurantId", "name", "description", "category", "section", "price", "dietaryTags", "createdAt", "updatedAt"
    )
    SELECT
      gen_random_uuid(),
      ${restaurantId},
      name, description, category, section, price,
      ARRAY(SELECT jsonb_array_elements_text(tags::jsonb)),
      now(), now()
    FROM UNNEST(
      ${names}::text[],
      ${descriptions}::text[],
      ${categories}::text[],
      ${sections}::text[],
      ${prices}::float[],
      ${dietaryTagsJson}::text[]
    ) AS t(name, description, category, section, price, tags)
    RETURNING "id"
  `;

  // Bulk insert macro estimates
  const menuItemIds = menuItemRows.map((r: { id: string }) => r.id);
  const calories = validPairs.map((p) => Math.round(p.macro.calories));
  const proteins = validPairs.map((p) => p.macro.proteinG);
  const carbs = validPairs.map((p) => p.macro.carbsG);
  const fats = validPairs.map((p) => p.macro.fatG);
  const confidences = validPairs.map((p) => p.macro.confidence);
  const sources = validPairs.map((p) => p.macro.source);

  await tx.$executeRaw`
    INSERT INTO "MacroEstimate" (
      "id", "menuItemId", "calories", "proteinG", "carbsG", "fatG",
      "confidence", "source", "hadPhoto", "estimatedAt"
    )
    SELECT
      gen_random_uuid(),
      "menuItemId", calories, "proteinG", "carbsG", "fatG",
      confidence::"ConfidenceLevel", source, false, now()
    FROM UNNEST(
      ${menuItemIds}::text[],
      ${calories}::int[],
      ${proteins}::float[],
      ${carbs}::float[],
      ${fats}::float[],
      ${confidences}::text[],
      ${sources}::text[]
    ) AS t("menuItemId", calories, "proteinG", "carbsG", "fatG", confidence, source)
  `;

  return menuItemRows.length;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Atomically persist all restaurants in a hex AND record the checkpoint.
 *
 * Everything runs in a single `prisma.$transaction` — if any operation
 * fails the entire transaction rolls back (no partial data, no phantom
 * checkpoint).
 *
 * @returns Total number of menu items persisted across all restaurants.
 */
export async function persistHex(
  runId: string,
  hexId: string,
  restaurants: Array<{ restaurantId: string; items: ValidatedPair[] }>,
  prisma: PrismaClient,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    let totalItems = 0;

    for (const { restaurantId, items } of restaurants) {
      const count = await persistRestaurantInTx(restaurantId, items, tx);
      totalItems += count;
    }

    // Record the checkpoint in the same transaction
    await tx.pipelineCompletedHex.create({
      data: {
        runId,
        hexId,
        count: restaurants.length,
      },
    });

    return totalItems;
  });
}

/**
 * Check whether a hex has already been checkpointed for this run.
 */
export async function isHexComplete(
  runId: string,
  hexId: string,
  prisma: PrismaClient,
): Promise<boolean> {
  const record = await prisma.pipelineCompletedHex.findUnique({
    where: { runId_hexId: { runId, hexId } },
  });
  return record !== null;
}
