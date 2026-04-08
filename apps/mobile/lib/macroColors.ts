/**
 * Centralized macro nutrient color config.
 * Editorial palette — muted tones that work on cream backgrounds.
 * Change here → reflects everywhere.
 */
export const MACRO_COLORS = {
  protein: '#5B7C6B',  // muted sage
  carbs: '#8B7355',    // warm brown
  fat: '#7B6B8A',      // muted purple
} as const;

export type MacroKey = keyof typeof MACRO_COLORS;
