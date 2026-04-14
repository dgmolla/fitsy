/**
 * Hex-Level Resume (S-140)
 *
 * On pipeline start, queries PipelineCompletedHex for all hexes already
 * completed in this run. The pipeline skips them automatically.
 *
 * Spec invariant: "Resume is the default, not a flag."
 * No --resume flag, no special mode. The pipeline always checks for
 * completed hexes and skips them.
 */

import type { PrismaClient } from "@prisma/client";

/**
 * Get the set of hex IDs already completed for a given run.
 * Returns an empty set if no hexes have been completed (fresh run).
 *
 * Used at pipeline start to determine which hexes to skip.
 * One DB query regardless of how many hexes are in the run.
 */
export async function getCompletedHexIds(
  runId: string,
  prisma: PrismaClient,
): Promise<Set<string>> {
  const rows = await prisma.pipelineCompletedHex.findMany({
    where: { runId },
    select: { hexId: true },
  });
  return new Set(rows.map((r) => r.hexId));
}

/**
 * Filter a list of hex IDs to only those not yet completed.
 * Logs the skip count for observability.
 */
export async function filterPendingHexes(
  hexIds: string[],
  runId: string,
  prisma: PrismaClient,
): Promise<string[]> {
  const completed = await getCompletedHexIds(runId, prisma);

  if (completed.size > 0) {
    console.log(
      `[resume] Run ${runId}: ${completed.size}/${hexIds.length} hexes already complete, skipping`,
    );
  }

  return hexIds.filter((id) => !completed.has(id));
}
