import { calculateSuggestedCalories, type Goal, type OnboardingData } from './onboardingStorage';
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
 * INVARIANT: per-meal × MEALS_PER_DAY = daily. Every place that converts
 * between daily and per-meal (macroCalculator, macro-setup, profileSync,
 * tuning) MUST use this constant so the round-trip to the server stays lossless.
 * Changing this single value re-tunes the per-meal split everywhere.
 *
 * Set to 3.5 (not 3) intentionally: dividing the daily target by a literal 3
 * assumes 100% of intake comes from 3 meals and leaves no room for snacks,
 * which made per-meal targets feel high (~57g protein). 3.5 reserves ~14% of
 * the day for snacks (3 meals ≈ 86% of daily), keeping per-meal targets
 * realistic for a single restaurant meal.
 */
export const MEALS_PER_DAY = 3.5;

export function calculateMacros(data: OnboardingData): Macros {
  const dailyCal = calculateSuggestedCalories(data);
  const cal = dailyCal / MEALS_PER_DAY;
  const goal = data.goal ?? 'maintain';
  const pPct = goal === 'build_muscle' ? 0.35 : goal === 'lose_fat' ? 0.40 : 0.30;
  const fPct = 0.25;
  return {
    protein: Math.round((cal * pPct) / 4),
    carbs: Math.round((cal * (1 - pPct - fPct)) / 4),
    fat: Math.round((cal * fPct) / 9),
    calories: Math.round(cal),
  };
}

export function macrosToStored(m: Macros): StoredMacroTargets {
  return {
    protein: String(m.protein),
    carbs: String(m.carbs),
    fat: String(m.fat),
    calories: String(m.calories),
  };
}
