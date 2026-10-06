import { getOnboardingData, saveOnboardingField, type OnboardingData } from './onboardingStorage';
import { calculateMacros, macrosToStored } from './macroCalculator';
import { getMacroTargetSource, getMacroTargets, saveMacroTargets } from './macroStorage';
import { validateProfileFact } from './profileFactValidation';
import { supabase } from './supabase';

/** Profile facts retune only a target that the app generated automatically. */
export async function updateProfileFieldAndTargets<K extends keyof OnboardingData>(field: K,
  value: OnboardingData[K]) {
  validateProfileFact(field, value);
  const owner = (await supabase.auth.getSession()).data.session?.user?.id ?? null;
  await saveOnboardingField(field, value, owner);
  return refreshAutomaticProfileTargets(owner);
}

export async function refreshAutomaticProfileTargets(expectedOwner?: string | null) {
  const checkOwner = async () => {
    if (expectedOwner !== undefined && ((await supabase.auth.getSession()).data.session?.user?.id ?? null) !== expectedOwner) {
      throw new Error('Account changed while restoring profile');
    }
  };
  await checkOwner();
  const profile = await getOnboardingData();
  await checkOwner();
  if (await getMacroTargetSource() === 'automatic') {
    const targets = macrosToStored(calculateMacros(profile));
    if (!await saveMacroTargets(targets, 'complete', 'automatic', expectedOwner)) throw new Error('Account changed while saving targets');
    await checkOwner();
    return { profile, targets };
  }
  const targets = await getMacroTargets();
  await checkOwner();
  return { profile, targets };
}
