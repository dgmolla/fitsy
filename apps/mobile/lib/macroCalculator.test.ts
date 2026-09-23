import { calculateDailyMacros, calculateMacros, dailyToPerMealMacros, MEALS_PER_DAY } from './macroCalculator';
import { calculateSuggestedCalories, type Goal } from './onboardingStorage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

const goals: Goal[] = ['build_muscle', 'lose_fat', 'performance', 'maintain'];

describe('adult macro recommendations', () => {
  test.each([
    ['build_muscle', 2400, 150, 270, 80],
    ['lose_fat', 2000, 125, 225, 200 / 3],
    ['performance', 2800, 140, 385, 700 / 9],
    ['maintain', 2000, 100, 250, 200 / 3],
  ] as const)('%s has balanced daily targets', (goal, calories, protein, carbs, fat) => {
    const daily = calculateDailyMacros(calories, goal);
    expect(daily.calories).toBe(calories);
    expect(daily.protein).toBeCloseTo(protein);
    expect(daily.carbs).toBeCloseTo(carbs);
    expect(daily.fat).toBeCloseTo(fat);
  });

  test.each(goals)('%s stays within adult macro ranges across supported calorie budgets', (goal) => {
    for (const calories of [1200, 1800, 2400, 3000, 3500]) {
      const daily = calculateDailyMacros(calories, goal);
      const proteinShare = daily.protein * 4 / calories;
      const carbShare = daily.carbs * 4 / calories;
      const fatShare = daily.fat * 9 / calories;
      expect(proteinShare).toBeGreaterThanOrEqual(0.1);
      expect(proteinShare).toBeLessThanOrEqual(0.25);
      expect(carbShare).toBeGreaterThanOrEqual(0.45);
      expect(carbShare).toBeLessThanOrEqual(0.65);
      expect(fatShare).toBeGreaterThanOrEqual(0.2);
      expect(fatShare).toBeLessThanOrEqual(0.35);
      expect(daily.protein * 4 + daily.carbs * 4 + daily.fat * 9).toBeCloseTo(calories);
    }
  });

  test('retains 3.5 meal equivalents and rounds only after division', () => {
    expect(MEALS_PER_DAY).toBe(3.5);
    expect(dailyToPerMealMacros(calculateDailyMacros(2400, 'build_muscle'))).toEqual({
      calories: 686, protein: 43, carbs: 77, fat: 23,
    });
    expect(dailyToPerMealMacros({ calories: 2000, protein: 120.6, carbs: 250, fat: 60 }).protein).toBe(34);
  });

  test.each(goals)('profile calculation uses shared %s policy and calorie calculation', (goal) => {
    const profile = { goal, weightKg: 75, heightCm: 170 };
    expect(calculateMacros(profile)).toEqual(
      dailyToPerMealMacros(calculateDailyMacros(calculateSuggestedCalories(profile), goal)),
    );
  });

  test.each([NaN, Infinity, -Infinity, 0, -100])('invalid calorie value %s falls back to 2000', (calories) => {
    expect(calculateDailyMacros(calories)).toEqual(calculateDailyMacros(2000));
  });
});
