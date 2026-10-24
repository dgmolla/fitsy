import { getOnboardingData } from './onboardingStorage';
import { getArchivedMacroTarget, getDiscoveryMacroTargetSnapshot, getMacroTargetSnapshot, getMacroTargetSource, type StoredMacroTargets } from './macroStorage';
import { MEALS_PER_DAY } from './macroCalculator';
import { macroCalories, parseTarget } from './macroEnergy';
import { supabase } from './supabase';

/** Build daily API targets from the complete local meal allocation. */
export async function buildProfileBody(): Promise<Record<string, unknown>> {
    const [onboarding, macroSnapshot, discoverySnapshot] = await Promise.all([
      getOnboardingData(),
      getMacroTargetSnapshot(),
      getDiscoveryMacroTargetSnapshot(),
    ]);
    const macros = macroSnapshot?.targets;
    const partialFilter = !macros && discoverySnapshot?.mode === 'search';
    const userId = (await supabase.auth.getSession()).data.session?.user?.id;
    const unreconciledArchive = !macros && userId && await getArchivedMacroTarget(userId);

    const body: Record<string, unknown> = {};

    if (onboarding.birthday) body.birthday = onboarding.birthday;
    if (onboarding.heightCm) body.heightCm = onboarding.heightCm;
    if (onboarding.weightKg) body.weightKg = onboarding.weightKg;
    if (onboarding.sex) body.sex = onboarding.sex;
    if (onboarding.activity) body.activityLevel = onboarding.activity;
    if (onboarding.goal) body.goal = onboarding.goal;

    // Convert per-meal → daily (×MEALS_PER_DAY)
    if (partialFilter || unreconciledArchive) body.preserveMacroTarget = true;
    if (macros && !partialFilter) {
      const p = parseTarget(macros.protein);
      const c = parseTarget(macros.carbs);
      const f = parseTarget(macros.fat);
      const cal = parseTarget(macros.calories);
      if (p !== null && c !== null && f !== null && cal !== null)
        body.macroTarget = dailyMacroTarget(macros, await getMacroTargetSource());
    }

    return body;
}

export function dailyMacroTarget(macros: StoredMacroTargets, source: 'automatic' | 'manual') {
  const daily = {
    proteinG: Math.round(Number(macros.protein) * MEALS_PER_DAY),
    carbsG: Math.round(Number(macros.carbs) * MEALS_PER_DAY),
    fatG: Math.round(Number(macros.fat) * MEALS_PER_DAY),
  };
  return { ...daily, source, calories: macroCalories({ protein: daily.proteinG,
    carbs: daily.carbsG, fat: daily.fatG }) };
}
