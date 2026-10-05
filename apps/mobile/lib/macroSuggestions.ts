export interface SuggestionFilter {
  id: 'protein-dense' | 'low-carb' | 'low-fat';
  label: string;
  icon: string;
  hint: string;
}

export const SUGGESTION_FILTERS: SuggestionFilter[] = [
  {
    id: 'protein-dense',
    label: 'Protein focused',
    icon: '🥩',
    hint: '~16% protein energy',
  },
  {
    id: 'low-carb',
    label: 'Carb mindful',
    icon: '🥑',
    hint: '~50% carb energy',
  },
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
 * Protein focused: 16% protein, 54% carbs, 30% fat.
 * Carb mindful: 15% protein, 50% carbs, 35% fat.
 * Low fat: 14% protein, 65% carbs, 21% fat.
 */
export function applySuggestionFilter(
  id: SuggestionFilter['id'],
  caloriesStr: string,
): MacroSplit {
  const parsedCalories = Number(caloriesStr);
  const cal = Number.isFinite(parsedCalories) && parsedCalories > 0 ? parsedCalories : 2000;

  if (id === 'protein-dense') {
    const protein = Math.round((cal * 0.16) / 4);
    const carbs = Math.round((cal * 0.54) / 4);
    const fat = Math.round((cal * 0.30) / 9);
    return { protein: String(protein), carbs: String(carbs), fat: String(fat) };
  }

  if (id === 'low-carb') {
    const carbs = Math.round((cal * 0.50) / 4);
    const protein = Math.round((cal * 0.15) / 4);
    const fat = Math.round((cal * 0.35) / 9);
    return { protein: String(protein), carbs: String(carbs), fat: String(fat) };
  }

  const fat = Math.round((cal * 0.21) / 9);
  const protein = Math.round((cal * 0.14) / 4);
  const carbs = Math.round((cal * 0.65) / 4);
  return { protein: String(protein), carbs: String(carbs), fat: String(fat) };
}
