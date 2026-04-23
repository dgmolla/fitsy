import { calculateSuggestedCalories, type Goal, type OnboardingData } from './onboardingStorage';
import type { StoredMacroTargets } from './macroStorage';

interface Macros {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
}

const MEALS_PER_DAY = 3;

export function calculateMacros(data: OnboardingData): Macros {
  const dailyCal = calculateSuggestedCalories(data);
  const cal = dailyCal / MEALS_PER_DAY;
  const goal = data.goal ?? 'maintain';
  const pPct = goal === 'build_muscle' ? 0.35 : goal === 'lose_fat' ? 0.40 : 0.30;
  const fPct = 0.25;
  return {
    protein: Math.round((cal * pPct) / 4),
    carbs: Math.round((cal * (1 - pPct - fPct)) / 4),
    fat: Math.round((cal * fPct) / 9),
    calories: Math.round(cal),
  };
}

export function macrosToStored(m: Macros): StoredMacroTargets {
  return {
    protein: String(m.protein),
    carbs: String(m.carbs),
    fat: String(m.fat),
    calories: String(m.calories),
  };
}
