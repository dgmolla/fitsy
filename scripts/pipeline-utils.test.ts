jest.mock("./constants", () => ({
  aggregateDietaryOptions: jest.fn().mockReturnValue([]),
}));

import { validateItems } from "./pipeline-utils";
import type { MacroData, StructuredMenuItem } from "../apps/api/services/menuSources/types";

function makeMacro(overrides: Partial<MacroData> = {}): MacroData {
  return {
    calories: 500,
    proteinG: 30,
    carbsG: 50,
    fatG: 20,
    confidence: "MEDIUM",
    source: "haiku",
    dietaryTags: [],
    ...overrides,
  };
}

function makeItem(name: string, overrides: Partial<StructuredMenuItem> = {}): StructuredMenuItem {
  return { name, ...overrides };
}

describe("validateItems", () => {
  it("passes normal food items through", () => {
    const items = [makeItem("Chicken Teriyaki Bowl")];
    const macros = [makeMacro()];
    const { valid, rejected } = validateItems(items, macros);
    expect(valid).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("rejects merchandise items", () => {
    const items = [makeItem("Pine & Crane T-Shirt"), makeItem("Logo Hoodie"), makeItem("Ceramic Mug")];
    const macros = items.map(() => makeMacro());
    const { valid, rejected } = validateItems(items, macros);
    expect(valid).toHaveLength(0);
    expect(rejected).toHaveLength(3);
    expect(rejected.every((r) => r.reason === "non-food: merchandise")).toBe(true);
  });

  it("rejects utensil items", () => {
    const items = [makeItem("Bamboo Chopstick Set"), makeItem("Extra Fork")];
    const macros = items.map(() => makeMacro());
    const { valid, rejected } = validateItems(items, macros);
    expect(valid).toHaveLength(0);
    expect(rejected).toHaveLength(2);
    expect(rejected.every((r) => r.reason === "non-food: utensil")).toBe(true);
  });

  it("rejects zero-cal non-beverage items", () => {
    const items = [makeItem("Decorative Topping")];
    const macros = [makeMacro({ calories: 0 })];
    const { valid, rejected } = validateItems(items, macros);
    expect(valid).toHaveLength(0);
    expect(rejected[0]!.reason).toBe("non-food: zero calories");
  });

  it("allows zero-cal beverages", () => {
    const items = [makeItem("Sparkling Water"), makeItem("Unsweetened Iced Tea"), makeItem("Black Coffee")];
    const macros = items.map(() => makeMacro({ calories: 0 }));
    const { valid, rejected } = validateItems(items, macros);
    expect(valid).toHaveLength(3);
    expect(rejected).toHaveLength(0);
  });

  it("rejects condiments under 30 cal", () => {
    const items = [makeItem("Ketchup Packet"), makeItem("Soy Sauce"), makeItem("Mayo")];
    const macros = items.map(() => makeMacro({ calories: 15 }));
    const { valid, rejected } = validateItems(items, macros);
    expect(valid).toHaveLength(0);
    expect(rejected.every((r) => r.reason === "condiment")).toBe(true);
  });

  it("allows condiment-named items with >= 30 cal (e.g. large sauce portions)", () => {
    const items = [makeItem("Hot Sauce Wings")];
    const macros = [makeMacro({ calories: 350 })];
    const { valid, rejected } = validateItems(items, macros);
    expect(valid).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("skips items with null macros", () => {
    const items = [makeItem("Mystery Item"), makeItem("Good Burger")];
    const macros: (MacroData | null)[] = [null, makeMacro()];
    const { valid, rejected } = validateItems(items, macros);
    expect(valid).toHaveLength(1);
    expect(valid[0]!.item.name).toBe("Good Burger");
  });

  it("handles mixed valid and invalid items", () => {
    const items = [
      makeItem("Pad Thai"),
      makeItem("Logo Tote Bag"),
      makeItem("Sparkling Water"),
      makeItem("Ketchup Packet"),
      makeItem("Grilled Salmon"),
    ];
    const macros = [
      makeMacro({ calories: 600 }),
      makeMacro({ calories: 0 }),
      makeMacro({ calories: 0 }),
      makeMacro({ calories: 10 }),
      makeMacro({ calories: 450 }),
    ];
    const { valid, rejected } = validateItems(items, macros);
    expect(valid).toHaveLength(3); // Pad Thai, Sparkling Water, Grilled Salmon
    expect(rejected).toHaveLength(2); // Tote Bag, Ketchup Packet
  });
});
