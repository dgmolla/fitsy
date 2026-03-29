/**
 * Centralized macro nutrient color config.
 * All P/C/F color references throughout the app should use this.
 * Change here → reflects everywhere.
 */
export const MACRO_COLORS = {
  protein: '#3B82F6',  // blue
  carbs: '#2D7D46',    // green (brand)
  fat: '#D946EF',      // magenta
} as const;

export type MacroKey = keyof typeof MACRO_COLORS;
