import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { capturedChainPilot } from "../fixtures/chain-pilot";
import { parseStoreV1Response } from "../../services/menuSources/ueApiClient";
import { chainReviewHash, approvedChainRow } from "../../services/chainCatalog";
import { applyAprilChainMatch, loadChainServing, resolveChainMacros, chainMenuResolver } from "../../services/chainServing";
import { persistHex } from "../../../../scripts/hex-persist";
import { persistItems, computeAndStoreDietaryOptions, type ValidatedPair } from "../../../../scripts/pipeline-utils";
import { validateHexInTx } from "../../../../scripts/preload-invariants";
const suite = process.env["POSTGRES_PRISMA_URL"] ? describe : describe.skip;
suite("reviewed chains through April and real new-hex persistence", () => {
  const p = new PrismaClient(), scope = randomUUID(), brands: string[] = [], restaurants: string[] = [];
  afterAll(async () => {
    await p.user.deleteMany({ where: { id: { startsWith: scope } } });
    await p.restaurant.deleteMany({ where: { id: { in: restaurants } } });
    await p.chainItem.deleteMany({ where: { brandId: { in: brands } } });
    await p.brand.deleteMany({ where: { id: { in: brands } } });
    await p.pipelineCompletedHex.deleteMany({ where: { runId: scope } });
    await p.$disconnect();
  });
  test.each([false, true])("official nutrition preserves dietary discovery without changing same-name indie items (bulk=%s)", async bulk => {
    const ids = [randomUUID(), randomUUID()]; restaurants.push(...ids);
    for (const id of ids) {
      await p.restaurant.create({ data: { id, storeUuid: randomUUID(), name: "Tag fixture", source: "ue_feed", address: "Fixture", lat: 34, lng: -118, cuisineTags: [] } });
      await p.menuItem.createMany({ data: ["Chicken Plate", "Second", "Third"].map(name => ({ restaurantId: id, name, dietaryTags: ["gluten-free"] })) });
    }
    const macro = { calories: 400, proteinG: 20, carbsG: 50, fatG: 13, confidence: "HIGH" as const, source: "haiku", dietaryTags: ["gluten-free"] };
    const inputs = ids.map((restaurantId, i) => ({ restaurantId, menuHash: "tags", items: ["Chicken Plate", "Second", "Third"].map((name, j) => ({
      item: { name }, macro: j ? macro : { ...macro, source: i ? "haiku" : "official", dietaryTags: [] },
    })) }));
    for (let round = 0; round < 2; round++) {
      if (bulk) await persistHex(scope, `tags-${round}`, inputs, p, { validateInTx: validateHexInTx });
      else for (const input of inputs) { await persistItems(input.restaurantId, input.items, p); await computeAndStoreDietaryOptions(input.restaurantId, p); }
      expect((await p.menuItem.findUniqueOrThrow({ where: { restaurantId_name: { restaurantId: ids[0]!, name: "Chicken Plate" } } })).dietaryTags).toEqual(["gluten-free"]);
      expect((await p.menuItem.findUniqueOrThrow({ where: { restaurantId_name: { restaurantId: ids[1]!, name: "Chicken Plate" } } })).dietaryTags).toEqual([]);
      expect((await p.restaurant.findUniqueOrThrow({ where: { id: ids[0]! } })).dietaryOptions).toContain("has_gluten-free");
      expect((await p.restaurant.findUniqueOrThrow({ where: { id: ids[1]! } })).dietaryOptions).not.toContain("has_gluten-free");
      expect((await p.restaurant.findUniqueOrThrow({ where: { id: ids[0]! } })).chainFlag).toBe(false);
    }
  });
  test.each(capturedChainPilot)("$slug: captured April identity and new UE location serve the same PDF facts", async fixture => {
    const brandId = randomUUID(); brands.push(brandId);
    const brand = await p.brand.create({ data: { id: brandId, slug: `${fixture.slug}-${scope}`, displayName: scope + (fixture.slug === "waba-grill" ? " WaBa Grill" : " Yoshinoya"), detectionConf: "high" } });
    const ue = parseStoreV1Response(fixture.ue)!.items[0]!;
    const row = await p.chainItem.create({ data: { brandId, canonicalKey: "reviewed/pilot", ...fixture.official, source: "official", confidence: "HIGH", officialUrl: fixture.source.url } });
    const aliases = [{ name: fixture.april.name, section: fixture.april.section, description: fixture.april.description },
      { name: ue.name, section: ue.section!, description: ue.description! }];
    const review = { version: 1 as const, sourceHash: fixture.source.sha256, locator: fixture.source.locator, reviewedBy: "PDF regression fixture", aliases };
    expect((await loadChainServing(p)).brandId({ name: brand.displayName })).toBeUndefined();
    const factsOnly = { ...review, aliases: [] };
    await p.chainItem.update({ where: { id: row.id }, data: { review: { ...factsOnly, dataHash: chainReviewHash(row, factsOnly) } } });
    expect((await loadChainServing(p)).brandId({ name: brand.displayName })).toBeUndefined();
    const approved = approvedChainRow(await p.chainItem.update({ where: { id: row.id }, data: { review: { ...review, dataHash: chainReviewHash(row, review) } } }))!;
    const makeRestaurant = async (linked: boolean) => {
      const id = randomUUID(); restaurants.push(id);
      return p.restaurant.create({ data: { id, storeUuid: randomUUID(), name: linked ? brand.displayName : `${scope} ${fixture.name}`, address: "Fixture", lat: 34, lng: -118, cuisineTags: [], source: "ue_feed", ...(linked ? { brandId } : {}) } });
    };
    const aprilRestaurant = await makeRestaurant(true), newRestaurant = await makeRestaurant(false);
    const original = await p.menuItem.create({ data: { restaurantId: aprilRestaurant.id, ...fixture.april, price: 12.34, photoUrl: "https://example.com/photo", dietaryTags: ["gluten-free"], category: "Entree" } });
    await p.macroEstimate.create({ data: { menuItemId: original.id, source: "haiku", confidence: "MEDIUM", calories: original.calories!, proteinG: original.proteinG!, carbsG: original.carbsG!, fatG: original.fatG! } });
    await p.macroEstimate.create({ data: { menuItemId: original.id, source: "official", confidence: "LOW", calories: 1, proteinG: 0, carbsG: 0, fatG: 0, hadPhoto: true, ingredientBreakdown: [{ name: "Old component" }] } });
    const userId = scope + fixture.slug;
    await p.user.create({ data: { id: userId, email: `${userId}@example.test` } });
    const saved = await p.savedItem.create({ data: { userId, menuItemId: original.id, itemType: "menu_item" } });
    await expect(applyAprilChainMatch(p, original, { ...approved, review: { ...approved.review, dataHash: "0".repeat(64) } })).rejects.toThrow("review changed");
    await expect(applyAprilChainMatch(p, { ...original, macroEstimates: [] }, approved)).rejects.toThrow("estimates changed");
    const written = await applyAprilChainMatch(p, original, approved);
    expect(written).toMatchObject({ id: original.id, macroEstimates: expect.arrayContaining([expect.objectContaining({ source: "official" })]) });
    const after = await p.menuItem.findUniqueOrThrow({ where: { id: original.id } });
    const facts = { calories: fixture.official.calories, proteinG: fixture.official.proteinG, carbsG: fixture.official.carbsG, fatG: fixture.official.fatG };
    expect(after).toMatchObject(facts);
    for (const key of ["id", "restaurantId", "name", "section", "description", "price", "photoUrl", "dietaryTags", "category", "createdAt"] as const) expect(after[key]).toEqual(original[key]);
    expect((await p.savedItem.findUniqueOrThrow({ where: { id: saved.id } })).menuItemId).toBe(original.id);
    expect(await p.menuItem.count({ where: { restaurantId: aprilRestaurant.id } })).toBe(1);
    const estimate = await p.macroEstimate.findUniqueOrThrow({ where: { menuItemId_source: { menuItemId: original.id, source: "official" } } });
    expect(estimate).toMatchObject({ hadPhoto: false, ingredientBreakdown: null });
    expect(await applyAprilChainMatch(p, written, approved)).toMatchObject({ id: original.id });
    expect(await p.macroEstimate.findUniqueOrThrow({ where: { id: estimate.id } })).toEqual(estimate);
    expect(await p.menuItem.findUniqueOrThrow({ where: { id: original.id } })).toEqual(after);
    // A current binding still repairs source facts/metadata changed independently of MenuItem.
    for (const patch of [{ calories: facts.calories + 1 }, { proteinG: facts.proteinG + 1 }, { carbsG: facts.carbsG + 1 }, { fatG: facts.fatG + 1 },
      { hadPhoto: true }, { ingredientBreakdown: [{ name: "Old component" }] }, { confidence: "LOW" as const }, { reasoning: "legacy evidence" }]) {
      await p.macroEstimate.update({ where: { id: estimate.id }, data: patch });
      const captured = await p.menuItem.findUniqueOrThrow({ where: { id: original.id }, include: { macroEstimates: { orderBy: { id: "asc" } } } });
      await applyAprilChainMatch(p, captured, approved);
      expect(await p.macroEstimate.findUniqueOrThrow({ where: { id: estimate.id } })).toMatchObject({ ...facts, confidence: "HIGH", hadPhoto: false, ingredientBreakdown: null, reasoning: estimate.reasoning });
    }
    // A stale edit plan aborts without changing the already-correct estimate.
    await expect(applyAprilChainMatch(p, { ...after, updatedAt: new Date(0) }, approved)).rejects.toThrow("changed");
    await p.restaurant.update({ where: { id: aprilRestaurant.id }, data: { name: "Unrelated restaurant" } });
    await expect(applyAprilChainMatch(p, after, approved)).rejects.toThrow("brand identity");
    await p.restaurant.update({ where: { id: aprilRestaurant.id }, data: { name: aprilRestaurant.name } });
    const runtime = await loadChainServing(p), request = { ...newRestaurant, storeUuid: newRestaurant.storeUuid! };
    const { resolver, brandId: detected } = chainMenuResolver(request, runtime);
    expect(detected).toBe(brandId);
    const fetchSpy = jest.spyOn(global, "fetch");
    try {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({ status: "success", data: { title: fixture.name } })));
      const empty = await resolver.resolve(request.name, request.address);
      expect(empty).toMatchObject({ found: false, attempts: [{ sourceId: "ue_api_direct", status: "not_found" }] });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      fetchSpy.mockImplementation(async () => new Response(JSON.stringify(fixture.ue)));
      expect((await resolver.resolve(request.name, request.address)).items).toEqual([ue]);
      fetchSpy.mockResolvedValueOnce(new Response("missing", { status: 404 }));
      const unreviewed = chainMenuResolver({ ...request, name: "Unrelated Deli" }, runtime);
      expect(unreviewed.brandId).toBeUndefined();
      expect(await unreviewed.resolver.resolve("Unrelated Deli", "Fixture")).toMatchObject({ found: true, items: [ue], attempts: [{ sourceId: "fatsecret", status: "not_found" }, { sourceId: "ue_api_direct", status: "ok" }] });
    } finally { fetchSpy.mockRestore(); }
    await p.restaurant.update({ where: { id: aprilRestaurant.id }, data: { brandId: null } });
    await expect(applyAprilChainMatch(p, after, approved)).resolves.toMatchObject({ id: after.id });
    await p.restaurant.update({ where: { id: aprilRestaurant.id }, data: { brandId } });
    const unseen = { name: "Unreviewed seasonal dish" };
    const requested: string[] = [];
    const macros = await resolveChainMacros([ue, unseen], detected, runtime.match, async items => {
      requested.push(...items.map(i => i.name));
      return items.map(() => ({ calories: 400, proteinG: 20, carbsG: 50, fatG: 13, confidence: "MEDIUM" as const, source: "haiku", dietaryTags: [] }));
    });
    expect(requested).toEqual([unseen.name]);
    const pairs: ValidatedPair[] = [ue, unseen].map((item, i) => ({ item, macro: macros[i]! }));
    await persistHex(scope, fixture.slug, [{ restaurantId: newRestaurant.id, brandId: detected!, items: pairs, menuHash: "pilot" }], p, { validateInTx: validateHexInTx });
    const added = await p.menuItem.findUniqueOrThrow({ where: { restaurantId_name: { restaurantId: newRestaurant.id, name: ue.name } } });
    expect(added).toMatchObject({ ...facts, dietaryTags: [] });
    const persisted = await p.macroEstimate.findUniqueOrThrow({ where: { menuItemId_source: { menuItemId: added.id, source: "official" } } });
    expect(JSON.parse(persisted.reasoning!)).toMatchObject({ chainItemId: row.id, reviewHash: approved.review.dataHash });
    expect(await p.restaurant.findUniqueOrThrow({ where: { id: newRestaurant.id } })).toMatchObject({ brandId, chainFlag: true });
    // Multiple estimates per item are valid; missing estimates must still abort a checkpoint.
    await p.$transaction(tx => validateHexInTx(tx, [{ restaurantId: aprilRestaurant.id, items: [], menuHash: "" }]));
    const missing = await p.menuItem.create({ data: { restaurantId: aprilRestaurant.id, name: "Missing estimate" } });
    await expect(p.$transaction(tx => validateHexInTx(tx, [{ restaurantId: aprilRestaurant.id, items: [], menuHash: "" }]))).rejects.toThrow("items=2 macros=1");
    await p.menuItem.delete({ where: { id: missing.id } });
    // A changed UE serving loses its old reviewed binding and keeps its Fitsy ID.
    const changed = { ...ue, description: "Different size and ingredients" };
    for (const bulk of [false, true]) {
      await persistItems(newRestaurant.id, pairs, p);
      await p.macroEstimate.updateMany({ where: { menuItemId: added.id, source: "official" }, data: { ingredientBreakdown: [{ name: "Old component" }] } });
      if (bulk) await persistHex(scope, fixture.slug + "-metadata", [{ restaurantId: newRestaurant.id, items: pairs, menuHash: "pilot" }], p, { validateInTx: validateHexInTx });
      else await persistItems(newRestaurant.id, pairs, p);
      expect((await p.macroEstimate.findUniqueOrThrow({ where: { menuItemId_source: { menuItemId: added.id, source: "official" } } })).ingredientBreakdown).toBeNull();
      expect((await p.macroEstimate.findUniqueOrThrow({ where: { menuItemId_source: { menuItemId: added.id, source: "official" } } })).reasoning).toBe(persisted.reasoning);
      const legacy = await p.menuItem.findUniqueOrThrow({ where: { restaurantId_name: { restaurantId: newRestaurant.id, name: unseen.name } } });
      await p.macroEstimate.upsert({ where: { menuItemId_source: { menuItemId: legacy.id, source: "official" } },
        create: { menuItemId: legacy.id, source: "official", calories: 450, proteinG: 20, carbsG: 50, fatG: 19, confidence: "HIGH" }, update: {} });
      const changedPairs = [{ item: changed, macro: macros[1]! }, { item: unseen, macro: macros[1]! }];
      if (bulk) await persistHex(scope, fixture.slug + "-changed", [{ restaurantId: newRestaurant.id, items: changedPairs, menuHash: "changed" }], p, { validateInTx: validateHexInTx });
      else await persistItems(newRestaurant.id, changedPairs, p);
      expect((await p.menuItem.findUniqueOrThrow({ where: { id: added.id } })).calories).toBe(400);
      expect(await p.macroEstimate.count({ where: { menuItemId: added.id, source: "official" } })).toBe(0);
      expect(await p.macroEstimate.count({ where: { menuItemId: legacy.id, source: "official", reasoning: null } })).toBe(1);
    }
    // Merchant values keep priority even when April's reviewed official source is added.
    await p.macroEstimate.create({ data: { menuItemId: original.id, source: "merchant", confidence: "HIGH", calories: 900, proteinG: 50, carbsG: 100, fatG: 30 } });
    await applyAprilChainMatch(p, after, approved);
    expect((await p.menuItem.findUniqueOrThrow({ where: { id: original.id } })).calories).toBe(900);
    const competingBrand = await p.brand.create({ data: { slug: randomUUID(), displayName: "Other chain", aliases: [brand.displayName], detectionConf: "high" } });
    brands.push(competingBrand.id);
    await expect(applyAprilChainMatch(p, await p.menuItem.findUniqueOrThrow({ where: { id: original.id } }), approved)).rejects.toThrow("brand identity");
    await p.brand.delete({ where: { id: competingBrand.id } });
    // An alias collision appearing after planning must not be hidden by checking only one row.
    const duplicate = { ...row, id: randomUUID(), canonicalKey: "other" };
    await p.chainItem.create({ data: { ...duplicate, review: { ...review, dataHash: chainReviewHash(duplicate, review) } } });
    await expect(applyAprilChainMatch(p, await p.menuItem.findUniqueOrThrow({ where: { id: original.id } }), approved)).rejects.toThrow("binding");
    // A conflicting brand handoff rolls back menu inserts and the hex checkpoint together.
    await expect(persistHex(scope, fixture.slug + "-conflict", [{ restaurantId: aprilRestaurant.id, brandId: randomUUID(), items: pairs, menuHash: "bad" }], p)).rejects.toThrow("brand changed");
    expect(await p.pipelineCompletedHex.count({ where: { runId: scope, hexId: fixture.slug + "-conflict" } })).toBe(0);
    expect(await p.menuItem.count({ where: { restaurantId: aprilRestaurant.id } })).toBe(1);
  });
});
