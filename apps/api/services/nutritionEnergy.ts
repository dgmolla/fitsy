/** Total carbohydrate includes allulose. Only explicitly sourced grams get its 0.4 kcal/g factor. */
export function nutritionEnergy(proteinG: number, carbsG: number, fatG: number, alluloseG = 0): number | null {
  if ([proteinG, carbsG, fatG, alluloseG].some(n => !Number.isFinite(n) || n < 0) || alluloseG > carbsG) return null;
  return 4 * proteinG + 4 * (carbsG - alluloseG) + 0.4 * alluloseG + 9 * fatG;
}
