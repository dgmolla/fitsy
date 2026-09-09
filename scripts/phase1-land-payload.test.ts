import { chainLandingUpsert } from "./phase1-land-payload";
test("re-landing a corrected portion replaces serving size alongside macros and aliases", () => {
  const facts = { brandId: "waba", canonicalKey: "chicken-plate", aliases: ["chicken-plate"], servingSize: "1 standard plate",
    calories: 820.1, proteinG: 54, carbsG: 110, fatG: 15, source: "official", confidence: "HIGH", officialUrl: "https://example.com/nutrition.pdf" };
  const result = chainLandingUpsert(facts);
  expect(result.where).toEqual({ brandId_canonicalKey: { brandId: "waba", canonicalKey: "chicken-plate" } });
  expect(result.update).toEqual({ aliases: facts.aliases, servingSize: "1 standard plate", calories: 820, proteinG: 54,
    carbsG: 110, fatG: 15, source: "official", confidence: "HIGH", officialUrl: facts.officialUrl, retrievedAt: expect.any(Date) });
  expect(result.create).toEqual({ ...result.update, brandId: "waba", canonicalKey: "chicken-plate" });
  expect(chainLandingUpsert({ ...facts, servingSize: null }).update.servingSize).toBeNull();
});
