import { calculateDailyMacros, type MacroGoal } from '@fitsy/shared';

const goals: MacroGoal[] = ['build_muscle', 'lose_fat', 'performance', 'maintain'];

test.each(goals)('%s recommendations meet adult ranges and reconcile calories', (goal) => {
  for (const calories of [1200, 1800, 2400, 3500]) {
    const daily = calculateDailyMacros(calories, goal);
    expect(daily.protein * 4 / calories).toBeGreaterThanOrEqual(0.1);
    expect(daily.protein * 4 / calories).toBeLessThanOrEqual(0.25);
    expect(daily.carbs * 4 / calories).toBeGreaterThanOrEqual(0.45);
    expect(daily.carbs * 4 / calories).toBeLessThanOrEqual(0.65);
    expect(daily.fat * 9 / calories).toBeGreaterThanOrEqual(0.2);
    expect(daily.fat * 9 / calories).toBeLessThanOrEqual(0.35);
    expect(daily.protein * 4 + daily.carbs * 4 + daily.fat * 9).toBeCloseTo(calories);
  }
});

test.each([NaN, Infinity, -Infinity, -100, 0])('invalid calories %s use finite defaults', (calories) => {
  expect(calculateDailyMacros(calories)).toEqual(calculateDailyMacros(2000));
});

test.each(['build_muscle', 'lose_fat'] as const)('%s uses moderate protein, sufficient carbohydrate and fat', (goal) => {
  expect(calculateDailyMacros(2400, goal)).toEqual({ calories: 2400, protein: 150, carbs: 270, fat: 80 });
});
