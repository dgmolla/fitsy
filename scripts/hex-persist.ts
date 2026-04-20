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

import type { Prisma, PrismaClient } from "@prisma/client";
import type { ValidatedPair } from "./pipeline-utils.js";
import { persistHexBulkInTx } from "./pipeline-utils.js";

type TxClient = Prisma.TransactionClient;

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

export interface PersistHexOpts {
  /** Timing hook (invoked after tx commits). */
  onTiming?: (timing: { bulkMs: number; checkpointMs: number; totalMs: number }) => void;
  /**
   * Pre-commit validator. Runs inside the tx after bulk persist but before
   * checkpoint + commit. Throw to roll back the tx (persist + checkpoint).
   */
  validateInTx?: (tx: TxClient, restaurants: HexRestaurantData[]) => Promise<void>;
}

export async function persistHex(
  runId: string,
  hexId: string,
  restaurants: HexRestaurantData[],
  prisma: PrismaClient,
  opts: PersistHexOpts = {},
): Promise<number> {
  const txStart = Date.now();
  let bulkMs = 0;
  let checkpointMs = 0;

  const result = await prisma.$transaction(
    async (tx) => {
      const t1 = Date.now();
      const totalItems = await persistHexBulkInTx(restaurants, tx);
      bulkMs = Date.now() - t1;

      if (opts.validateInTx) await opts.validateInTx(tx, restaurants);

      const t2 = Date.now();
      await tx.pipelineCompletedHex.create({
        data: { runId, hexId, count: restaurants.length },
      });
      checkpointMs = Date.now() - t2;

      return totalItems;
    },
    // LA's densest hexes (Melrose, Koreatown, DTLA) have 40+ restaurants with
    // 150+ items each — 60s was hitting the ceiling on the top decile (seen
    // 88.97s on one hex). 300s gives headroom for the full bulk write + Guard 3
    // validation + checkpoint insert without false-positive timeouts.
    // maxWait raised from the 2s default so we don't fail acquiring a tx slot
    // under sustained pipeline pressure.
    { timeout: 300_000, maxWait: 30_000 },
  );

  opts.onTiming?.({
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
