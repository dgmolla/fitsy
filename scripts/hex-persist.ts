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
import {
  persistItemsInTx,
  computeAndStoreDietaryOptionsInTx,
  updateMenuHashInTx,
} from "./pipeline-utils.js";

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
export interface HexRestaurantData {
  restaurantId: string;
  items: ValidatedPair[];
  /** Menu hash for incremental update tracking (S-127). */
  menuHash: string;
}

export async function persistHex(
  runId: string,
  hexId: string,
  restaurants: HexRestaurantData[],
  prisma: PrismaClient,
): Promise<number> {
  return prisma.$transaction(
    async (tx) => {
      let totalItems = 0;

      for (const { restaurantId, items, menuHash } of restaurants) {
        const count = await persistItemsInTx(restaurantId, items, tx);
        totalItems += count;
        await computeAndStoreDietaryOptionsInTx(restaurantId, tx);
        await updateMenuHashInTx(restaurantId, menuHash, tx);
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
    },
    { timeout: 60_000 }, // 60s — dense hexes may have 200+ restaurants with items
  );
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
