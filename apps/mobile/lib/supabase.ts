/**
 * Mobile Supabase client with SecureStore-backed session persistence.
 *
 * Why this exists: round-1 testers were getting bounced to /welcome/problem
 * after ~1 hour because we only stored the access token in SecureStore and
 * had no refresh path. Supabase access tokens expire in ~1h; the SDK handles
 * proactive refresh (~5 min before expiry), refresh-token rotation, and
 * reuse detection out of the box.
 *
 * Storage key convention: keep underscores, not colons (commit 3683309 fix —
 * SecureStore rejects colons in keys, which silently broke session writes).
 *
 * AppState wiring lives in app/_layout.tsx (per Supabase RN docs):
 *   supabase.auth.startAutoRefresh() on foreground
 *   supabase.auth.stopAutoRefresh() on background
 */

import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Loud warning rather than silent fallback — mirrors the analytics pattern.
  // Without these env vars the SDK init still succeeds with empty strings,
  // but every auth call will 4xx — fail loud at boot so it's obvious.
  // eslint-disable-next-line no-console
  console.warn(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY missing — auth refresh will not work.',
  );
}

/**
 * SecureStore adapter that conforms to Supabase's SupportedStorage interface.
 * The SDK calls these to persist + retrieve the session JSON (access_token,
 * refresh_token, expires_at). All values are written to a single key managed
 * by the SDK — we just provide the raw read/write/remove primitives.
 *
 * Exported for direct unit testing — the SDK is mocked in jest, so verifying
 * the adapter against `expo-secure-store` is the only way to catch regressions
 * in the read/write/delete contract.
 */
export const secureStoreAdapter = {
  getItem: (key: string): Promise<string | null> => {
    return SecureStore.getItemAsync(key);
  },
  setItem: (key: string, value: string): Promise<void> => {
    return SecureStore.setItemAsync(key, value);
  },
  removeItem: (key: string): Promise<void> => {
    return SecureStore.deleteItemAsync(key);
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: secureStoreAdapter,
    persistSession: true,
    autoRefreshToken: true,
    // RN has no URL bar — disable session detection from URL fragments
    // (default behaviour for browser-based OAuth callbacks does not apply).
    detectSessionInUrl: false,
  },
});
