export interface SuggestionFilter {
  id: 'protein-dense' | 'low-carb' | 'low-fat';
  label: string;
  icon: string;
  hint: string;
}

export const SUGGESTION_FILTERS: SuggestionFilter[] = [
  {
    id: 'protein-dense',
    label: 'Protein dense',
    icon: '🥩',
    hint: '~40% protein per meal',
  },
  {
    id: 'low-carb',
    label: 'Low carb',
    icon: '🥑',
    hint: '~10% carbs per meal',
  },
  {
    id: 'low-fat',
    label: 'Low fat',
    icon: '🫐',
    hint: '~15% fat per meal',
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
 * The resulting values fill the daily-target form; they are divided by 3 on save to produce
 * per-meal targets stored in and used by the search screen.
 *
 * Protein dense: protein ≈ 10% of calories in grams (= 40% of kcal from protein)
 *   Remaining kcal: 55% carbs, 45% fat.
 *
 * Low carb: ~10% of kcal from carbs, ~35% protein, ~55% fat.
 *
 * Low fat: ~15% of kcal from fat, ~30% protein, ~55% carbs.
 */
export function applySuggestionFilter(
  id: SuggestionFilter['id'],
  caloriesStr: string,
): MacroSplit {
  const cal = parseFloat(caloriesStr) > 0 ? parseFloat(caloriesStr) : 2000;

  if (id === 'protein-dense') {
    // protein_g = cal * 0.1  →  protein_kcal = cal * 0.4 (40%)
    const protein = Math.round(cal * 0.1);
    const remaining = cal - protein * 4;
    const carbs = Math.round((remaining * 0.55) / 4);
    const fat = Math.round((remaining * 0.45) / 9);
    return { protein: String(protein), carbs: String(carbs), fat: String(fat) };
  }

  if (id === 'low-carb') {
    // ~10% kcal from carbs, 35% protein, 55% fat
    const carbs = Math.round((cal * 0.1) / 4);
    const protein = Math.round((cal * 0.35) / 4);
    const fat = Math.round((cal * 0.55) / 9);
    return { protein: String(protein), carbs: String(carbs), fat: String(fat) };
  }

  // low-fat: ~15% kcal from fat, 30% protein, 55% carbs
  const fat = Math.round((cal * 0.15) / 9);
  const protein = Math.round((cal * 0.3) / 4);
  const carbs = Math.round((cal * 0.55) / 4);
  return { protein: String(protein), carbs: String(carbs), fat: String(fat) };
}
