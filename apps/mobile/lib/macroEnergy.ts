import { calculateDailyMacros, caloriesFromMacros, type MacroGoal } from '../../../packages/shared/src/utils/macroTargets';

export interface MacroTextValues {
  protein: string;
  carbs: string;
  fat: string;
  calories: string;
}

type Field = keyof MacroTextValues;
type Grams = Pick<MacroTextValues, 'protein' | 'carbs' | 'fat'>;

/** Targets settle to whole grams; calories always equal the energy of those grams. */
export function parseTarget(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^(?:\d+)(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export const macroCalories = caloriesFromMacros;

function parsedGrams(values: Grams) {
  const protein = parseTarget(values.protein);
  const carbs = parseTarget(values.carbs);
  const fat = parseTarget(values.fat);
  return protein === null || carbs === null || fat === null ? null : { protein, carbs, fat };
}

export function isCompleteTarget(values: Grams): boolean {
  return parsedGrams(values) !== null;
}

export function isIndependentSearchFilter(values: MacroTextValues): boolean {
  const grams = parsedGrams(values);
  const calories = parseTarget(values.calories);
  return !grams || calories === null || macroCalories(grams) === 0 || calories !== macroCalories(grams);
}

/** A partially specified discovery filter retains each independent constraint. */
export function settleTargetEdit(
  values: MacroTextValues,
  field: Field,
  goal: MacroGoal = 'maintain',
  allowFallback = false,
  deriveInitialCalories = false,
): MacroTextValues {
  const edited = parseTarget(values[field]);
  if (edited === null || (field === 'calories' && edited === 0)) return values;
  // Only an untouched, initially blank calorie field may be derived. Explicit
  // clears/invalid drafts and independent search constraints stay unchanged.
  if (field !== 'calories' && !(parseTarget(values.calories) ?? 0)
    && !(deriveInitialCalories && values.calories === '')) return values;

  const current = parsedGrams(values);
  if (!current && !allowFallback) return values;
  if (!allowFallback && (!current || Object.values(current).some(value => value <= 0)
    || !parseTarget(values.calories))) return values;

  if (field === 'calories') {
    const energy = current ? macroCalories(current) : 0;
    const defaults = calculateDailyMacros(edited, goal);
    const entered = {
      protein: parseTarget(values.protein), carbs: parseTarget(values.carbs), fat: parseTarget(values.fat),
    };
    const knownEnergy = Object.entries(entered).reduce((sum, [key, value]) =>
      sum + (value ?? 0) * (key === 'fat' ? 9 : 4), 0);
    const missingEnergy = Object.entries(defaults).reduce((sum, [key, value]) =>
      sum + (key !== 'calories' && entered[key as keyof typeof entered] === null
        ? value * (key === 'fat' ? 9 : 4) : 0), 0);
    const fallback = !current && Object.values(entered).some(value => value !== null) && missingEnergy > 0;
    if (fallback && knownEnergy > edited) return values;
    const remainingScale = fallback ? Math.max(0, edited - knownEnergy) / missingEnergy : 1;
    const source = energy > 0 ? current! : defaults;
    const scale = energy > 0 ? edited / energy : 1;
    const grams = {
      protein: Math.round(fallback && entered.protein !== null ? entered.protein
        : source.protein * (fallback ? remainingScale : scale)),
      carbs: Math.round(fallback && entered.carbs !== null ? entered.carbs
        : source.carbs * (fallback ? remainingScale : scale)),
      fat: Math.round(fallback && entered.fat !== null ? entered.fat
        : source.fat * (fallback ? remainingScale : scale)),
    };
    return { protein: String(grams.protein), carbs: String(grams.carbs), fat: String(grams.fat),
      calories: String(macroCalories(grams)) };
  }

  if (!current) return values;
  const grams = { protein: Math.round(current!.protein), carbs: Math.round(current!.carbs),
    fat: Math.round(current!.fat), [field]: Math.round(edited) };
  if (deriveInitialCalories && values.calories === '' && macroCalories(grams) === 0) return values;
  return { protein: String(grams.protein), carbs: String(grams.carbs), fat: String(grams.fat),
    calories: String(macroCalories(grams)) };
}

export function normalizeCompleteTarget(values: MacroTextValues, searchFilter = false): MacroTextValues {
  if (parseTarget(values.calories) === null) return values;
  const grams = parsedGrams(values);
  if (!grams) return values;
  if (searchFilter && Object.values(grams).some(value => value <= 0)) return values;
  if (macroCalories(grams) === 0) return values;
  const rounded = { protein: Math.round(grams.protein), carbs: Math.round(grams.carbs), fat: Math.round(grams.fat) };
  return { protein: String(rounded.protein), carbs: String(rounded.carbs), fat: String(rounded.fat),
    calories: String(macroCalories(rounded)) };
}
