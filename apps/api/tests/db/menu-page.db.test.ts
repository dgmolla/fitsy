import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { getMenuPage } from "../../lib/restaurantMenuService";
const suite = process.env["POSTGRES_PRISMA_URL"] ? describe : describe.skip;
suite("menu page SQL through Prisma", () => {
  const p = new PrismaClient(), id = randomUUID(), other = randomUUID();
  const targets = { calories: 500, proteinG: 40, carbsG: 40, fatG: 20 };
  beforeAll(async () => {
    for (const restaurantId of [id, other]) await p.restaurant.create({ data: { id: restaurantId, storeUuid: randomUUID(), name: "Menu fixture", address: "Fixture", lat: 34, lng: -118, cuisineTags: [], source: "fixture", rating: 4.5, userRatingCount: 21 } });
    await p.menuItem.createMany({ data: [
      { id: id + "a", restaurantId: id, name: "Near", description: "Full description", category: "Entree", price: 12, calories: 600, proteinG: 45, carbsG: 55, fatG: 21 },
      { id: id + "b", restaurantId: id, name: "Exact", ...targets },
      { id: id + "c", restaurantId: id, name: "Incomplete", calories: 500, proteinG: 40, carbsG: 40 },
      { id: other + "b", restaurantId: other, name: "Other restaurant", ...targets },
    ] });
    await p.macroEstimate.createMany({ data: [
      { menuItemId: id + "a", source: "haiku", confidence: "LOW", calories: 600, proteinG: 45, carbsG: 55, fatG: 21, estimatedAt: new Date("2026-08-01") },
      { menuItemId: id + "a", source: "merchant", confidence: "HIGH", hadPhoto: true, calories: 600, proteinG: 45, carbsG: 55, fatG: 21, estimatedAt: new Date("2026-07-01") },
    ] });
  });
  afterAll(async () => { await p.restaurant.deleteMany({ where: { id: { in: [id, other] } } }); await p.$disconnect(); });
  test("all items are scored, paged once and paired with the winning metadata", async () => {
    const first = (await getMenuPage(p, id, { targets, limit: 1 }))!;
    expect(first).toMatchObject({ restaurantId: id, restaurantName: "Menu fixture", locked: false, totalItemCount: 3, rating: 4.5, userRatingCount: 21 });
    expect(first.menuItems).toEqual([{ id: id + "b", name: "Exact", macros: { ...targets, confidence: "LOW", hadPhoto: false, estimatedAt: "" } }]);
    const second = (await getMenuPage(p, id, { targets, limit: 1, cursor: first.nextCursor! }))!;
    expect(second.menuItems).toEqual([{ id: id + "a", name: "Near", description: "Full description", category: "Entree", price: 12,
      macros: { calories: 600, proteinG: 45, carbsG: 55, fatG: 21, confidence: "HIGH", hadPhoto: true, estimatedAt: "2026-07-01T00:00:00.000Z" } }]);
    const third = (await getMenuPage(p, id, { targets, limit: 1, cursor: second.nextCursor! }))!;
    expect(third.menuItems).toEqual([{ id: id + "c", name: "Incomplete", macros: null }]);
    expect(third.nextCursor).toBeNull();
  });
  test("selection, inactive targets, absent restaurants and invalid cursor numbers keep their contracts", async () => {
    expect((await getMenuPage(p, id))!.menuItems.map(m => m.id)).toEqual([id + "a", id + "b", id + "c"]);
    const first = (await getMenuPage(p, id, { targets, selectedItemId: id + "a", limit: 1 }))!;
    expect(first.menuItems[0]!.id).toBe(id + "a");
    expect((await getMenuPage(p, id, { targets, selectedItemId: id + "a", cursor: first.nextCursor!, limit: 1 }))!.menuItems[0]!.id).toBe(id + "b");
    expect(await getMenuPage(p, randomUUID())).toBeNull();
    for (const cursor of ["not-json", Buffer.from(JSON.stringify({ id: "a", score: "1e400", key: "wrong" })).toString("base64url")]) {
      await expect(getMenuPage(p, id, { cursor })).rejects.toThrow("Invalid menu cursor");
    }
  });
  test("cursor context and each numeric/type guard reject with an otherwise valid cursor", async () => {
    const first = (await getMenuPage(p, id, { targets, limit: 1 }))!;
    const original = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString());
    for (const patch of [{ id: 7 }, { score: 0 }, { score: "junk0" }, { score: "0junk" }, { score: "1e400" }, { score: "1e-400" }, { key: "wrong" }]) {
      const cursor = Buffer.from(JSON.stringify({ ...original, ...patch })).toString("base64url");
      await expect(getMenuPage(p, id, { targets, cursor })).rejects.toThrow("Invalid menu cursor");
    }
    for (const dimension of ["calories", "proteinG", "carbsG", "fatG"] as const) {
      await expect(getMenuPage(p, id, { targets: { ...targets, [dimension]: 1 }, cursor: first.nextCursor! })).rejects.toThrow("Invalid menu cursor");
    }
    await expect(getMenuPage(p, id, { targets, selectedItemId: id + "a", cursor: first.nextCursor! })).rejects.toThrow("Invalid menu cursor");
    await expect(getMenuPage(p, other, { targets, cursor: first.nextCursor! })).rejects.toThrow("Invalid menu cursor");
  });
  test("any missing nutrient prevents a partial macro object; absent ratings are omitted", async () => {
    for (const key of ["calories", "proteinG", "carbsG", "fatG"] as const) {
      await p.menuItem.update({ where: { id: id + "b" }, data: { [key]: null } });
      expect((await getMenuPage(p, id))!.menuItems.find(m => m.id === id + "b")!.macros).toBeNull();
      await p.menuItem.update({ where: { id: id + "b" }, data: { [key]: targets[key] } });
    }
    await p.restaurant.update({ where: { id }, data: { rating: null, userRatingCount: null } });
    const page = (await getMenuPage(p, id))!;
    expect("rating" in page).toBe(false); expect("userRatingCount" in page).toBe(false);
  });

});
