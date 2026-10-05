import { calculateTdee } from "./tdeeCalculator";

describe("calculateTdee", () => {
  // Reference: age=30, height=175cm, weight=75kg, sedentary, maintain, no sex.
  // With no sex we use the neutral -78 term:
  // BMR = 10*75 + 6.25*175 - 5*30 - 78 = 750 + 1093.75 - 150 - 78 = 1615.75
  // TDEE = 1615.75 * 1.2 = 1938.9 -> 1939 (rounded) + 0 = 1939
  const BASE_CASE = {
    age: 30,
    heightCm: 175,
    weightKg: 75,
    activityLevel: "sedentary" as const,
    goal: "maintain" as const,
  };

  it("calculates BMR and TDEE for maintain + sedentary (no sex → neutral)", () => {
    const result = calculateTdee(
      BASE_CASE.age,
      BASE_CASE.heightCm,
      BASE_CASE.weightKg,
      BASE_CASE.activityLevel,
      BASE_CASE.goal,
    );
    expect(Math.abs(result.calories - 1939)).toBeLessThanOrEqual(9);
    expect(result.calories).toBe(result.proteinG * 4 + result.carbsG * 4 + result.fatG * 9);
  });

  it("applies the sex term: +5 male / -161 female / -78 unknown", () => {
    const male = calculateTdee(30, 175, 75, "sedentary", "maintain", "male");
    const female = calculateTdee(30, 175, 75, "sedentary", "maintain", "female");
    const unknown = calculateTdee(30, 175, 75, "sedentary", "maintain");
    expect(Math.abs(male.calories - 2039)).toBeLessThanOrEqual(9);
    expect(Math.abs(female.calories - 1839)).toBeLessThanOrEqual(9);
    expect(Math.abs(unknown.calories - 1939)).toBeLessThanOrEqual(9);
  });

  it("applies -500 offset for lose_fat goal", () => {
    const maintain = calculateTdee(30, 175, 75, "sedentary", "maintain");
    const loseFat = calculateTdee(30, 175, 75, "sedentary", "lose_fat");
    expect(Math.abs(loseFat.calories - (maintain.calories - 500))).toBeLessThanOrEqual(9);
  });

  it("applies +300 offset for build_muscle goal", () => {
    const maintain = calculateTdee(30, 175, 75, "sedentary", "maintain");
    const buildMuscle = calculateTdee(30, 175, 75, "sedentary", "build_muscle");
    expect(Math.abs(buildMuscle.calories - (maintain.calories + 300))).toBeLessThanOrEqual(9);
  });

  it("applies activity multipliers correctly", () => {
    const sedentary = calculateTdee(30, 175, 75, "sedentary", "maintain");
    const veryActive = calculateTdee(30, 175, 75, "very_active", "maintain");
    // very_active multiplier 1.725 vs sedentary 1.2
    expect(veryActive.calories).toBeGreaterThan(sedentary.calories);
  });

  it("returns macro split with tuned maintenance ratios (12/58/30)", () => {
    const result = calculateTdee(30, 175, 75, "active", "maintain");
    const rawCalories = Math.round((10 * 75 + 6.25 * 175 - 5 * 30 - 78) * 1.55);
    const expectedProtein = Math.round((rawCalories * 0.12) / 4);
    const expectedCarbs = Math.round((rawCalories * 0.58) / 4);
    const expectedFat = Math.round((rawCalories * 0.3) / 9);
    expect(result.proteinG).toBe(expectedProtein);
    expect(result.carbsG).toBe(expectedCarbs);
    expect(result.fatG).toBe(expectedFat);
    expect(result.calories).toBe(result.proteinG * 4 + result.carbsG * 4 + result.fatG * 9);
  });

  it("all macros are positive numbers", () => {
    const result = calculateTdee(25, 165, 65, "lightly_active", "lose_fat");
    expect(result.proteinG).toBeGreaterThan(0);
    expect(result.carbsG).toBeGreaterThan(0);
    expect(result.fatG).toBeGreaterThan(0);
  });
});

test("performance retains maintenance calories and prioritizes carbohydrate", () => {
  const result = calculateTdee(30, 175, 75, "active", "performance");
  const maintain = calculateTdee(30, 175, 75, "active", "maintain");
  expect(Math.abs(result.calories - maintain.calories)).toBeLessThanOrEqual(9);
  const rawCalories = Math.round((10 * 75 + 6.25 * 175 - 5 * 30 - 78) * 1.55);
  expect(result.proteinG).toBe(Math.round(rawCalories * 0.13 / 4));
  expect(result.carbsG).toBe(Math.round(rawCalories * 0.62 / 4));
  expect(result.fatG).toBe(Math.round(rawCalories * 0.25 / 9));
});

test('fallback profiles and supported extremes stay within 40 g per meal without a protein cap', () => {
  for (const age of [18, 30, 70]) for (const weight of [45, 75, 180])
    for (const activity of ['sedentary', 'lightly_active', 'active', 'very_active'] as const)
      for (const goal of ['build_muscle', 'lose_fat', 'performance', 'maintain'] as const) {
        const result = calculateTdee(age, 175, weight, activity, goal);
        expect(Math.round(result.proteinG / 3.5)).toBeLessThanOrEqual(40);
        expect(result.calories).toBe(result.proteinG * 4 + result.carbsG * 4 + result.fatG * 9);
      }
});
