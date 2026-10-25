import { macroCalories, parseTarget } from './macroEnergy';
import type { MacroTextValues } from './macroEnergy';

export function isLegacyGeneratedShape(targets: MacroTextValues): boolean {
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
    // These reproduce retired picker outputs for migration only. Their weights
    // and old picker limits never constrain current recommendations or edits.
    const denseProtein = Math.round(daily * 0.1);
    const denseRemaining = daily - denseProtein * 4;
    const historicalSplits: readonly (readonly [number, number, number])[] = [
      ...ratios.map(([p, c, f]) => [daily * p / 4, daily * c / 4, daily * f / 9] as const),
      [denseProtein, Math.round(denseRemaining * 0.55 / 4), Math.round(denseRemaining * 0.45 / 9)],
      [Math.round(daily * 0.35 / 4), Math.round(daily * 0.10 / 4), Math.round(daily * 0.55 / 9)],
      [Math.round(daily * 0.30 / 4), Math.round(daily * 0.55 / 4), Math.round(daily * 0.15 / 9)],
    ];
    if (historicalSplits.some(([p, c, f]) => {
      const dailyProtein = snap(p, 5, 50, 300);
      const dailyCarbs = snap(c, 5, 50, 500);
      const dailyFat = snap(f, 2, 20, 150);
      return protein === Math.round(dailyProtein / mealSplit)
        && carbs === Math.round(dailyCarbs / mealSplit)
        && fat === Math.round(dailyFat / mealSplit)
        && calories === Math.round(macroCalories({ protein: dailyProtein, carbs: dailyCarbs,
          fat: dailyFat }) / mealSplit);
    })) return true;
  }
  return false;
}
export function needsLegacyModeChoice(targets: MacroTextValues, generated: boolean): boolean {
  const calories = parseTarget(targets.calories);
  const protein = parseTarget(targets.protein);
  const carbs = parseTarget(targets.carbs);
  const fat = parseTarget(targets.fat);
  if (calories === null || protein === null || carbs === null || fat === null) return false;
  // Both retired profile edits with stale calories and intentional discovery
  // constraints used this key. A mismatch needs a choice, not inferred intent.
  return !generated && calories !== macroCalories({ protein, carbs, fat });
}
