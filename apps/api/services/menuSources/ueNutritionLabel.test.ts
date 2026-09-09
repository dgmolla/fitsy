import { ueNutritionLabel } from "./ueNutritionLabel";
import { parseStoreV1Response } from "./ueApiClient";
import { capturedChainPilot } from "../../tests/fixtures/chain-pilot";
test("captured WaBa and Yoshinoya labels survive the actual UE parser", () => {
  expect(capturedChainPilot.map(f => parseStoreV1Response(f.ue)?.items[0])).toEqual([
    expect.objectContaining({ name: "Chicken Plate", section: "Plates", calories: 820, calorieLabel: "820 Cal.", hasCustomizations: true }),
    expect.objectContaining({ name: "Original Gyudon Beef", section: "Featured items", calories: 310, calorieLabel: "310 Cal.", hasCustomizations: false }),
  ]);
});
test.each(["$8 • 640–760 Cal.", "$8 • 640-760 Calories"])("ranges remain ranges: %s", text => {
  expect(ueNutritionLabel(text, true)).toMatchObject({ calorieRange: [640, 760], hasCustomizations: true });
  expect(ueNutritionLabel(text, true).calories).toBeUndefined();
});
test.each(["$8 • 500+ Cal.", "$8 • 500 Cal. • 700 Cal.", "$8 • 900-600 Cal.", "$8 • 100001 Cal.", "$8 • -10 Cal."])
("unsupported labels retain evidence without inventing an exact serving: %s", text => {
  expect(ueNutritionLabel(text, undefined)).toEqual({ calorieLabel: expect.any(String) });
});
test("prices are never calories; separators, zero, thousands and decimals are supported", () => {
  expect(ueNutritionLabel("$8.20", undefined)).toEqual({});
  expect(ueNutritionLabel("$8 · 1,050 Calories", false)).toMatchObject({ calories: 1050 });
  expect(ueNutritionLabel("646.4 Cal.", undefined)).toMatchObject({ calories: 646.4 });
  expect(ueNutritionLabel("0 Cal.", undefined)).toMatchObject({ calories: 0 });
});
