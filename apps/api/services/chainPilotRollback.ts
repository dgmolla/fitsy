import type { PrismaClient } from "@prisma/client";
import { restoreAprilChainBatch } from "./chainAprilBatch";
import type { AprilJournal } from "./chainAprilTypes";
export type { AprilSnapshot, AprilJournal } from "./chainAprilTypes";
/** Restore only nutrition written by this operation. Any subsequent edit blocks rollback. */
export function rollbackAprilPatch(prisma: PrismaClient, journal: AprilJournal): Promise<void> {
  return rollbackAprilBatch(prisma, [journal]);
}
/** A journal batch commits entirely or leaves every row unchanged. */
export function rollbackAprilBatch(prisma: PrismaClient, journals: AprilJournal[]): Promise<void> {
  return restoreAprilChainBatch(prisma, journals);
}
