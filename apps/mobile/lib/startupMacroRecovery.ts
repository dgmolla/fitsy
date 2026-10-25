import { supabase } from './supabase';
import { getMacroTargets, getDiscoveryMacroTargetSnapshot, getLegacyMacroRecovery, hasSavedMealTargets, restoreLegacyMacroTarget,
  type MacroTargetMode, type MacroTargetSnapshot } from './macroStorage';
import { deliverQueuedProfile, pullProfileFromServer, queueSavedProfileToServer } from './profileSync';

export type StartupTargetRecovery = 'restored' | 'absent' | 'unavailable' | 'account-changed';

/** Recover an upgraded account before asking it to create replacement targets. */
export async function recoverStartupMealTargets(confirm: (snapshot: MacroTargetSnapshot) => Promise<MacroTargetMode | null>): Promise<StartupTargetRecovery> {
  const expectedUserId = (await supabase.auth.getSession()).data.session?.user?.id;
  if (!expectedUserId) return 'account-changed';
  const stillCurrent = async () =>
    (await supabase.auth.getSession()).data.session?.user?.id === expectedUserId;
  if (await getMacroTargets()) return await stillCurrent() ? 'restored' : 'account-changed';
  // Prefer the current account's server allocation over ownerless device data.
  const reconciliation = await pullProfileFromServer();
  if (!await stillCurrent()) return 'account-changed';
  if (reconciliation === 'unavailable' || reconciliation === 'account-changed') return reconciliation;
  if (await hasSavedMealTargets() && !(await getDiscoveryMacroTargetSnapshot())?.needsModeChoice)
    return await stillCurrent() ? 'restored' : 'account-changed';
  const legacy = await getLegacyMacroRecovery();
  if (!await stillCurrent()) return 'account-changed';
  if (!legacy) return 'absent';
  const mode = await confirm(legacy.snapshot);
  if (!mode) return 'absent';
  if (!await stillCurrent()) return 'account-changed';
  const restored = await restoreLegacyMacroTarget(legacy, mode);
  if (!await stillCurrent()) return 'account-changed';
  if (!restored) return 'unavailable';
  if (restored.mode === 'complete') {
    await queueSavedProfileToServer();
    deliverQueuedProfile();
  }
  if (!await stillCurrent()) return 'account-changed';
  return await hasSavedMealTargets() ? 'restored' : 'absent';
}
