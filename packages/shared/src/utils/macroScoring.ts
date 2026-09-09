import type { MacroTargets } from '../types/index';
export type { MacroTargets } from '../types/index';

export const MACRO_DIMENSIONS = ["calories", "proteinG", "carbsG", "fatG"] as const;
export type MacroDimension = typeof MACRO_DIMENSIONS[number];
export type MacroNumbers = Record<MacroDimension, number>;
export const activeTarget = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value) && value > 0;
export const hasTargets = (targets: MacroTargets): boolean => MACRO_DIMENSIONS.some(k => activeTarget(targets[k]));
/** Shared normalized Euclidean distance; lower is better. Percent is display-only. */
export function computeMatchScore(targets: MacroTargets, macros: MacroNumbers): number | null {
  const dimensions = MACRO_DIMENSIONS.filter(k => activeTarget(targets[k]));
  if (!dimensions.length || dimensions.some(k => !Number.isFinite(macros[k]) || macros[k] < 0)) return null;
  return Math.sqrt(dimensions.reduce((sum, k) => sum + ((macros[k] - targets[k]!) / targets[k]!) ** 2, 0));
}
