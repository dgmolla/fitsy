import { validateItems } from "./pipeline-utils";
import type { MacroData, StructuredMenuItem } from "../apps/api/services/menuSources/types";

function makeMacro(overrides: Partial<MacroData> = {}): MacroData {
  return { calories: 500, proteinG: 30, carbsG: 50, fatG: 20, confidence: "MEDIUM", source: "haiku", dietaryTags: [], ...overrides };
}
function makeItem(name: string, overrides: Partial<StructuredMenuItem> = {}): StructuredMenuItem {
  return { name, ...overrides };
}

describe("food filter regressions from chain ingestion", () => {
  it.each([242, 35, 400, 0])("rejects standalone donations regardless of estimated calories (%i)", (calories) => {
    const items = [
      makeItem("Round Up Toy Donation $3"),
      makeItem("Round Up Toy Donation $1"),
      makeItem("Donation"),
      makeItem("Donation $2.50"),
      makeItem("round-up donation $1"),
    ];
    const result = validateItems(items, items.map(() => makeMacro({ calories })));
    expect(result.valid).toEqual([]);
    expect(result.rejected).toEqual(items.map(({ name }) => ({ name, reason: "non-food: donation" })));
  });

  it("preserves food sold for charity and meals that include toys", () => {
    const items = [
      makeItem("Chicken Bowl", { description: "$1 donation from every purchase", section: "Charity" }),
      makeItem("Donation Burger"),
      makeItem("Donated Meal"),
      makeItem("Kids Meal with Toy"),
    ];
    const result = validateItems(items, items.map(() => makeMacro()));
    expect(result.valid.map(({ item }) => item)).toEqual(items);
    expect(result.rejected).toEqual([]);
  });

  it("keeps zero-calorie Pepsi drinks whose titles omit generic beverage words", () => {
    const items = [makeItem("12oz Diet Pepsi® Can"), makeItem("Diet Pepsi"), makeItem("20 fl oz Pepsi Zero Sugar Bottle")];
    const result = validateItems(items, items.map(() => makeMacro({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, source: "official", confidence: "HIGH" })));
    expect(result.valid.map(({ item }) => item)).toEqual(items);
    expect(result.rejected).toEqual([]);
  });

  it("does not treat a Pepsi reference as proof that a zero-calorie item is a drink", () => {
    const items = [makeItem("Pepsi Logo Sign"), makeItem("Pepsi Cake"), makeItem("Mystery Item", { description: "Enjoy with Pepsi" })];
    const result = validateItems(items, items.map(() => makeMacro({ calories: 0 })));
    expect(result.valid).toEqual([]);
    expect(result.rejected).toHaveLength(items.length);
  });

});
