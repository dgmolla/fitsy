import { calculateDailyMacros } from '../../../packages/shared/src/utils/macroTargets';
export { calculateDailyMacros } from '../../../packages/shared/src/utils/macroTargets';
import { calculateSuggestedCalories, type OnboardingData } from './onboardingStorage';
import type { StoredMacroTargets } from './macroStorage';

interface Macros {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
}

/**
 * How many meals we split a user's daily macro target across to produce the
 * per-meal targets the client stores and the search screen matches against.
 *
 * Before rounding, per-meal × MEALS_PER_DAY = daily. Every place that converts
 * between daily and per-meal (macroCalculator, macro-setup, profileSync,
 * tuning) MUST use this constant; whole-gram rounding can cause small differences.
 * Changing this single value re-tunes the per-meal split everywhere.
 *
 * Set to 3.5 (not 3) intentionally: dividing the daily target by a literal 3
 * assumes 100% of intake comes from 3 meals and leaves no room for snacks,
 * which made per-meal targets feel high (~57g protein). 3.5 reserves ~14% of
 * the day for snacks (3 meals ≈ 86% of daily), keeping per-meal targets
 * realistic for a single restaurant meal.
 */
export const MEALS_PER_DAY = 3.5;

export function dailyToPerMealMacros(daily: Macros): Macros {
  return {
    protein: Math.round(daily.protein / MEALS_PER_DAY),
    carbs: Math.round(daily.carbs / MEALS_PER_DAY),
    fat: Math.round(daily.fat / MEALS_PER_DAY),
    calories: Math.round(daily.calories / MEALS_PER_DAY),
  };
}

export function calculateMacros(data: OnboardingData): Macros {
  return dailyToPerMealMacros(calculateDailyMacros(calculateSuggestedCalories(data), data.goal));
}

export function macrosToStored(m: Macros): StoredMacroTargets {
  return {
    protein: String(m.protein),
    carbs: String(m.carbs),
    fat: String(m.fat),
    calories: String(m.calories),
  };
}
