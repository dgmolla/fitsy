import { getCachedCoords } from './locationCache';
import { getMacroTargets } from './macroStorage';
import { getOnboardingData, saveOnboardingField, type OnboardingArea } from './onboardingStorage';

/** Older installs have meal targets and cached coordinates, but no new area record. */
export async function getPreviewSetup() {
  const [data, targets, cached] = await Promise.all([getOnboardingData(), getMacroTargets(), getCachedCoords()]);
  let area = data.area;
  if (!area && cached && Number.isFinite(cached.lat) && Math.abs(cached.lat) <= 90
    && Number.isFinite(cached.lng) && Math.abs(cached.lng) <= 180) {
    area = { ...cached, name: 'Your saved area', source: 'saved' } satisfies OnboardingArea;
    await saveOnboardingField('area', area);
  }
  // Editing an upgraded account's targets must preserve its existing numbers.
  const targetMode = data.targetMode ?? (targets ? 'known' as const : undefined);
  if (targetMode && !data.targetMode) await saveOnboardingField('targetMode', targetMode);
  return { data: { ...data, area, targetMode }, targets };
}
