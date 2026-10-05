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
