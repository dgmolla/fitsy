import { calculateDailyMacros, calculateRecommendedCalories, calculateSettledDailyMacros, caloriesFromMacros } from './macroTargets';

const goals = ['build_muscle', 'lose_fat', 'performance', 'maintain'] as const;

test('energy accounts for unequal protein, carbohydrate and fat amounts', () => {
  expect(caloriesFromMacros({ protein: 30, carbs: 65, fat: 20 })).toBe(560);
  expect(caloriesFromMacros({ protein: 0, carbs: 0, fat: 0 })).toBe(0);
});

test.each(goals)('%s recommendations conserve energy across supported budgets and rounding boundaries', goal => {
  for (const calories of [1200, 1800, 1939, 2000.5, 2400, 3500]) {
    const daily = calculateDailyMacros(calories, goal);
    expect(daily.protein * 4 / calories).toBeGreaterThanOrEqual(0.1);
    expect(daily.protein * 4 / calories).toBeLessThanOrEqual(0.16);
    expect(daily.carbs * 4 / calories).toBeGreaterThanOrEqual(0.45);
    expect(daily.carbs * 4 / calories).toBeLessThanOrEqual(0.65);
    expect(daily.fat * 9 / calories).toBeGreaterThanOrEqual(0.2);
    expect(daily.fat * 9 / calories).toBeLessThanOrEqual(0.35);
    expect(daily.protein * 4 + daily.carbs * 4 + daily.fat * 9).toBeCloseTo(calories);
    const settled = calculateSettledDailyMacros(calories, goal);
    for (const key of ['protein', 'carbs', 'fat'] as const) expect(Number.isInteger(settled[key])).toBe(true);
    expect(settled.calories).toBe(settled.protein * 4 + settled.carbs * 4 + settled.fat * 9);
    expect(Math.abs(settled.calories - calories)).toBeLessThanOrEqual(8.5);
  }
});

test.each([NaN, Infinity, -Infinity, -100, 0])('invalid calories %s use finite defaults', calories => {
  const result = calculateDailyMacros(calories);
  expect(result).toMatchObject({ calories: 2000, protein: 60, carbs: 290 });
  expect(result.fat).toBeCloseTo(200 / 3);
});

test('goals preserve their distinct allocations at the daily storage boundary', () => {
  expect(calculateSettledDailyMacros(2400, 'build_muscle')).toEqual({ calories: 2400, protein: 90, carbs: 330, fat: 80 });
  expect(calculateSettledDailyMacros(2400, 'lose_fat')).toEqual({ calories: 2400, protein: 84, carbs: 336, fat: 80 });
  expect(calculateSettledDailyMacros(2400, 'performance')).toEqual({ calories: 2403, protein: 78, carbs: 372, fat: 67 });
  expect(calculateSettledDailyMacros(2400)).toEqual({ calories: 2400, protein: 72, carbs: 348, fat: 80 });
  expect(calculateSettledDailyMacros(1998, 'build_muscle')).toEqual({ calories: 2003, protein: 75, carbs: 275, fat: 67 });
});

const profile = { age: 30, heightCm: 175, weightKg: 75, activityLevel: 'sedentary', goal: 'maintain' as const };
test.each([
  ['male', 2039], ['female', 1840], [null, 1939],
] as const)('recommendation uses independently calculated Mifflin-St Jeor reference: %s', (sex, calories) => {
  expect(calculateRecommendedCalories({ ...profile, sex })).toBe(calories);
});

test('activity and goals change the budget, while extreme profiles stay in the supported range', () => {
  expect(calculateRecommendedCalories({ ...profile, activityLevel: 'active' })).toBe(2505);
  expect(calculateRecommendedCalories({ ...profile, goal: 'lose_fat' })).toBe(1439);
  expect(calculateRecommendedCalories({ ...profile, goal: 'build_muscle' })).toBe(2189);
  expect(calculateRecommendedCalories({ ...profile, goal: 'performance' })).toBe(1939);
  expect(calculateRecommendedCalories({ ...profile, weightKg: 23, goal: 'lose_fat' })).toBe(1200);
  expect(calculateRecommendedCalories({ ...profile, weightKg: 320 })).toBe(3500);
});

test.each([undefined, NaN, Infinity, -Infinity, 0, -1])('incomplete measurements %s retain finite default recommendations', value => {
  expect(calculateRecommendedCalories({ age: value, heightCm: value, weightKg: value })).toBe(2214);
});
