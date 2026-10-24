import { supabase } from './supabase';
import { getMacroTargets, getQuarantinedLegacyTarget, hasSavedMealTargets, restoreQuarantinedLegacyTarget,
  type MacroTargetMode } from './macroStorage';
import { deliverQueuedProfile, pullProfileFromServer, queueSavedProfileToServer } from './profileSync';

export type StartupTargetRecovery = 'restored' | 'absent' | 'unavailable' | 'account-changed';

/** Recover an upgraded account before asking it to create replacement targets. */
export async function recoverStartupMealTargets(confirm: (mode: MacroTargetMode) => Promise<boolean>): Promise<StartupTargetRecovery> {
  const expectedUserId = (await supabase.auth.getSession()).data.session?.user?.id;
  if (!expectedUserId) return 'account-changed';
  const stillCurrent = async () =>
    (await supabase.auth.getSession()).data.session?.user?.id === expectedUserId;
  if (await getMacroTargets()) return await stillCurrent() ? 'restored' : 'account-changed';
  // Prefer the current account's server allocation over ownerless device data.
  const reconciliation = await pullProfileFromServer();
  if (!await stillCurrent()) return 'account-changed';
  if (reconciliation === 'unavailable' || reconciliation === 'account-changed') return reconciliation;
  if (await hasSavedMealTargets()) return await stillCurrent() ? 'restored' : 'account-changed';
  const legacy = await getQuarantinedLegacyTarget();
  if (!await stillCurrent()) return 'account-changed';
  if (!legacy || !await confirm(legacy.mode)) return 'absent';
  if (!await stillCurrent()) return 'account-changed';
  const restored = await restoreQuarantinedLegacyTarget(expectedUserId);
  if (!await stillCurrent()) return 'account-changed';
  if (!restored) return 'unavailable';
  if (restored.mode === 'complete') {
    await queueSavedProfileToServer();
    deliverQueuedProfile();
  }
  if (!await stillCurrent()) return 'account-changed';
  return await hasSavedMealTargets() ? 'restored' : 'absent';
}
