import { Prisma, type PrismaClient, type MacroEstimate } from "@prisma/client";
import { approvedChainRow, buildChainMatcher, chainMenuFingerprint, type ApprovedChainRow, type ChainMatch } from "./chainCatalog";
// Offline adapters need the pure ordering utility without the shared barrel's environment initialization.
import { macroWinnerSqlOrder } from "../../../packages/shared/src/utils/macroProvenance";
import { MenuSourceResolver } from "./menuSources/resolver";
import { FatSecretSource } from "./menuSources/fatSecretSource";
import { UeApiDirectSource, type UeConcurrencyGate } from "./menuSources/ueApiDirectSource";
import type { MacroData, StructuredMenuItem } from "./menuSources/types";

interface ChainBrand { id: string; slug: string; displayName: string; aliases: string[]; detectionConf: string | null; menuKind: string }
const brandName = (name: string) => name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export function verifiedBrand(restaurant: { name: string; brandId?: string | null }, brands: ChainBrand[]): string | undefined {
  const name = brandName(restaurant.name.replace(/\s*\([^()]+\)\s*$/, "").split(/\s+-\s+/)[0]!);
  const candidates = brands.filter(b => ["high", "llm-confirmed"].includes(b.detectionConf ?? "") && b.menuKind === "restaurant"
    && [b.displayName, b.slug, ...b.aliases].some(alias => brandName(alias) === name));
  if (candidates.length !== 1 || (restaurant.brandId && restaurant.brandId !== candidates[0]!.id)) return undefined;
  return candidates[0]!.id;
}
export function officialMacro(row: ApprovedChainRow, item: StructuredMenuItem): MacroData & { reasoning: string } {
  return { calories: row.calories, proteinG: row.proteinG, carbsG: row.carbsG, fatG: row.fatG, confidence: "HIGH", source: "official", dietaryTags: [],
    reasoning: JSON.stringify({ kind: "reviewed-chain-v1", chainItemId: row.id, reviewHash: row.review.dataHash,
      sourceHash: row.review.sourceHash, sourceUrl: row.officialUrl, servingSize: row.servingSize, menuFingerprint: chainMenuFingerprint(item) }) };
}
export async function loadChainServing(prisma: Pick<PrismaClient, "brand" | "chainItem">) {
  const brands = await prisma.brand.findMany({ where: { detectionConf: { in: ["high", "llm-confirmed"] }, menuKind: "restaurant" } });
  const rows = await prisma.chainItem.findMany({ where: { brandId: { in: brands.map(b => b.id) } } });
  const enabled = new Set(rows.filter(r => (approvedChainRow(r)?.review.aliases.length ?? 0) > 0).map(r => r.brandId));
  const matcher = buildChainMatcher(rows);
  return { brandId: (restaurant: { name: string; brandId?: string | null }) => {
    const id = verifiedBrand(restaurant, brands); return id && enabled.has(id) ? id : undefined;
  }, match: matcher };
}
export type ChainServing = Awaited<ReturnType<typeof loadChainServing>>;
/** Reviewed brands require location menu evidence. Empty UE menus have no national-catalog fallback; unmatched UE items use estimation, not unverified FatSecret servings. */
export function chainMenuResolver(restaurant: { name: string; brandId?: string | null; storeUuid: string }, runtime: ChainServing, gate?: UeConcurrencyGate) {
  const brandId = runtime.brandId(restaurant);
  return { brandId, resolver: new MenuSourceResolver([
    ...(brandId ? [] : [new FatSecretSource()]), new UeApiDirectSource(restaurant.storeUuid, {}, gate),
  ]) };
}
/** Only unmatched UE items reach estimation; a resolver never invents menu membership. */
export async function resolveChainMacros(items: StructuredMenuItem[], brandId: string | undefined,
  match: (brandId: string | undefined, item: StructuredMenuItem) => ChainMatch,
  estimate: (items: StructuredMenuItem[]) => Promise<(MacroData | null)[]>): Promise<(MacroData | null)[]> {
  const matches = items.map(item => match(brandId, item)), unresolved = items.filter((_, i) => matches[i]!.status !== "matched");
  const fallback = unresolved.length ? await estimate(unresolved) : [];
  if (fallback.length !== unresolved.length) throw new Error("Estimator result count does not match unresolved menu items");
  let next = 0;
  return matches.map((result, i) => result.status === "matched" ? officialMacro(result.row, items[i]!) : fallback[next++]!);
}
export interface AprilItem {
  id: string; restaurantId: string; name: string; section: string | null; description: string | null; updatedAt: Date;
}
/** Deliberately excludes denormalized estimated calories: they are not UE source labels. */
export const aprilMenuIdentity = (item: AprilItem): StructuredMenuItem => ({ name: item.name,
  ...(item.section !== null ? { section: item.section } : {}), ...(item.description !== null ? { description: item.description } : {}) });
