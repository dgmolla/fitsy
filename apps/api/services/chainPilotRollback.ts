import { Prisma, type PrismaClient } from "@prisma/client";
import { stateHash } from "./chainPilotPlan";
export type AprilSnapshot = Prisma.MenuItemGetPayload<{ include: { macroEstimates: true } }>;
export interface AprilJournal { before: AprilSnapshot; after: AprilSnapshot }
/** Restore only nutrition written by this operation. Any subsequent edit blocks rollback. */
export async function rollbackAprilPatch(prisma: PrismaClient, journal: AprilJournal): Promise<void> {
  const { before, after } = journal;
  if (before.id !== after.id || before.restaurantId !== after.restaurantId) throw new Error("April rollback identity mismatch");
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "MenuItem" WHERE id = ${after.id} FOR UPDATE`;
    const current = await tx.menuItem.findUnique({ where: { id: after.id }, include: { macroEstimates: { orderBy: { id: "asc" } } } });
    if (stateHash(current) !== stateHash(after)) throw new Error("April row changed after apply; refusing rollback");
    const prior = before.macroEstimates.find(e => e.source === "official");
    if (!prior) await tx.macroEstimate.deleteMany({ where: { menuItemId: after.id, source: "official" } });
    else {
      const data = { ...prior, ingredientBreakdown: prior.ingredientBreakdown === null ? Prisma.DbNull : prior.ingredientBreakdown as Prisma.InputJsonValue };
      await tx.macroEstimate.upsert({ where: { menuItemId_source: { menuItemId: before.id, source: "official" } }, create: data, update: data });
    }
    await tx.menuItem.update({ where: { id: before.id }, data: { calories: before.calories, proteinG: before.proteinG, carbsG: before.carbsG, fatG: before.fatG, updatedAt: before.updatedAt } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}
