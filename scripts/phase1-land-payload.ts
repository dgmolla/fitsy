import type { Prisma } from "@prisma/client";
type LandingRow = Pick<Prisma.ChainItemCreateManyInput, "brandId" | "canonicalKey" | "aliases" | "calories" | "proteinG" | "carbsG" | "fatG" | "servingSize" | "source" | "confidence" | "officialUrl">;
/** Create and update carry identical serving facts, so re-landing cannot retain an old portion. */
export function chainLandingUpsert(row: LandingRow): Prisma.ChainItemUpsertArgs {
  const { brandId, canonicalKey, ...facts } = row;
  const data = { ...facts, calories: Math.round(row.calories!), retrievedAt: new Date() };
  return { where: { brandId_canonicalKey: { brandId, canonicalKey } },
    create: { brandId, canonicalKey, ...data }, update: data };
}
