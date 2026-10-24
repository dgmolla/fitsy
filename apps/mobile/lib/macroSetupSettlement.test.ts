/** @jest-environment node */
import { calculateDailyMacros } from '../../../packages/shared/src/utils/macroTargets';
import { dailyToPerMealMacros, macrosToStored } from './macroCalculator';
import { dailyMacroTarget } from './profileTargetBody';
import { settleSetupMacros, settledSetupChoices } from './macroSetupSettlement';
import { macroCalories } from './macroEnergy';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) }));

function savedDaily(grams: { protein: number; carbs: number; fat: number }) {
  return dailyMacroTarget(macrosToStored(dailyToPerMealMacros({ ...grams, calories: macroCalories(grams) })), 'manual');
}

it('settles the actual maximum performance picker allocation before displaying or saving', () => {
  const displayed = settleSetupMacros({ protein: 115, carbs: 545, fat: 98 });
  expect(displayed).toEqual({ protein: 116, carbs: 546, fat: 98 });
  expect(macroCalories(displayed)).toBe(3530);
  expect(savedDaily(displayed)).toMatchObject({ proteinG: 116, carbsG: 546, fatG: 98, calories: 3530 });
});

it.each(['build_muscle', 'lose_fat', 'performance', 'maintain'] as const)('%s displays the exact synchronized energy across calorie and rounding boundaries', goal => {
  for (let calories = 1200; calories <= 3500; calories++) {
    const daily = calculateDailyMacros(calories, goal);
    const picker = { protein: Math.max(50, Math.round(daily.protein / 5) * 5),
      carbs: Math.max(50, Math.round(daily.carbs / 5) * 5), fat: Math.max(20, Math.round(daily.fat / 2) * 2) };
    const displayed = settleSetupMacros(picker);
    const synchronized = savedDaily(displayed);
    expect(settleSetupMacros(displayed)).toEqual(displayed);
    expect(synchronized.calories).toBe(macroCalories(displayed));
    expect(synchronized).toMatchObject({ proteinG: displayed.protein, carbsG: displayed.carbs, fatG: displayed.fat });
    expect(dailyToPerMealMacros({ ...displayed, calories: synchronized.calories }).protein).toBeLessThanOrEqual(40);
  }
});

it('keeps every manual picker option stable and still permits more than40g protein per meal', () => {
  const choices = (min: number, max: number, step: number) => Array.from({ length: (max - min) / step + 1 }, (_, i) => min + i * step);
  for (const [field, range] of [['protein', choices(50, 300, 5)], ['carbs', choices(50, 600, 5)], ['fat', choices(20, 150, 2)]] as const) {
    for (const value of settledSetupChoices(range, field)) {
      const displayed = settleSetupMacros({ protein: 130, carbs: 280, fat: 70, [field]: value });
      expect(displayed[field]).toBe(value);
      expect(savedDaily(displayed).calories).toBe(macroCalories(displayed));
    }
  }
  const high = settleSetupMacros({ protein: 300, carbs: 280, fat: 70 });
  expect(dailyToPerMealMacros({ ...high, calories: macroCalories(high) }).protein).toBe(86);
});
