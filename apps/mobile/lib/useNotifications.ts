/**
 * Notification permission + push-token helpers (S-226b).
 *
 * Mirrors the surface of `useLocation` (a thin wrapper over the underlying
 * Expo SDK), but exposes imperative functions instead of a React hook because
 * the priming screen MUST NOT request the OS prompt on mount — only on the
 * explicit "Allow notifications" CTA. iOS only allows
 * `Notifications.requestPermissionsAsync()` to actually surface the system
 * dialog once per install; running it on render would burn that one shot and
 * defeat the priming pattern entirely.
 *
 * `getExpoPushTokenAsync` reads `projectId` from
 * `Constants.expoConfig.extra.eas.projectId` so the same code path works in
 * Expo Go (returns null gracefully — no token issued there), the EAS dev
 * client, and TestFlight builds.
 */

import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

export type NotificationPermissionStatus = 'granted' | 'denied' | 'undetermined';

export interface RequestPermissionResult {
  status: NotificationPermissionStatus;
}

/**
 * Trigger the OS notification permission prompt.
 *
 * Idempotent at the OS level: after the first call, iOS returns the cached
 * status without re-prompting. Callers should treat any non-`granted` value
 * as a soft denial — they cannot prompt again, only deep-link to Settings.
 */
export async function requestPermissionsAsync(): Promise<RequestPermissionResult> {
  const { status } = await Notifications.requestPermissionsAsync();
  return { status: status as NotificationPermissionStatus };
}

/**
 * Fetch the Expo push token for this device.
 *
 * Returns `null` in environments that cannot issue a token (Expo Go, missing
 * projectId, simulator without push capability) so callers can no-op without
 * branching on errors. Real-device validation happens in the EAS dev build —
 * see ticket S-226b "Real-device gate".
 */
export async function getExpoPushTokenAsync(): Promise<string | null> {
  const projectId = Constants.expoConfig?.extra?.['eas']?.projectId as string | undefined;
  if (!projectId) {
    // Without a projectId, expo-notifications throws — return null so the
    // priming screen can still complete its redirect even on misconfigured
    // local builds.
    return null;
  }
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    return result.data ?? null;
  } catch {
    // Expo Go (SDK 53+) and simulators without push entitlement throw here.
    // Swallow — we'll re-attempt on the next session in a real build.
    return null;
  }
}
