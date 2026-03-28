import { calculateTdee } from "./tdeeCalculator";

describe("calculateTdee", () => {
  // Reference: age=30, height=175cm, weight=75kg, sedentary, maintain
  // BMR = 10*75 + 6.25*175 - 5*30 + 5 = 750 + 1093.75 - 150 + 5 = 1698.75
  // TDEE = 1698.75 * 1.2 = 2038.5 -> 2039 (rounded) + 0 = 2039
  const BASE_CASE = {
    age: 30,
    heightCm: 175,
    weightKg: 75,
    activityLevel: "sedentary" as const,
    goal: "maintain" as const,
  };

  it("calculates BMR and TDEE for maintain + sedentary", () => {
    const result = calculateTdee(
      BASE_CASE.age,
      BASE_CASE.heightCm,
      BASE_CASE.weightKg,
      BASE_CASE.activityLevel,
      BASE_CASE.goal,
    );
    expect(result.calories).toBe(2039);
  });

  it("applies -500 offset for lose_fat goal", () => {
    const maintain = calculateTdee(30, 175, 75, "sedentary", "maintain");
    const loseFat = calculateTdee(30, 175, 75, "sedentary", "lose_fat");
    expect(loseFat.calories).toBe(maintain.calories - 500);
  });

  it("applies +300 offset for build_muscle goal", () => {
    const maintain = calculateTdee(30, 175, 75, "sedentary", "maintain");
    const buildMuscle = calculateTdee(30, 175, 75, "sedentary", "build_muscle");
    expect(buildMuscle.calories).toBe(maintain.calories + 300);
  });

  it("applies activity multipliers correctly", () => {
    const sedentary = calculateTdee(30, 175, 75, "sedentary", "maintain");
    const veryActive = calculateTdee(30, 175, 75, "very_active", "maintain");
    // very_active multiplier 1.725 vs sedentary 1.2
    expect(veryActive.calories).toBeGreaterThan(sedentary.calories);
  });

  it("returns macro split with correct ratios (30/40/30)", () => {
    const result = calculateTdee(30, 175, 75, "active", "maintain");
    // protein = 30% of cals / 4 kcal/g
    const expectedProtein = Math.round((result.calories * 0.3) / 4);
    const expectedCarbs = Math.round((result.calories * 0.4) / 4);
    const expectedFat = Math.round((result.calories * 0.3) / 9);
    expect(result.proteinG).toBe(expectedProtein);
    expect(result.carbsG).toBe(expectedCarbs);
    expect(result.fatG).toBe(expectedFat);
  });

  it("all macros are positive numbers", () => {
    const result = calculateTdee(25, 165, 65, "lightly_active", "lose_fat");
    expect(result.proteinG).toBeGreaterThan(0);
    expect(result.carbsG).toBeGreaterThan(0);
    expect(result.fatG).toBeGreaterThan(0);
  });
});