/** Nutrition-only update. No menu upsert/deletion, tags, photos, prices, or saved-item mutations. */
export async function applyAprilChainMatch(prisma: PrismaClient, expected: AprilItem & { macroEstimates: MacroEstimate[] }, approved: ApprovedChainRow) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "ChainItem" WHERE id = ${approved.id} FOR SHARE`;
    const current = await tx.chainItem.findUnique({ where: { id: approved.id } });
    if (!current || approvedChainRow(current)?.review.dataHash !== approved.review.dataHash) throw new Error("Chain review changed; rebuild the plan");
    const restaurant = await tx.restaurant.findUnique({ where: { id: expected.restaurantId }, select: { brandId: true, name: true } });
    const brands = await tx.brand.findMany({ where: { detectionConf: { in: ["high", "llm-confirmed"] }, menuKind: "restaurant" } });
    if (!restaurant || verifiedBrand(restaurant, brands) !== approved.brandId) throw new Error("Restaurant brand identity changed");
    const catalog = await tx.chainItem.findMany({ where: { brandId: approved.brandId } });
    const item = aprilMenuIdentity(expected), result = buildChainMatcher(catalog)(approved.brandId, item);
    if (result.status !== "matched" || result.row.id !== approved.id || result.row.review.dataHash !== approved.review.dataHash) throw new Error("April item has no current reviewed binding");
    // Lock and compare the row before adding an estimate. A concurrent edit fails closed.
    const locked = await tx.$queryRaw<{ updatedAt: Date; name: string; section: string | null; description: string | null }[]>`
      SELECT "updatedAt", name, section, description FROM "MenuItem" WHERE id = ${expected.id} AND "restaurantId" = ${expected.restaurantId} FOR UPDATE`;
    const actual = locked[0];
    if (!actual || actual.updatedAt.getTime() !== expected.updatedAt.getTime() || chainMenuFingerprint(aprilMenuIdentity({ ...expected, ...actual })) !== chainMenuFingerprint(item)) throw new Error("April item changed; rebuild the plan");
    const macro = officialMacro(result.row, item);
    const estimate = { calories: macro.calories, proteinG: macro.proteinG, carbsG: macro.carbsG, fatG: macro.fatG,
      confidence: macro.confidence, source: macro.source, reasoning: macro.reasoning, hadPhoto: false, ingredientBreakdown: Prisma.DbNull };
    const estimates = await tx.macroEstimate.findMany({ where: { menuItemId: expected.id }, orderBy: { id: "asc" } });
    if (JSON.stringify(estimates) !== JSON.stringify(expected.macroEstimates)) throw new Error("April estimates changed; rebuild the backup and plan");
    const existing = estimates.find(e => e.source === "official");
    const unchanged = existing?.reasoning === macro.reasoning && existing.confidence === "HIGH" && !existing.hadPhoto && existing.ingredientBreakdown === null && ["calories", "proteinG", "carbsG", "fatG"].every(key => existing[key as "calories"] === macro[key as "calories"]);
    if (!unchanged) await tx.macroEstimate.upsert({ where: { menuItemId_source: { menuItemId: expected.id, source: "official" } },
      create: { ...estimate, menuItemId: expected.id }, update: { ...estimate, estimatedAt: new Date() } });
    await tx.$executeRaw`UPDATE "MenuItem" m SET calories = w.calories, "proteinG" = w."proteinG", "carbsG" = w."carbsG", "fatG" = w."fatG", "updatedAt" = now()
      FROM (SELECT e.* FROM "MacroEstimate" e WHERE e."menuItemId" = ${expected.id} ORDER BY ${Prisma.raw(macroWinnerSqlOrder("e"))} LIMIT 1) w WHERE m.id = ${expected.id}
      AND (m.calories, m."proteinG", m."carbsG", m."fatG") IS DISTINCT FROM (w.calories, w."proteinG", w."carbsG", w."fatG")`;
    return tx.menuItem.findUniqueOrThrow({ where: { id: expected.id }, include: { macroEstimates: { orderBy: { id: "asc" } } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}
