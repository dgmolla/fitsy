import { verifiedBrand, resolveChainMacros, aprilMenuIdentity } from "./chainServing";
import type { MacroData } from "./menuSources/types";
const brand = { id: "waba", slug: "waba-grill", displayName: "WaBa Grill", aliases: [], detectionConf: "high", menuKind: "restaurant" };
test("brand handoff accepts verified exact identity and location suffixes, rejects conflicts and near names", () => {
  expect(verifiedBrand({ name: "WaBa Grill (Main Street)" }, [brand])).toBe("waba");
  expect(verifiedBrand({ name: "WaBa Grill - Van Nuys (Sepulveda)" }, [brand])).toBe("waba");
  for (const name of ["WABA GRILL (Main Street)", "ＷａＢａ   Grill - Van Nuys"]) expect(verifiedBrand({ name }, [brand])).toBe("waba");
  for (const input of [{ name: "WaBa Grill Express" }, { name: "Local Deli - WaBa Grill" }, { name: "WaBa Grill", brandId: "other" }]) expect(verifiedBrand(input, [brand])).toBeUndefined();
  expect(verifiedBrand({ name: "WaBa Grill" }, [brand, { ...brand, id: "duplicate" }])).toBeUndefined();
  for (const update of [{ detectionConf: "medium" }, { menuKind: "grocery" }]) expect(verifiedBrand({ name: "WaBa Grill" }, [{ ...brand, ...update }])).toBeUndefined();
});
test("estimation cardinality cannot silently shift nutrition between items", async () => {
  await expect(resolveChainMacros([{ name: "one" }], undefined, () => ({ status: "unmatched" }), async () => [])).rejects.toThrow("count");
  const macro: MacroData = { calories: 50, proteinG: 1, carbsG: 10, fatG: 1, confidence: "LOW", source: "haiku", dietaryTags: [] };
  const second = { ...macro, calories: 100 };
  expect(await resolveChainMacros([{ name: "one" }, { name: "two" }], undefined, () => ({ status: "unmatched" }), async () => [macro, second])).toEqual([macro, second]);
});

test("April identity omits absent context and never adopts estimated calories as source evidence", () => {
  const row = { id: "x", restaurantId: "r", name: "Miso Soup", section: null, description: null, updatedAt: new Date(), calories: 41 };
  expect(aprilMenuIdentity(row)).toStrictEqual({ name: "Miso Soup" });
});
