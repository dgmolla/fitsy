export interface SuggestionFilter {
  id: 'low-fat';
  label: string;
  icon: string;
  hint: string;
}

export const SUGGESTION_FILTERS: SuggestionFilter[] = [
  {
    id: 'low-fat',
    label: 'Low fat',
    icon: '🫐',
    hint: '~21% fat energy',
  },
];

export interface MacroSplit {
  protein: string;
  carbs: string;
  fat: string;
}

/**
 * Computes daily macro splits for the given diet style filter.
 * Uses the provided daily calorie value, falling back to 2000 kcal/day if missing or invalid.
 * The resulting values fill the daily-target form; on save they are divided by
 * MEALS_PER_DAY (see macroCalculator) to produce the per-meal targets stored in
 * and used by the search screen.
 *
 * Low fat: 14% protein, 65% carbs, 21% fat.
 */
export function applySuggestionFilter(
  _id: SuggestionFilter['id'],
  caloriesStr: string,
): MacroSplit {
  const parsedCalories = Number(caloriesStr);
  const cal = Number.isFinite(parsedCalories) && parsedCalories > 0 ? parsedCalories : 2000;

  const fat = Math.round((cal * 0.21) / 9);
  const protein = Math.round((cal * 0.14) / 4);
  const carbs = Math.round((cal * 0.65) / 4);
  return { protein: String(protein), carbs: String(carbs), fat: String(fat) };
}
