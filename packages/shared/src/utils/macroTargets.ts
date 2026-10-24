/**
 * General adult defaults within AMDR ranges, not clinical or athlete prescriptions.
 * Protein/carbs/fat: 10-35% / 45-65% / 20-35% of energy.
 * https://www.canada.ca/en/health-canada/services/food-nutrition/healthy-eating/dietary-reference-intakes/tables/reference-values-macronutrients.html
 * Goal-specific points are product defaults; performance leaves more room for carbs.
 * https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/
 */
const GOAL_RATIOS = {
  build_muscle: { protein: 0.15, carbs: 0.55, fat: 0.30 },
  lose_fat: { protein: 0.14, carbs: 0.56, fat: 0.30 },
  performance: { protein: 0.13, carbs: 0.62, fat: 0.25 },
  maintain: { protein: 0.12, carbs: 0.58, fat: 0.30 },
} as const;

export type MacroGoal = keyof typeof GOAL_RATIOS;
export const SUGGESTED_CALORIE_RANGE = { min: 1200, max: 3500 } as const;

export function caloriesFromMacros(grams: { protein: number; carbs: number; fat: number }): number {
  return grams.protein * 4 + grams.carbs * 4 + grams.fat * 9;
}

/** Keep daily values unrounded so consumers can round once at their storage boundary. */
export function calculateDailyMacros(calories: number, goal: MacroGoal = 'maintain') {
  const cal = Number.isFinite(calories) && calories > 0 ? calories : 2000;
  const ratios = GOAL_RATIOS[goal] ?? GOAL_RATIOS.maintain;
  return {
    protein: cal * ratios.protein / 4,
    carbs: cal * ratios.carbs / 4,
    fat: cal * ratios.fat / 9,
    calories: cal,
  };
}

/** Whole daily grams are the API storage boundary, shared by generated targets. */
export function calculateSettledDailyMacros(calories: number, goal: MacroGoal = 'maintain') {
  const daily = calculateDailyMacros(calories, goal);
  const grams = {
    protein: Math.round(daily.protein),
    carbs: Math.round(daily.carbs),
    fat: Math.round(daily.fat),
  };
  return { ...grams, calories: caloriesFromMacros(grams) };
}

/** Shared Mifflin-St Jeor recommendation, including incomplete-profile defaults. */
export function calculateRecommendedCalories(profile: {
  age?: number | undefined;
  heightCm?: number | undefined;
  weightKg?: number | undefined;
  sex?: string | null | undefined;
  activityLevel?: string | undefined;
  goal?: MacroGoal | undefined;
}): number {
  const validOr = (value: number | undefined, fallback: number) =>
    value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
  const activity = { sedentary: 1.2, lightly_active: 1.375, active: 1.55, very_active: 1.725 };
  const offsets = { lose_fat: -500, maintain: 0, performance: 0, build_muscle: 250 };
  const sexTerm = profile.sex === 'male' ? 5 : profile.sex === 'female' ? -161 : -78;
  const bmr = Math.round(10 * validOr(profile.weightKg, 75) + 6.25 * validOr(profile.heightCm, 170)
    - 5 * validOr(profile.age, 25) + sexTerm);
  const multiplier = activity[profile.activityLevel as keyof typeof activity] ?? activity.lightly_active;
  const calories = Math.round(bmr * multiplier) + (offsets[profile.goal ?? 'maintain'] ?? 0);
  return Math.max(SUGGESTED_CALORIE_RANGE.min, Math.min(SUGGESTED_CALORIE_RANGE.max, calories));
}
