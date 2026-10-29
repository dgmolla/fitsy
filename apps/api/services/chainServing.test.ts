import { verifiedBrand, resolveChainMacros, aprilMenuIdentity, buildBrandIdentityMatcher, chainMenuResolver } from "./chainServing";
import { buildChainMatcher } from "./chainCatalog";
import type { MacroData } from "./menuSources/types";
const brand = { id: "waba", slug: "waba-grill", displayName: "WaBa Grill", aliases: [], detectionConf: "high", menuKind: "restaurant" };
test.each(["WaBa Grill", "Independent Kitchen"])("%s uses only its UE menu, including when the menu is empty", async name => {
  const runtime = { brandId: buildBrandIdentityMatcher([brand]), match: buildChainMatcher([]) };
  const { resolver, brandId } = chainMenuResolver({ name, storeUuid: "fixture-store", lat: 34.05, lng: -118.25 }, runtime);
  expect(brandId).toBe(name === "WaBa Grill" ? brand.id : undefined);
  const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(Response.json({ status: "success", data: { title: name } }));
  try {
    expect(await resolver.resolve(name, "Fixture")).toMatchObject({ found: false, items: [],
      attempts: [{ sourceId: "ue_api_direct", status: "not_found" }] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockResolvedValue(Response.json({ status: "success", data: { title: name, catalogSectionsMap: { mains: [{
      payload: { standardItemsPayload: { title: { text: "Mains" }, catalogItems: [{ uuid: "bowl", title: "Chicken Bowl", price: 1200 }] } },
    }] } } }));
    expect(await resolver.resolve(name, "Fixture")).toMatchObject({ found: true, items: [{ name: "Chicken Bowl", sourceItemId: "ubereats:bowl" }],
      attempts: [{ sourceId: "ue_api_direct", status: "ok" }] });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetchSpy.mock.calls) {
      expect(url).toBe("https://www.ubereats.com/_p/api/getStoreV1");
      expect(JSON.parse(options!.body as string)).toMatchObject({ storeUuid: "fixture-store" });
    }
  } finally { fetchSpy.mockRestore(); }
});
test("brand handoff accepts verified exact identity and location suffixes, rejects conflicts and near names", () => {
  expect(verifiedBrand({ name: "WaBa Grill (Main Street)" }, [brand])).toBe("waba");
  expect(verifiedBrand({ name: "WaBa Grill - Van Nuys (Sepulveda)" }, [brand])).toBe("waba");
  for (const name of ["WaBa Grill(Main Street)", "  WaBa Grill!  ", "WABA GRILL (Main Street)", "ＷａＢａ   Grill - Van Nuys"]) expect(verifiedBrand({ name }, [brand])).toBe("waba");
  for (const input of [{ name: "WaBa Grill (Sepulveda) - Van Nuys" }, { name: "Wa Ba Grill" }, { name: "WaBa Grill (Main Street)!" }, { name: "WaBa Grill (Main Street)Express" }, { name: "WaBa Grill Express" }, { name: "Local Deli - WaBa Grill" }, { name: "WaBa Grill", brandId: "other" }]) expect(verifiedBrand(input, [brand])).toBeUndefined();
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
