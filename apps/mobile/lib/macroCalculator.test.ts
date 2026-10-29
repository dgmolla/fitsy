import { calculateDailyMacros, calculateMacros, dailyToPerMealMacros } from './macroCalculator';
import { calculateSettledDailyMacros } from '../../../packages/shared/src/utils/macroTargets';
import type { Goal } from './onboardingStorage';

const goals: Goal[] = ['build_muscle', 'lose_fat', 'performance', 'maintain'];

describe('adult macro recommendations', () => {
  test.each([
    ['build_muscle', 2400, 90, 330, 80],
    ['lose_fat', 2000, 70, 280, 200 / 3],
    ['performance', 2800, 91, 434, 700 / 9],
    ['maintain', 2000, 60, 290, 200 / 3],
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
      expect(proteinShare).toBeLessThanOrEqual(0.16);
      expect(carbShare).toBeGreaterThanOrEqual(0.45);
      expect(carbShare).toBeLessThanOrEqual(0.65);
      expect(fatShare).toBeGreaterThanOrEqual(0.2);
      expect(fatShare).toBeLessThanOrEqual(0.35);
      expect(daily.protein * 4 + daily.carbs * 4 + daily.fat * 9).toBeCloseTo(calories);
    }
  });

  test('retains 3.5 meal equivalents and rounds only after division', () => {
    expect(dailyToPerMealMacros(calculateDailyMacros(2400, 'build_muscle'))).toEqual({
      calories: 687, protein: 26, carbs: 94, fat: 23,
    });
    expect(dailyToPerMealMacros({ calories: 2000, protein: 120.6, carbs: 250, fat: 60 }).protein).toBe(34);
  });

  test.each([
    ['maintain', { calories: 753, protein: 23, carbs: 109, fat: 25 }],
    ['build_muscle', { calories: 819, protein: 31, carbs: 113, fat: 27 }],
    ['lose_fat', { calories: 604, protein: 21, carbs: 85, fat: 20 }],
    ['performance', { calories: 757, protein: 25, carbs: 117, fat: 21 }],
  ] as const)('profile calculation delivers the reference %s meal without native or auth mocks', (goal, expected) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00Z'));
    try {
      expect(calculateMacros({ goal, birthday: '1996-01-15', weightKg: 75, heightCm: 175, activity: 'active', sex: 'male' })).toEqual(expected);
    } finally { jest.useRealTimers(); }
  });

  test.each(goals)('%s stays at or below 40 g per meal over every generated daily calorie', goal => {
    for (let calories = 1200; calories <= 3500; calories++) {
      const meal = dailyToPerMealMacros(calculateSettledDailyMacros(calories, goal));
      expect(meal.protein).toBeLessThanOrEqual(40);
      expect(meal.calories).toBe(meal.protein * 4 + meal.carbs * 4 + meal.fat * 9);
    }
  });

  test.each([NaN, Infinity, -Infinity, 0, -100])('invalid calorie value %s falls back to 2000', (calories) => {
    expect(calculateDailyMacros(calories)).toEqual(calculateDailyMacros(2000));
  });
});
