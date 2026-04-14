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
export async function persistHex(
  runId: string,
  hexId: string,
  restaurants: Array<{ restaurantId: string; items: ValidatedPair[] }>,
  prisma: PrismaClient,
): Promise<number> {
  return prisma.$transaction(
    async (tx) => {
      let totalItems = 0;

      for (const { restaurantId, items } of restaurants) {
        const count = await persistItemsInTx(restaurantId, items, tx);
        totalItems += count;
        await computeAndStoreDietaryOptionsInTx(restaurantId, tx);
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
    { timeout: 30_000 }, // 30s — hex may contain up to 20 restaurants
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
