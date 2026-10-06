import { macroCalories, parseTarget } from './macroEnergy';
import type { StoredMacroTargets } from './macroStorage';

export function isLegacyGeneratedShape(targets: StoredMacroTargets): boolean {
  const calories = parseTarget(targets.calories);
  const protein = parseTarget(targets.protein);
  const carbs = parseTarget(targets.carbs);
  const fat = parseTarget(targets.fat);
  if (calories === null || protein === null || carbs === null || fat === null) return false;
  // Older automatic targets rounded the meal calories and each gram field
  // separately. Identify that exact historical output before interpreting a
  // mismatch as a user-chosen, independent discovery constraint.
  const ratios: readonly (readonly [number, number, number])[] = [
    [0.25, 0.45, 0.30], [0.20, 0.55, 0.25], [0.20, 0.50, 0.30],
  ];
  const mealSplit = 3.5;
  const firstDaily = Math.max(1200, Math.ceil((calories - 0.5) * mealSplit));
  const lastDaily = Math.min(3500, Math.ceil((calories + 0.5) * mealSplit) - 1);
  for (let daily = firstDaily; daily <= lastDaily; daily++) {
    if (ratios.some(([p, c, f]) =>
      Math.round(daily * p / 4 / mealSplit) === protein
      && Math.round(daily * c / 4 / mealSplit) === carbs
      && Math.round(daily * f / 9 / mealSplit) === fat)) return true;
  }
  // The old macro-setup picker snapped daily grams to 5/5/2 before dividing
  // each field by 3.5. Its calorie field came from those daily snapped grams.
  const snap = (value: number, step: number, min: number, max: number) =>
    Math.max(min, Math.min(max, Math.round(value / step) * step));
  for (let daily = 1200; daily <= 3500; daily += 25) {
    if (ratios.some(([p, c, f]) => {
      const dailyProtein = snap(daily * p / 4, 5, 50, 300);
      const dailyCarbs = snap(daily * c / 4, 5, 50, 500);
      const dailyFat = snap(daily * f / 9, 2, 20, 150);
      return protein === Math.round(dailyProtein / mealSplit)
        && carbs === Math.round(dailyCarbs / mealSplit)
        && fat === Math.round(dailyFat / mealSplit)
        && calories === Math.round(macroCalories({ protein: dailyProtein, carbs: dailyCarbs,
          fat: dailyFat }) / mealSplit);
    })) return true;
  }
  return false;
}
export function legacyIndependentFilter(targets: StoredMacroTargets, generated: boolean): boolean {
  const calories = parseTarget(targets.calories);
  const protein = parseTarget(targets.protein);
  const carbs = parseTarget(targets.carbs);
  const fat = parseTarget(targets.fat);
  if (calories === null || protein === null || carbs === null || fat === null) return false;
  // Legacy discovery stored independently entered constraints in this key.
  // Without an explicit mode, even a small mismatch may be intentional.
  return !generated && calories !== macroCalories({ protein, carbs, fat });
}

