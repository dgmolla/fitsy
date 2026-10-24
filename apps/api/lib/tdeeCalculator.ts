import { calculateRecommendedCalories, calculateSettledDailyMacros, type MacroGoal } from "../../../packages/shared/src/utils/macroTargets";
import type { ActivityLevel, Sex } from "../../../packages/shared/src/types";

// ─── TDEE Calculator ──────────────────────────────────────────────────────────

export interface TdeeResult {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** Daily generated targets share calorie policy and settlement with mobile. */
export function calculateTdee(
  age: number,
  heightCm: number,
  weightKg: number,
  activityLevel: ActivityLevel,
  goal: MacroGoal,
  sex?: Sex | null,
): TdeeResult {
  const calories = calculateRecommendedCalories({ age, heightCm, weightKg, activityLevel, goal, sex });
  const daily = calculateSettledDailyMacros(calories, goal);
  return { calories: daily.calories, proteinG: daily.protein, carbsG: daily.carbs, fatG: daily.fat };
}
