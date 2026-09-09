import { chainLandingUpsert } from "./phase1-land-payload";
const facts = { brandId: "waba", canonicalKey: "chicken-plate", aliases: ["chicken-plate"], servingSize: "1 standard plate",
  calories: 820.1, proteinG: 54, carbsG: 110, fatG: 15, source: "official", confidence: "HIGH", officialUrl: "https://example.com/nutrition.pdf" };
test("real extraction rows whitelist Prisma columns and replace serving facts on re-landing", () => {
  const extraction = { ...facts, brandSlug: "waba-grill", name: "Chicken Plate", valid: true };
  const result = chainLandingUpsert(extraction);
  expect(result.where).toEqual({ brandId_canonicalKey: { brandId: "waba", canonicalKey: "chicken-plate" } });
  expect(result.update).toStrictEqual({ aliases: facts.aliases, servingSize: "1 standard plate", calories: 820, proteinG: 54,
    carbsG: 110, fatG: 15, source: "official", confidence: "HIGH", officialUrl: facts.officialUrl, retrievedAt: expect.any(Date) });
  expect(result.create).toStrictEqual({ ...result.update, brandId: "waba", canonicalKey: "chicken-plate" });
});
test("a corrected unknown serving size replaces a stale size", () => {
  expect(chainLandingUpsert({ ...facts, servingSize: null }).update.servingSize).toBeNull();
});
test("unknown calories remain null on both create and update", () => {
  const unknown = chainLandingUpsert({ ...facts, calories: null });
  expect(unknown.create.calories).toBeNull();
  expect(unknown.update.calories).toBeNull();
});
