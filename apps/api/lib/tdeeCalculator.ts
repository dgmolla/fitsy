import { calculateDailyMacros, type ActivityLevel, type MacroGoal, type Sex } from "@fitsy/shared";

// ─── TDEE Calculator ──────────────────────────────────────────────────────────

export interface TdeeResult {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  active: 1.55,
  very_active: 1.725,
};

const GOAL_OFFSETS: Record<MacroGoal, number> = {
  lose_fat: -500,
  maintain: 0,
  performance: 0,
  build_muscle: 300,
};

/**
 * Calculates TDEE and macro split using Mifflin-St Jeor.
 *
 * BMR = 10 * weightKg + 6.25 * heightCm - 5 * age + sexTerm
 *   sexTerm = +5 (male) / -161 (female) / -78 (unknown → the midpoint, so the
 *   estimate degrades gracefully when sex wasn't collected).
 * TDEE = BMR * activityMultiplier + goalOffset
 *
 * Macro split: shared goal-specific general adult defaults.
 */
export function calculateTdee(
  age: number,
  heightCm: number,
  weightKg: number,
  activityLevel: ActivityLevel,
  goal: MacroGoal,
  sex?: Sex | null,
): TdeeResult {
  const sexTerm = sex === "male" ? 5 : sex === "female" ? -161 : -78;
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + sexTerm;
  const tdee = bmr * ACTIVITY_MULTIPLIERS[activityLevel];
  const calories = Math.round(tdee + GOAL_OFFSETS[goal]);

  const daily = calculateDailyMacros(calories, goal);
  return {
    calories: daily.calories,
    proteinG: Math.round(daily.protein),
    carbsG: Math.round(daily.carbs),
    fatG: Math.round(daily.fat),
  };
}
