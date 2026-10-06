import { supabase } from './supabase';
import { getQuarantinedLegacyTarget, hasSavedMealTargets, restoreQuarantinedLegacyTarget,
  type MacroTargetMode } from './macroStorage';
import { deliverQueuedProfile, pullProfileFromServer, queueSavedProfileToServer } from './profileSync';

/** Recover an upgraded account before asking it to create replacement targets. */
export async function recoverStartupMealTargets(confirm: (mode: MacroTargetMode) => Promise<boolean>): Promise<boolean> {
  const expectedUserId = (await supabase.auth.getSession()).data.session?.user?.id;
  if (!expectedUserId) return false;
  const stillCurrent = async () =>
    (await supabase.auth.getSession()).data.session?.user?.id === expectedUserId;
  if (await hasSavedMealTargets()) return await stillCurrent();
  // Prefer the current account's server allocation over ownerless device data.
  await pullProfileFromServer();
  if (!await stillCurrent()) return false;
  if (await hasSavedMealTargets()) return await stillCurrent();
  const legacy = await getQuarantinedLegacyTarget();
  if (!legacy || !await stillCurrent() || !await confirm(legacy.mode)) return false;
  if (!await stillCurrent()) return false;
  const restored = await restoreQuarantinedLegacyTarget(expectedUserId);
  if (!restored || !await stillCurrent()) return false;
  if (restored.mode === 'complete') {
    await queueSavedProfileToServer();
    deliverQueuedProfile();
  }
  return await hasSavedMealTargets() && await stillCurrent();
}
