import { dailyToPerMealMacros, macrosToStored } from './macroCalculator';
import { dailyMacroTarget } from './profileTargetBody';
import { macroCalories } from './macroEnergy';

type Grams = { protein: number; carbs: number; fat: number };

/** Show the exact daily grams that this setup owner will synchronize after saving. */
export function settleSetupMacros(grams: Grams): Grams {
  const meal = macrosToStored(dailyToPerMealMacros({ ...grams, calories: macroCalories(grams) }));
  const daily = dailyMacroTarget(meal, 'manual');
  return { protein: daily.proteinG, carbs: daily.carbsG, fat: daily.fatG };
}

/** Picker choices use the same round trip, so manual selections remain stable on reopen. */
export function settledSetupChoices(values: number[], field: keyof Grams): number[] {
  return [...new Set(values.map(value => settleSetupMacros({ protein: 0, carbs: 0, fat: 0, [field]: value })[field]))];
}
