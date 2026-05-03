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

/**
 * Alpha-tinted variants for use as subtle background washes on cream.
 * Keep here (next to base tokens) so any color-literal lint check stays green.
 */
export const MACRO_TINTS = {
  proteinTint: 'rgba(91,124,107,0.15)',  // protein @ 15% — badge background
} as const;

export type MacroKey = keyof typeof MACRO_COLORS;
