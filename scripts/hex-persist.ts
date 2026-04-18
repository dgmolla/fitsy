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
import { persistHexBulkInTx } from "./pipeline-utils.js";

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Atomically persist all restaurants in a hex AND record the checkpoint.
 *
 * Everything runs in a single `prisma.$transaction` — if any operation
 * fails the entire transaction rolls back (no partial data, no phantom
 * checkpoint).
 *
 * Persist path uses bulk SQL (fixed query count per hex) instead of
 * per-restaurant round trips.
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
  onTiming?: (timing: { bulkMs: number; checkpointMs: number; totalMs: number }) => void,
): Promise<number> {
  const txStart = Date.now();
  let bulkMs = 0;
  let checkpointMs = 0;

  const result = await prisma.$transaction(
    async (tx) => {
      const t1 = Date.now();
      const totalItems = await persistHexBulkInTx(restaurants, tx);
      bulkMs = Date.now() - t1;

      const t2 = Date.now();
      await tx.pipelineCompletedHex.create({
        data: { runId, hexId, count: restaurants.length },
      });
      checkpointMs = Date.now() - t2;

      return totalItems;
    },
    { timeout: 60_000 }, // 60s — dense hexes may have 200+ restaurants with items
  );

  onTiming?.({
    bulkMs,
    checkpointMs,
    totalMs: Date.now() - txStart,
  });

  return result;
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
