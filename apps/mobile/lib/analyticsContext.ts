import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

/** Deployment channel, not proof of the installer used on a physical device. */
export function analyticsDistribution(): 'development' | 'testflight' | 'production' | 'unknown' {
  if ((typeof __DEV__ !== 'undefined' && __DEV__) || Constants.expoConfig?.hostUri) return 'development';
  if (Updates.channel === 'testflight' || Updates.channel === 'production') return Updates.channel;
  if (['development', 'preview', 'e2e'].includes(Updates.channel ?? '')) return 'development';
  return 'unknown';
}

export function isAnalyticsTestRuntime(): boolean {
  if (analyticsDistribution() === 'development') return true;
  try { return new URL(process.env.EXPO_PUBLIC_API_URL ?? '').origin !== 'https://fitsy.org'; }
  catch { return true; }
}

export interface AnalyticsUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  internalOrTest?: boolean;
}

export function analyticsAccount(user: AnalyticsUser) {
  return {
    // MVP scope is LA-only (see lib/locations.ts) - every resolvable search
    // area is LA, so this is derived as true for every identified account
    // rather than a self-reported opt-in. Revisit once a non-LA city ships.
    la_cohort: true,
    $internal_or_test_user: isAnalyticsTestRuntime() || user.internalOrTest === true ||
      user.app_metadata?.fitsy_internal_or_test === true || user.user_metadata?.fitsy_internal_or_test === true,
  };
}
