import { randomUUID } from "node:crypto";
import { PrismaClient, type Brand, type ChainItem } from "@prisma/client";
import { chainPilot } from "../../services/chainPilotData";
import { planChainPilot, applyCatalogPlan, rollbackCatalogPlan, stateHash } from "../../services/chainPilotPlan";
import { approvedChainRow, buildChainMatcher } from "../../services/chainCatalog";
import { applyAprilChainMatch, aprilMenuIdentity, loadChainServing, resolveChainMacros } from "../../services/chainServing";
import { rollbackAprilPatch } from "../../services/chainPilotRollback";
import { persistHex } from "../../../../scripts/hex-persist";
import { validateHexInTx } from "../../../../scripts/preload-invariants";
import { getMenuPage } from "../../lib/restaurantMenuService";
import { findNearbyRestaurants, prisma as servingPrisma } from "../../lib/restaurantService";
import capturedUE from "../fixtures/__snapshots__/chain-pilot-ue.json";
import capturedApril from "../fixtures/__snapshots__/chain-pilot-april.json";
import { capturedChainPilot } from "../fixtures/chain-pilot";
import { parseStoreV1Response } from "../../services/menuSources/ueApiClient";
const suite = process.env["POSTGRES_PRISMA_URL"] ? describe : describe.skip;
suite("official PDF pilot correction against captured April data", () => {
  const p = new PrismaClient(); let scope: string, brands: Brand[], catalog: ChainItem[], pilot: typeof chainPilot;
  beforeEach(async () => {
    scope = randomUUID(); brands = [];
    pilot = { ...chainPilot, changes: chainPilot.changes.map(c => ({ ...c, slug: scope + c.slug })), quarantine: chainPilot.quarantine.map(c => ({ ...c, slug: scope + c.slug })) };
    for (const slug of ["waba-grill", "yoshinoya"]) brands.push(await p.brand.create({ data: { slug: scope + slug, displayName: scope + (slug === "waba-grill" ? " WaBa Grill" : " Yoshinoya"), detectionConf: "high" } }));
    for (const row of [...pilot.changes, ...pilot.quarantine]) if (row.expected) await p.chainItem.create({ data: { brandId: brands.find(b => b.slug === row.slug)!.id, ...row.expected } });
    catalog = await p.chainItem.findMany({ where: { brandId: { in: brands.map(b => b.id) } } });
  });
  afterEach(async () => {
    const ids = brands.map(b => b.id);
    await p.restaurant.deleteMany({ where: { OR: [{ brandId: { in: ids } }, { storeUuid: { startsWith: scope } }] } });
    await p.chainItem.deleteMany({ where: { brandId: { in: ids } } });
    await p.brand.deleteMany({ where: { id: { in: ids } } });
    await p.pipelineCompletedHex.deleteMany({ where: { runId: scope } });
  });
  afterAll(async () => { await p.$disconnect(); await servingPrisma.$disconnect(); });
  test("12 catalog corrections are atomic, idempotent after replan, and exactly reversible", async () => {
    const plan = planChainPilot(brands, catalog, pilot);
    expect(plan.changes).toHaveLength(12);
    const after = await applyCatalogPlan(p, plan, pilot);
    const stored = await p.chainItem.findMany({ where: { brandId: { in: brands.map(b => b.id) } } });
    expect(stored.filter(r => approvedChainRow(r))).toHaveLength(7);
    for (const row of stored.filter(r => !approvedChainRow(r))) expect(row.aliases).toEqual([]);
    expect(planChainPilot(brands, stored, pilot).changes).toEqual([]);
    await rollbackCatalogPlan(p, JSON.parse(JSON.stringify(plan)), JSON.parse(JSON.stringify(after)));
    const restored = await p.chainItem.findMany({ where: { brandId: { in: brands.map(b => b.id) } }, orderBy: { id: "asc" } });
    expect(stateHash(restored)).toBe(stateHash([...catalog].sort((a, b) => a.id.localeCompare(b.id))));
  });
  test("stale or altered plans and mismatched rollback records fail without partial writes", async () => {
    const plan = planChainPilot(brands, catalog, pilot);
    await expect(applyCatalogPlan(p, { ...plan, hash: "wrong" }, pilot)).rejects.toThrow("digest");
    const changed = catalog[0]!;
    await p.chainItem.update({ where: { id: changed.id }, data: { calories: 1 } });
    await expect(applyCatalogPlan(p, plan, pilot)).rejects.toThrow("baseline");
    expect(await p.chainItem.count({ where: { brandId: { in: brands.map(b => b.id) } } })).toBe(9);
    await p.chainItem.update({ where: { id: changed.id }, data: { calories: changed.calories, updatedAt: changed.updatedAt } });
    const after = await applyCatalogPlan(p, plan, pilot);
    await expect(rollbackCatalogPlan(p, plan, [...after].reverse())).rejects.toThrow("planned change");
    await p.chainItem.update({ where: { id: after[0]!.id }, data: { servingSize: "Concurrent edit" } });
    await expect(rollbackCatalogPlan(p, plan, after)).rejects.toThrow("changed after apply");
  });
  test("all 64 captured April rows match the actual seven-dish correction set; live UE observations agree", async () => {
    await applyCatalogPlan(p, planChainPilot(brands, catalog, pilot), pilot);
    const stored = await p.chainItem.findMany({ where: { brandId: { in: brands.map(b => b.id) } } });
    const match = buildChainMatcher(stored), restaurants = new Map<string, string>();
    for (const row of capturedApril) {
      const brandId = brands.find(b => b.slug === scope + row.slug)!.id;
      if (!restaurants.has(row.restaurantId)) {
        const restaurant = await p.restaurant.create({ data: { storeUuid: scope + row.restaurantId, brandId, name: scope + " " + row.restaurantName, address: "Captured fixture", lat: 34, lng: -118, cuisineTags: [], source: "ue_feed" } });
        restaurants.set(row.restaurantId, restaurant.id);
      }
      const { canonicalKey, slug: _slug, restaurantName: _name, id: sourceId, restaurantId, ...fields } = row;
      const item = await p.menuItem.create({ data: { ...fields, id: scope + sourceId, restaurantId: restaurants.get(restaurantId)! } });
      await p.macroEstimate.create({ data: { menuItemId: item.id, calories: item.calories!, proteinG: item.proteinG!, carbsG: item.carbsG!, fatG: item.fatG!, source: item.section === "Beef" ? "fatsecret" : "haiku", confidence: "HIGH" } });
      const result = match(brandId, aprilMenuIdentity(item));
      expect(result.status).toBe("matched"); if (result.status !== "matched") throw new Error("Fixture match missing");
      expect(result.row.canonicalKey).toBe(canonicalKey);
      await applyAprilChainMatch(p, { ...item, macroEstimates: await p.macroEstimate.findMany({ where: { menuItemId: item.id }, orderBy: { id: "asc" } }) }, result.row);
      const after = await p.menuItem.findUniqueOrThrow({ where: { id: item.id } });
      const expected = chainPilot.changes.find(c => c.canonicalKey === canonicalKey)!.facts;
      expect(after).toMatchObject({ calories: expected.calories, proteinG: expected.proteinG, carbsG: expected.carbsG, fatG: expected.fatG });
      const detail = await getMenuPage(p, after.restaurantId, { targets: expected, selectedItemId: after.id, limit: 1 });
      expect(detail!.menuItems[0]).toMatchObject({ id: after.id, macros: { calories: expected.calories, proteinG: expected.proteinG, carbsG: expected.carbsG, fatG: expected.fatG, confidence: "HIGH" } });
      for (const key of ["id", "name", "description", "section", "category", "photoUrl", "price", "dietaryTags", "createdAt"] as const) expect(after[key]).toEqual(item[key]);
    }
    expect(restaurants.size).toBe(31);
    expect(capturedApril).toHaveLength(64);
    expect(Object.fromEntries(chainPilot.changes.map(row => [row.canonicalKey, capturedApril.filter(item => item.canonicalKey === row.canonicalKey).length]))).toEqual({ "chicken-plate": 7, "steak-plate": 25, "chicken-veggie-bowl": 7, "miso-soup": 7, "gyudon-beef-side": 6, "habanero-chicken-side": 6, "blount-clam-chowder": 6 });
    for (const capture of capturedChainPilot) {
      const brandId = brands.find(b => b.slug === scope + capture.slug)!.id, item = parseStoreV1Response(capture.ue)!.items[0]!;
      const result = match(brandId, item);
      expect(result).toMatchObject({ status: "matched", row: { calories: capture.official.calories, proteinG: capture.official.proteinG, carbsG: capture.official.carbsG, fatG: capture.official.fatG } });
      expect(match(brandId, { ...item, calorieRange: [100, 2000] })).toEqual({ status: "unmatched" });
    }
  });
  test("April rollback restores an existing official estimate and rejects any later item or estimate edit", async () => {
    await applyCatalogPlan(p, planChainPilot(brands, catalog, pilot), pilot);
    const brand = brands.find(b => b.slug === scope + "waba-grill")!;
    const restaurant = await p.restaurant.create({ data: { storeUuid: scope, brandId: brand.id, name: brand.displayName, address: "Rollback fixture", lat: 34, lng: -118, cuisineTags: [], source: "ue_feed" } });
    const item = await p.menuItem.create({ data: { restaurantId: restaurant.id, ...capturedChainPilot[0]!.april } });
    const old = await p.macroEstimate.create({ data: { menuItemId: item.id, source: "official", confidence: "LOW", calories: 600, proteinG: 40, carbsG: 90, fatG: 9, reasoning: "Prior official source", ingredientBreakdown: [{ name: "legacy" }] } });
    const before = await p.menuItem.findUniqueOrThrow({ where: { id: item.id }, include: { macroEstimates: { orderBy: { id: "asc" } } } });
    const row = approvedChainRow(await p.chainItem.findUniqueOrThrow({ where: { brandId_canonicalKey: { brandId: brand.id, canonicalKey: "chicken-plate" } } }))!;
    const after = await applyAprilChainMatch(p, before, row), journal = JSON.parse(JSON.stringify({ before, after }));
    await expect(rollbackAprilPatch(p, { before: { ...before, id: "wrong" }, after })).rejects.toThrow("identity mismatch");
    await p.menuItem.update({ where: { id: item.id }, data: { name: "Concurrent edit" } });
    await expect(rollbackAprilPatch(p, journal)).rejects.toThrow("changed after apply");
    expect((await p.menuItem.findUniqueOrThrow({ where: { id: item.id } })).name).toBe("Concurrent edit");
    await p.menuItem.update({ where: { id: item.id }, data: { name: after.name, updatedAt: after.updatedAt } });
    const written = after.macroEstimates.find(e => e.source === "official")!;
    await p.macroEstimate.update({ where: { id: written.id }, data: { reasoning: "Later source edit" } });
    await expect(rollbackAprilPatch(p, journal)).rejects.toThrow("changed after apply");
    await p.macroEstimate.update({ where: { id: written.id }, data: { reasoning: written.reasoning } });
    await rollbackAprilPatch(p, journal);
    const restored = await p.menuItem.findUniqueOrThrow({ where: { id: item.id }, include: { macroEstimates: { orderBy: { id: "asc" } } } });
    expect(stateHash(restored)).toBe(stateHash(before));
    expect(restored.macroEstimates[0]).toEqual(old);
  });
  test("all seven configurations from actual UE menus persist identically at new locations", async () => {
    await applyCatalogPlan(p, planChainPilot(brands, catalog, pilot), pilot);
    const runtime = await loadChainServing(p); let count = 0;
    for (const brand of brands) {
      const restaurant = await p.restaurant.create({ data: { storeUuid: scope + brand.id, name: brand.displayName + " (New Location)", address: "New hex fixture", lat: 34, lng: -118, cuisineTags: [], source: "ue_feed" } });
      const observations = capturedUE.filter(r => scope + r.slug === brand.slug), items = observations.map(r => r.items[0]!.item);
      const brandId = runtime.brandId(restaurant); expect(brandId).toBe(brand.id);
      const macros = await resolveChainMacros(items, brandId, runtime.match, async () => { throw new Error("Reviewed configurations must not call estimation"); });
      await persistHex(scope, brand.slug, [{ restaurantId: restaurant.id, brandId: brand.id, items: items.map((item, i) => ({ item, macro: macros[i]! })), menuHash: "captured-seven-dish-pilot" }], p, { validateInTx: validateHexInTx });
      for (const [index, observation] of observations.entries()) {
        const item = await p.menuItem.findUniqueOrThrow({ where: { restaurantId_name: { restaurantId: restaurant.id, name: items[index]!.name } }, include: { macroEstimates: true } });
        const { servingSize: _serving, ...facts } = chainPilot.changes.find(c => c.canonicalKey === observation.key)!.facts;
        expect(item).toMatchObject(facts);
        expect(item.macroEstimates).toEqual([expect.objectContaining({ ...facts, source: "official", confidence: "HIGH" })]); count++;
        const search = await findNearbyRestaurants({ lat: 34, lng: -118, radiusMiles: .1, targets: facts, query: restaurant.name, limit: 20 });
        expect(search.data.find(r => r.id === restaurant.id)?.bestMatch).toMatchObject({ menuItemId: item.id, ...facts, confidence: "HIGH" });
        const detail = await getMenuPage(p, restaurant.id, { targets: facts, limit: 1 });
        expect(detail!.menuItems[0]).toMatchObject({ id: item.id, macros: { ...facts, confidence: "HIGH" } });
      }
    }
    expect(count).toBe(7);
  });
});
