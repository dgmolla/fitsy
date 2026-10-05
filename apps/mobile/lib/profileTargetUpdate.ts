import { getOnboardingData, saveOnboardingField, type OnboardingData } from './onboardingStorage';
import { calculateMacros, macrosToStored } from './macroCalculator';
import { getMacroTargetSource, getMacroTargets, saveMacroTargets } from './macroStorage';

/** Profile facts retune only a target that the app generated automatically. */
export async function updateProfileFieldAndTargets<K extends keyof OnboardingData>(field: K,
  value: OnboardingData[K]) {
  await saveOnboardingField(field, value);
  const profile = await getOnboardingData();
  if (await getMacroTargetSource() === 'automatic') {
    const targets = macrosToStored(calculateMacros(profile));
    await saveMacroTargets(targets, 'complete', 'automatic');
    return { profile, targets };
  }
  return { profile, targets: await getMacroTargets() };
}
