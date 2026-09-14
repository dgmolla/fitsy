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

  it("excludes dedicated supply sections while preserving food in mixed sections", async () => {
    // These three titles and their section reproduce a retained Stonefire UE menu.
    const supplies = ["PAPER PLATES", "PLASTIC CUTLERY", "TONGS"];
    const unfamiliarSupply = "Disposable Dinnerware Set";
    const foods = ["Chicken Plate", "Rice Paper Rolls", "Roasted Vegetables", "Stir-Fry Noodles", "Mild Salsa", "Cold Brew"];
    const drinkware = ["2025 Nomad Tmblr Blk 24oz", "2025 Cold Brew Glass 18oz", "Ovalware Cold Brew Maker"];
    const misplacedCondiments = ["Ketchup", "Hot Sauce", "Steak Sauce", "Butter", "Syrup", "Mayonnaise", "Mustard"];
    const section = (title: string, names: string[]) => ({ payload: { standardItemsPayload: {
      title: { text: title }, catalogItems: names.map(name => ({ uuid: randomUUID(), title: name, price: 100 })),
    } } });
    const captured = { status: "success", data: { title: "Stonefire filter fixture", catalogSectionsMap: {
      supplies: [section("UTENSILS AND PAPER GOODS", supplies), section(" Cutlery / Paper Supplies ", [unfamiliarSupply])],
      food: [section("Sides and Utensils", [foods[0]!]), section("Rice Paper Rolls", [foods[1]!]),
        section("Utensil-inspired Specials", [foods[2]!]), section("Hot Meals", [foods[3]!]),
        section("SALSA BAR & UTENSILS", [foods[4]!]), section("Drinks & Merchandise", [foods[5]!])],
      // Banda Burrito lists its stir stick alongside drinks, without a supply section.
      drinks: [section("Beverages", ["Stir Stick"])],
      condiments: [section("Condiments", ["Coffee Stirrer"])],
      // Peet's drinkware titles need their section to distinguish them from drinks.
      merchandise: [section("Merchandise|Drinkware", drinkware)],
      // NORMS places edible condiments in a section titled Utensils.
      misplaced: [section("Utensils", misplacedCondiments)],
    } } };
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify(captured)));
    let menu;
    try {
      menu = await new UeApiDirectSource(randomUUID()).lookup("Stonefire filter fixture", "Fixture");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
    expect(menu.items.map(item => item.name)).toEqual([...supplies, unfamiliarSupply, ...foods, "Stir Stick", "Coffee Stirrer", ...drinkware, ...misplacedCondiments]);
    const macros = menu.items.map(() => ({ calories: 400, proteinG: 20, carbsG: 50, fatG: 13,
      source: "haiku", confidence: "MEDIUM" as const, dietaryTags: [] }));
    const { valid, rejected } = validateItems(menu.items, macros);
    const restaurant = await p.restaurant.create({ data: { name: "Stonefire filter fixture", storeUuid: randomUUID(),
      source: "ue_feed", address: "Fixture", lat: 34, lng: -118, cuisineTags: [] } });
    restaurantIds.push(restaurant.id);
    await persistHex(scope, "supply-section-filter", [{ restaurantId: restaurant.id, menuHash: "fixture", items: valid }], p,
      { validateInTx: validateHexInTx });
    const page = await getMenuPage(p, restaurant.id, { limit: 250 });
    const edible = [...foods, ...misplacedCondiments];
    expect(page?.menuItems.map(item => item.name).sort()).toEqual([...edible].sort());
    expect(await p.menuItem.count({ where: { restaurantId: restaurant.id } })).toBe(edible.length);
    expect(await p.macroEstimate.count({ where: { menuItem: { restaurantId: restaurant.id } } })).toBe(edible.length);
    expect(rejected).toEqual([
      ...[...supplies, unfamiliarSupply].map(name => ({ name, reason: "non-food: supply or merchandise section" })),
      { name: "Stir Stick", reason: "non-food: utensil" },
      { name: "Coffee Stirrer", reason: "non-food: utensil" },
      ...drinkware.map(name => ({ name, reason: "non-food: supply or merchandise section" })),
    ]);
  });
});
