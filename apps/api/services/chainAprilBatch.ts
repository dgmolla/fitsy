import { Prisma, type PrismaClient } from "@prisma/client";
import { chainTransaction } from "./chainTransaction";
import { approvedChainRow, buildChainMatcher, chainMenuFingerprint, type ApprovedChainRow } from "./chainCatalog";
import { AprilPlanChangedError, aprilMenuIdentity, buildBrandIdentityMatcher, officialMacro } from "./chainServing";
import { stateHash } from "./chainPilotPlan";
import type { AprilSnapshot, AprilJournal } from "./chainAprilTypes";
import { macroWinnerSqlOrder } from "../../../packages/shared/src/utils/macroProvenance";

export interface AprilBatchEntry { before: AprilSnapshot; approved: ApprovedChainRow }
export const MAX_APRIL_CHUNK = 100;
const include = { macroEstimates: { orderBy: { id: "asc" as const } } };
const nutritionKeys = ["calories", "proteinG", "carbsG", "fatG"] as const;

/** Validate every input before any mutation; a chunk commits completely or aborts. */
export async function applyAprilChainBatch(prisma: PrismaClient, entries: AprilBatchEntry[]): Promise<AprilSnapshot[]> {
  if (!entries.length || entries.length > MAX_APRIL_CHUNK || new Set(entries.map(e => e.before.id)).size !== entries.length) throw new Error("Invalid April chunk size or duplicate item");
  const ids = entries.map(e => e.before.id).sort();
  const approvedIds = [...new Set(entries.map(e => e.approved.id))].sort();
  return chainTransaction(prisma, async tx => {
    await tx.$queryRaw`SELECT id FROM "ChainItem" WHERE id IN (${Prisma.join(approvedIds)}) ORDER BY id FOR SHARE`;
    const catalog = await tx.chainItem.findMany({ where: { brandId: { in: [...new Set(entries.map(e => e.approved.brandId))] } } });
    const catalogById = new Map(catalog.map(r => [r.id, r]));
    const brands = await tx.brand.findMany({ where: { detectionConf: { in: ["high", "llm-confirmed"] }, menuKind: "restaurant" } });
    const identity = buildBrandIdentityMatcher(brands), match = buildChainMatcher(catalog);
    const restaurants = await tx.restaurant.findMany({ where: { id: { in: [...new Set(entries.map(e => e.before.restaurantId))] } }, select: { id: true, name: true, brandId: true } });
    const restaurantsById = new Map(restaurants.map(r => [r.id, r]));
    await tx.$queryRaw`SELECT id FROM "MenuItem" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
    const current = await tx.menuItem.findMany({ where: { id: { in: ids } }, include });
    const byId = new Map(current.map(r => [r.id, r]));
    const creates: Prisma.MacroEstimateCreateManyInput[] = [], updates: Record<string, unknown>[] = [];
    for (const { before, approved } of entries) {
      const row = catalogById.get(approved.id), restaurant = restaurantsById.get(before.restaurantId), actual = byId.get(before.id);
      if (!row || approvedChainRow(row)?.review.dataHash !== approved.review.dataHash) throw new AprilPlanChangedError("Chain review changed; rebuild the plan");
      if (!restaurant || identity(restaurant) !== approved.brandId) throw new AprilPlanChangedError("Restaurant brand identity changed");
      if (!actual || actual.restaurantId !== before.restaurantId || actual.updatedAt.getTime() !== new Date(before.updatedAt).getTime()
        || chainMenuFingerprint(aprilMenuIdentity(actual)) !== chainMenuFingerprint(aprilMenuIdentity(before))) throw new AprilPlanChangedError("April item changed; rebuild the plan");
      if (stateHash(actual.macroEstimates) !== stateHash(before.macroEstimates)) throw new AprilPlanChangedError("April estimates changed; rebuild the plan");
      const item = aprilMenuIdentity(actual), result = match(approved.brandId, item);
      if (result.status !== "matched" || result.row.id !== approved.id || result.row.review.dataHash !== approved.review.dataHash) throw new AprilPlanChangedError("April item has no current reviewed binding");
      const macro = officialMacro(result.row, item), existing = actual.macroEstimates.find(e => e.source === "official");
      if (existing?.reasoning === macro.reasoning && existing.confidence === "HIGH" && !existing.hadPhoto && existing.ingredientBreakdown === null && nutritionKeys.every(k => existing[k] === macro[k])) continue;
      const data = { calories: macro.calories, proteinG: macro.proteinG, carbsG: macro.carbsG, fatG: macro.fatG, reasoning: macro.reasoning };
      if (existing) updates.push({ id: existing.id, ...data });
      else creates.push({ menuItemId: before.id, ...data, source: "official", confidence: "HIGH", hadPhoto: false, ingredientBreakdown: Prisma.DbNull });
    }
    if (creates.length) await tx.macroEstimate.createMany({ data: creates });
    if (updates.length) await tx.$executeRaw`
      UPDATE "MacroEstimate" e SET calories = v.calories, "proteinG" = v."proteinG", "carbsG" = v."carbsG", "fatG" = v."fatG",
        reasoning = v.reasoning, confidence = 'HIGH'::"ConfidenceLevel", "hadPhoto" = false, "ingredientBreakdown" = NULL, "estimatedAt" = now()
      FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS v(id text, calories int, "proteinG" double precision, "carbsG" double precision, "fatG" double precision, reasoning text)
      WHERE e.id = v.id`;
    await tx.$executeRaw`
      UPDATE "MenuItem" m SET calories = w.calories, "proteinG" = w."proteinG", "carbsG" = w."carbsG", "fatG" = w."fatG", "updatedAt" = now()
      FROM (SELECT DISTINCT ON (e."menuItemId") e.* FROM "MacroEstimate" e WHERE e."menuItemId" IN (${Prisma.join(ids)})
        ORDER BY e."menuItemId", ${Prisma.raw(macroWinnerSqlOrder("e"))}) w
      WHERE m.id = w."menuItemId" AND (m.calories, m."proteinG", m."carbsG", m."fatG") IS DISTINCT FROM (w.calories, w."proteinG", w."carbsG", w."fatG")`;
    const after = new Map((await tx.menuItem.findMany({ where: { id: { in: ids } }, include })).map(r => [r.id, r]));
    return entries.map(e => after.get(e.before.id)!);
  }, 120_000);
}

/** Whole-journal rollback uses bulk SQL after exact locked readback, retaining atomic recovery. */
export async function restoreAprilChainBatch(prisma: PrismaClient, journals: AprilJournal[]): Promise<void> {
  if (!journals.length) return;
  if (new Set(journals.map(j => j.before.id)).size !== journals.length || journals.some(j => j.before.id !== j.after.id || j.before.restaurantId !== j.after.restaurantId)) throw new Error("April rollback identity mismatch");
  const ids = journals.map(j => j.after.id).sort();
  await chainTransaction(prisma, async tx => {
    await tx.$queryRaw`SELECT id FROM "MenuItem" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
    const current = new Map((await tx.menuItem.findMany({ where: { id: { in: ids } }, include })).map(r => [r.id, r]));
    for (const { after } of journals) if (stateHash(current.get(after.id) ?? null) !== stateHash(after)) throw new Error("April row changed after apply; refusing rollback");
    const remove = journals.filter(j => !j.before.macroEstimates.some(e => e.source === "official")).map(j => j.before.id);
    const restore = journals.flatMap(j => j.before.macroEstimates.filter(e => e.source === "official"));
    if (remove.length) await tx.macroEstimate.deleteMany({ where: { menuItemId: { in: remove }, source: "official" } });
    if (restore.length) await tx.$executeRaw`
      UPDATE "MacroEstimate" e SET calories = v.calories, "proteinG" = v."proteinG", "carbsG" = v."carbsG", "fatG" = v."fatG",
        confidence = v.confidence::"ConfidenceLevel", "hadPhoto" = v."hadPhoto", "ingredientBreakdown" = v."ingredientBreakdown", reasoning = v.reasoning,
        "estimatedAt" = v."estimatedAt", "expiresAt" = v."expiresAt"
      FROM jsonb_to_recordset(${JSON.stringify(restore)}::jsonb) AS v(id text, calories int, "proteinG" double precision, "carbsG" double precision, "fatG" double precision,
        confidence text, "hadPhoto" boolean, "ingredientBreakdown" jsonb, reasoning text, "estimatedAt" timestamp, "expiresAt" timestamp)
      WHERE e.id = v.id`;
    const menu = journals.map(({ before }) => ({ id: before.id, calories: before.calories, proteinG: before.proteinG, carbsG: before.carbsG, fatG: before.fatG, updatedAt: before.updatedAt }));
    await tx.$executeRaw`
      UPDATE "MenuItem" m SET calories = v.calories, "proteinG" = v."proteinG", "carbsG" = v."carbsG", "fatG" = v."fatG", "updatedAt" = v."updatedAt"
      FROM jsonb_to_recordset(${JSON.stringify(menu)}::jsonb) AS v(id text, calories int, "proteinG" double precision, "carbsG" double precision, "fatG" double precision, "updatedAt" timestamp)
      WHERE m.id = v.id`;
    const restored = new Map((await tx.menuItem.findMany({ where: { id: { in: ids } }, include })).map(r => [r.id, r]));
    for (const { before } of journals) if (stateHash(restored.get(before.id) ?? null) !== stateHash(before)) throw new Error("April rollback readback mismatch");
  }, 120_000);
}
