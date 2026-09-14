import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { UeApiDirectSource } from "../../services/menuSources/ueApiDirectSource";
import { getMenuPage } from "../../lib/restaurantMenuService";
import { validateItems } from "../../../../scripts/pipeline-utils";
import { persistHex } from "../../../../scripts/hex-persist";
import { validateHexInTx } from "../../../../scripts/preload-invariants";

const suite = process.env["POSTGRES_PRISMA_URL"] ? describe : describe.skip;

suite("UE supply preferences through menu persistence and serving", () => {
  const p = new PrismaClient(), scope = randomUUID();
  const restaurantIds: string[] = [];

  afterAll(async () => {
    await p.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
    await p.pipelineCompletedHex.deleteMany({ where: { runId: scope } });
    await p.$disconnect();
  });

  it("excludes plural utensils even when estimation gives them positive calories", async () => {
    // The first supply title/section reproduce a retained Tocaya getStoreV1 menu.
    // Remaining labels exercise regular plurals, knives, and word boundaries.
    const supplies = ["Yes, I would like utensils!", "Bamboo Chopsticks", "Extra Forks",
      "Plastic Spoons", "Knives", "Extra Napkins", "Paper Straws", "Containers",
      "Extra Lids", "Cup Sleeves"];
    const foods = ["SALMON BOWL", "Strawberry Shortcake", "Spoonful of Chili", "Caprese Salad"];
    const section = (title: string, names: string[]) => ({ payload: { standardItemsPayload: {
      title: { text: title }, catalogItems: names.map(name => ({ uuid: randomUUID(), title: name, price: 100 })),
    } } });
    const captured = { status: "success", data: { title: "Menu filter fixture", catalogSectionsMap: {
      foods: [section("Bowls", foods)], supplies: [section("paper supplies", supplies)],
    } } };
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify(captured)));
    let menu;
    try {
      menu = await new UeApiDirectSource(randomUUID()).lookup("Menu filter fixture", "Fixture");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
    expect(menu.items.map(item => item.name)).toEqual([...foods, ...supplies]);
    const macros = menu.items.map(() => ({ calories: 400, proteinG: 20, carbsG: 50, fatG: 13,
      source: "haiku", confidence: "MEDIUM" as const, dietaryTags: [] }));
    const { valid, rejected } = validateItems(menu.items, macros);
    const restaurant = await p.restaurant.create({ data: { name: "Menu filter fixture", storeUuid: randomUUID(),
      source: "ue_feed", address: "Fixture", lat: 34, lng: -118, cuisineTags: [] } });
    restaurantIds.push(restaurant.id);
    await persistHex(scope, "food-filter", [{ restaurantId: restaurant.id, menuHash: "fixture", items: valid }], p,
      { validateInTx: validateHexInTx });
    const page = await getMenuPage(p, restaurant.id, { limit: 250 });
    expect(page?.menuItems.map(item => item.name).sort()).toEqual([...foods].sort());
    expect(await p.menuItem.count({ where: { restaurantId: restaurant.id } })).toBe(foods.length);
    expect(await p.macroEstimate.count({ where: { menuItem: { restaurantId: restaurant.id } } })).toBe(foods.length);
    expect(rejected).toEqual(supplies.map(name => ({ name, reason: "non-food: utensil" })));
  });
});
