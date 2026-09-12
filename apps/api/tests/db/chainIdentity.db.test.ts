import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { PrismaClient, type Brand } from "@prisma/client";
import { planChainIdentity, readChainIdentities, applyChainIdentity, rollbackChainIdentity,
  restaurantIdentitySelect, type ChainIdentityBatch } from "../../services/chainIdentityPlan";
import { applyCatalogPlan, planChainPilot, rollbackCatalogPlan } from "../../services/chainPilotPlan";
import { loadChainServing, applyAprilChainMatch, aprilMenuIdentity, chainMenuResolver, resolveChainMacros } from "../../services/chainServing";
import { rollbackAprilBatch } from "../../services/chainPilotRollback";
import { getMenuPage } from "../../lib/restaurantMenuService";
import { persistHex } from "../../../../scripts/hex-persist";
import { validateHexInTx } from "../../../../scripts/preload-invariants";
const suite = process.env["POSTGRES_PRISMA_URL"] ? describe : describe.skip;
const facts = { calories: 500, proteinG: 30, carbsG: 50, fatG: 20 };
const evidence = { url: "https://example.com/synthetic-identity", sha256: "1".repeat(64), locator: "Synthetic identity fixture, not nutrition ground truth" };
const identity = (b: Brand) => ({ id: b.id, slug: b.slug, displayName: b.displayName, aliases: b.aliases, detectionConf: b.detectionConf, menuKind: b.menuKind });
suite("reviewed chain identities through existing menu and new-hex serving", () => {
  const p = new PrismaClient(), scope = randomUUID(), brands: string[] = [], restaurants: string[] = [];
  const createRestaurant = async (name: string, brandId?: string) => {
    const r = await p.restaurant.create({ data: { name, ...(brandId ? { brandId } : {}), storeUuid: randomUUID(),
      address: "Synthetic local fixture", lat: 34, lng: -118, source: "ue_feed", cuisineTags: [] } });
    restaurants.push(r.id); return p.restaurant.findUniqueOrThrow({ where: { id: r.id }, select: restaurantIdentitySelect });
  };
  const plan = async (batch: ChainIdentityBatch) => { const current = await readChainIdentities(p); return planChainIdentity(current.brands, current.restaurants, batch); };
  afterAll(async () => {
    await p.restaurant.deleteMany({ where: { id: { in: restaurants } } });
    await p.chainItem.deleteMany({ where: { brandId: { in: brands } } });
    await p.brand.deleteMany({ where: { id: { in: brands } } });
    await p.pipelineCompletedHex.deleteMany({ where: { runId: scope } });
    await p.$disconnect();
  });
  test.each([false, true])("sparse menu or explicit store alias can be onboarded without replacing menu IDs (existing brand=%s)", async existing => {
    const id = randomUUID(), slug = `${scope}-${existing}`, displayName = `${scope} ${existing ? "Existing" : "New"} Cafe`;
    brands.push(id);
    const oldBrand = existing ? await p.brand.create({ data: { id, slug, displayName, detectionConf: "high" } }) : null;
    const name = existing ? `${displayName} #42` : displayName;
    const r = await createRestaurant(name, oldBrand?.id), original = await p.menuItem.create({ data: {
      restaurantId: r.id, name: "Chicken Bowl", section: "Bowls", description: "One fixed bowl", price: 12,
      calories: 400, proteinG: 20, carbsG: 50, fatG: 13, photoUrl: "https://example.com/photo", dietaryTags: ["fixture"] } });
    await p.macroEstimate.create({ data: { menuItemId: original.id, calories: 400, proteinG: 20, carbsG: 50, fatG: 13, source: "haiku", confidence: "MEDIUM" } });
    const before = await p.menuItem.findUniqueOrThrow({ where: { id: original.id }, include: { macroEstimates: { orderBy: { id: "asc" } } } });
    const item = aprilMenuIdentity(before), baselineRuntime = await loadChainServing(p);
    expect(baselineRuntime.brandId(r)).toBeUndefined();
    expect((await getMenuPage(p, r.id, { targets: facts, limit: 1 }))!.menuItems[0]!.macros?.calories).toBe(400);
    const batch: ChainIdentityBatch = { version: 1, reviewedBy: "Synthetic integration test", brands: [{ id, slug, displayName,
      expected: oldBrand ? identity(oldBrand) : null, addAliases: existing ? [name] : [], evidence }], links: [{ brandId: id, expected: r }] };
    const planned = await plan(batch), journal = await applyChainIdentity(p, planned);
    expect(journal.brands).toHaveLength(1); expect(journal.restaurants).toHaveLength(1);
    expect(await p.menuItem.findUniqueOrThrow({ where: { id: original.id }, include: { macroEstimates: { orderBy: { id: "asc" } } } })).toEqual(before);
    expect((await plan(batch)).brands).toEqual([]); expect((await plan(batch)).links).toEqual([]);
    // Identity alone cannot activate a chain or install unreviewed nutrition.
    expect((await loadChainServing(p)).brandId({ name })).toBeUndefined();
    const catalogBatch = { version: 1 as const, reviewedBy: "Synthetic writer test", changes: [{ slug, canonicalKey: "one-fixed-bowl", expected: null,
      facts: { ...facts, servingSize: "one synthetic bowl" }, source: { url: evidence.url, sha256: evidence.sha256 }, locator: evidence.locator, aliases: [item] }], quarantine: [] };
    const brand = await p.brand.findUniqueOrThrow({ where: { id } }), catalogPlan = planChainPilot([brand], [], catalogBatch);
    const catalogAfter = await applyCatalogPlan(p, catalogPlan, catalogBatch), runtime = await loadChainServing(p);
    const match = runtime.match(runtime.brandId({ name, brandId: id }), item);
    expect(match.status).toBe("matched"); if (match.status !== "matched") throw new Error("Missing reviewed match");
    const after = await applyAprilChainMatch(p, before, match.row);
    expect(after.id).toBe(original.id); expect(after).toMatchObject({ ...facts, price: original.price, photoUrl: original.photoUrl, dietaryTags: original.dietaryTags });
    expect((await getMenuPage(p, r.id, { targets: facts, limit: 1 }))!.menuItems[0]!.macros).toMatchObject({ ...facts, confidence: "HIGH" });
    // A genuinely new location begins without a Fitsy brand ID and uses the same main-pipeline adapters.
    const fresh = await createRestaurant(`${displayName} (New Hex)`), request = { ...fresh, storeUuid: fresh.storeUuid! };
    const { resolver, brandId } = chainMenuResolver(request, runtime);
    expect(brandId).toBe(id);
    const ue = { status: "success", data: { title: fresh.name, catalogSectionsMap: { menu: [{ payload: { standardItemsPayload: {
      title: { text: "Bowls" }, catalogItems: [{ title: item.name, itemDescription: item.description },
        { title: "New seasonal bowl" }, { title: "Second seasonal bowl" }] } } }] } } };
    const fetch = jest.spyOn(global, "fetch").mockImplementation(async () => new Response(JSON.stringify(ue)));
    let resolved;
    try { resolved = await resolver.resolve(request.name, "Fixture"); expect(fetch).toHaveBeenCalledTimes(1); } finally { fetch.mockRestore(); }
    const estimated: string[] = [], macros = await resolveChainMacros(resolved.items, brandId, runtime.match, async unmatched => {
      estimated.push(...unmatched.map(i => i.name)); return unmatched.map(() => ({ calories: 400, proteinG: 20, carbsG: 50, fatG: 13, source: "haiku", confidence: "MEDIUM", dietaryTags: [] }));
    });
    expect(estimated).toEqual(["New seasonal bowl", "Second seasonal bowl"]);
    await persistHex(scope, slug, [{ restaurantId: fresh.id, brandId: brandId!, menuHash: "synthetic-identity-replay", items: resolved.items.map((item, i) => ({ item, macro: macros[i]! })) }], p, { validateInTx: validateHexInTx });
    expect((await getMenuPage(p, fresh.id, { targets: facts, limit: 10 }))!.menuItems.find(i => i.name === item.name)!.macros).toMatchObject({ ...facts, confidence: "HIGH" });
    const writtenIdentity = await p.restaurant.findUniqueOrThrow({ where: { id: r.id }, select: restaurantIdentitySelect });
    if (!existing) {
      await expect(rollbackChainIdentity(p, journal)).rejects.toThrow("references");
      expect(await p.restaurant.findUniqueOrThrow({ where: { id: r.id }, select: restaurantIdentitySelect })).toEqual(writtenIdentity);
    }
    await rollbackAprilBatch(p, [{ before, after }]);
    await p.restaurant.delete({ where: { id: fresh.id } });
    await rollbackCatalogPlan(p, catalogPlan, catalogAfter);
    await rollbackChainIdentity(p, JSON.parse(JSON.stringify(journal)));
    expect(await p.restaurant.findUniqueOrThrow({ where: { id: r.id }, select: restaurantIdentitySelect })).toEqual(r);
    expect(await p.menuItem.findUniqueOrThrow({ where: { id: original.id }, include: { macroEstimates: { orderBy: { id: "asc" } } } })).toEqual(before);
    expect((await p.brand.findUnique({ where: { id } }))?.aliases ?? null).toEqual(oldBrand?.aliases ?? null);
  });
  test("collision, unreviewed locations, and concurrent edits fail before any identity mutation", async () => {
    const id = randomUUID(), slug = `${scope}-guarded`, displayName = `${scope} Guarded Cafe`; brands.push(id);
    const a = await createRestaurant(displayName), b = await createRestaurant(`${displayName} (Other Location)`);
    const batch: ChainIdentityBatch = { version: 1, reviewedBy: "Synthetic guards", brands: [{ id, slug, displayName, expected: null, addAliases: [], evidence }], links: [{ brandId: id, expected: a }] };
    await expect(plan(batch)).rejects.toThrow("Unreviewed restaurant");
    batch.links.push({ brandId: id, expected: b });
    const planned = await plan(batch);
    await p.restaurant.update({ where: { id: a.id }, data: { name: "Changed after review" } });
    await expect(applyChainIdentity(p, planned)).rejects.toThrow();
    expect(await p.brand.findUnique({ where: { id } })).toBeNull();
    expect((await p.restaurant.findUniqueOrThrow({ where: { id: b.id } })).brandId).toBeNull();
    await p.restaurant.update({ where: { id: a.id }, data: { name: a.name } });
    const collisionId = randomUUID(); brands.push(collisionId);
    await p.brand.create({ data: { id: collisionId, slug: `${scope}-collision`, displayName, detectionConf: "high" } });
    await expect(plan(batch)).rejects.toThrow("collides");
    await p.brand.delete({ where: { id: collisionId } });
    const journal = await applyChainIdentity(p, await plan(batch));
    await p.restaurant.update({ where: { id: b.id }, data: { name: "Changed after apply" } });
    await expect(rollbackChainIdentity(p, journal)).rejects.toThrow("Restaurant changed");
    expect((await p.restaurant.findUniqueOrThrow({ where: { id: a.id } })).brandId).toBe(id);
    await p.restaurant.update({ where: { id: b.id }, data: { name: b.name } });
    await rollbackChainIdentity(p, journal);
    expect(await p.brand.findUnique({ where: { id } })).toBeNull();
  });
  test("CLI binds private immutable plans and journals to the target and explicit hash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chain-identity-")), root = resolve(__dirname, "../../../.."), id = randomUUID(); brands.push(id);
    const displayName = `${scope} CLI Cafe`, r = await createRestaurant(displayName);
    const batch: ChainIdentityBatch = { version: 1, reviewedBy: "Synthetic CLI test", brands: [{ id, slug: `${scope}-cli`, displayName,
      expected: null, addAliases: [], evidence }], links: [{ brandId: id, expected: r }] };
    const batchFile = join(dir, "batch.json"), planFile = join(dir, "plan.json"); writeFileSync(batchFile, JSON.stringify(batch));
    const cli = (...args: string[]) => execFileSync(process.execPath, ["--import", "tsx", "scripts/preload-chain-identity.ts", ...args], {
      cwd: root, env: { ...process.env, POSTGRES_URL_NON_POOLING: process.env["POSTGRES_PRISMA_URL"] }, stdio: "pipe" }).toString();
    try {
      const report = JSON.parse(cli("plan", planFile, batchFile));
      expect(report).toMatchObject({ brands: 1, restaurantLinks: 1 });
      expect(statSync(planFile).mode & 0o777).toBe(0o600);
      expect(await p.brand.findUnique({ where: { id } })).toBeNull();
      expect(() => cli("plan", planFile, batchFile)).toThrow();
      expect(() => cli("apply", planFile, "wrong-hash")).toThrow();
      const mismatched = join(dir, "wrong-target.json"), doc = JSON.parse(readFileSync(planFile, "utf8"));
      writeFileSync(mismatched, JSON.stringify({ ...doc, target: "different-target" }));
      expect(() => cli("apply", mismatched, report.hash)).toThrow();
      expect(await p.brand.findUnique({ where: { id } })).toBeNull();
      expect(JSON.parse(cli("apply", planFile, report.hash))).toEqual({ brands: 1, restaurantLinks: 1 });
      expect(() => cli("apply", planFile, report.hash)).toThrow();
      expect(JSON.parse(cli("plan", join(dir, "noop.json"), batchFile))).toMatchObject({ brands: 0, restaurantLinks: 0 });
      expect(JSON.parse(cli("rollback", planFile + ".applied.json", report.hash))).toEqual({ rolledBackBrands: 1, rolledBackRestaurantLinks: 1 });
      expect(await p.brand.findUnique({ where: { id } })).toBeNull();
      expect(await p.restaurant.findUniqueOrThrow({ where: { id: r.id }, select: restaurantIdentitySelect })).toEqual(r);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 30000);
});
