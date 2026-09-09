import type { Prisma, ChainItem } from "@prisma/client";
type LandingRow = Pick<ChainItem, "brandId" | "canonicalKey" | "aliases" | "calories" | "proteinG" | "carbsG" | "fatG" | "servingSize" | "source" | "confidence" | "officialUrl">;
/** Create and update carry identical serving facts, so re-landing cannot retain an old portion. */
export function chainLandingUpsert(row: LandingRow): Prisma.ChainItemUpsertArgs {
  const { brandId, canonicalKey } = row;
  const data = { aliases: row.aliases, calories: row.calories === null ? null : Math.round(row.calories),
    proteinG: row.proteinG, carbsG: row.carbsG, fatG: row.fatG, servingSize: row.servingSize,
    source: row.source, confidence: row.confidence, officialUrl: row.officialUrl, retrievedAt: new Date() };
  return { where: { brandId_canonicalKey: { brandId, canonicalKey } },
    create: { brandId, canonicalKey, ...data }, update: data };
}
