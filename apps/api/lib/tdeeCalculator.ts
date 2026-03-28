import type { ActivityLevel, UserGoal } from "@fitsy/shared";

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

const GOAL_OFFSETS: Record<UserGoal, number> = {
  lose_fat: -500,
  maintain: 0,
  build_muscle: 300,
};

/**
 * Calculates TDEE and macro split using Mifflin-St Jeor (unisex).
 *
 * BMR = 10 * weightKg + 6.25 * heightCm - 5 * age + 5
 * TDEE = BMR * activityMultiplier + goalOffset
 *
 * Macro split: protein 30% / carbs 40% / fat 30%
 */
export function calculateTdee(
  age: number,
  heightCm: number,
  weightKg: number,
  activityLevel: ActivityLevel,
  goal: UserGoal,
): TdeeResult {
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  const tdee = bmr * ACTIVITY_MULTIPLIERS[activityLevel];
  const calories = Math.round(tdee + GOAL_OFFSETS[goal]);

  const proteinG = Math.round((calories * 0.3) / 4);
  const carbsG = Math.round((calories * 0.4) / 4);
  const fatG = Math.round((calories * 0.3) / 9);

  return { calories, proteinG, carbsG, fatG };
}
