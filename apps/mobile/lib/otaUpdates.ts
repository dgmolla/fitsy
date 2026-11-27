import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import * as Updates from 'expo-updates';
import { trackOtaUpdateCheck } from './analytics';
import { captureException } from './sentry';

export interface OtaDiagnostics {
  updateId: string;
  channel: string;
  runtimeVersion: string;
  isEmbeddedLaunch: boolean;
}

/** What this device is running; shown on Profile for TestFlight so a missing OTA is visible. */
export function otaDiagnostics(): OtaDiagnostics {
  return {
    updateId: Updates.updateId ?? 'none',
    channel: Updates.channel ?? 'none',
    runtimeVersion: Updates.runtimeVersion ?? 'none',
    isEmbeddedLaunch: Updates.isEmbeddedLaunch ?? true,
  };
}

/** Only real TestFlight builds check on foreground; production keeps expo-updates' launch check. */
export const isTestflightOta = (): boolean => !__DEV__ && Updates.isEnabled && Updates.channel === 'testflight';

const MIN_GAP_MS = 60_000;
let lastCheckAt = 0;
let running = false;

/** Check, download and offer to restart into a newer testflight update; every outcome is reported. */
export async function checkTestflightUpdate(now = Date.now()): Promise<void> {
  if (!isTestflightOta() || running || now - lastCheckAt < MIN_GAP_MS) return;
  running = true;
  lastCheckAt = now;
  const base = { update_id: Updates.updateId ?? 'none', is_embedded_launch: Updates.isEmbeddedLaunch ?? true };
  let stage: 'check' | 'fetch' = 'check';
  try {
    const check = await Updates.checkForUpdateAsync();
    trackOtaUpdateCheck({ ...base, stage: 'check', remote_update_id: check.isAvailable ? check.manifest?.id : undefined });
    if (!check.isAvailable) return;
    stage = 'fetch';
    const fetched = await Updates.fetchUpdateAsync();
    trackOtaUpdateCheck({ ...base, stage: 'fetch', remote_update_id: fetched.isNew ? fetched.manifest?.id : undefined });
    if (!fetched.isNew) return;
    trackOtaUpdateCheck({ ...base, stage: 'reload_prompt', remote_update_id: fetched.manifest?.id });
    Alert.alert('Update ready', 'A new version of Fitsy is ready.', [
      { text: 'Later', style: 'cancel' },
      { text: 'Restart', onPress: () => { void Updates.reloadAsync(); } },
    ]);
  } catch (error) {
    trackOtaUpdateCheck({ ...base, stage: 'error', error_name: `${stage}:${error instanceof Error ? error.name : 'unknown'}` });
    captureException(error);
  } finally {
    running = false;
  }
}

/** Launch and every return to the foreground. */
export function useTestflightOtaCheck(): void {
  useEffect(() => {
    if (!isTestflightOta()) return;
    const { updateId, isEmbeddedLaunch } = otaDiagnostics();
    trackOtaUpdateCheck({ stage: 'launch', update_id: updateId, is_embedded_launch: isEmbeddedLaunch });
    void checkTestflightUpdate();
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void checkTestflightUpdate(); });
    return () => sub.remove();
  }, []);
}

/** Test seam. */
export function __resetOtaCheckForTesting(): void { lastCheckAt = 0; running = false; }
