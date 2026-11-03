import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const KEY = '@fitsy/hasSignedIn';
const ONBOARDING_ACCOUNT_KEY = '@fitsy/onboardingAccount';
const ACCOUNT_RECORDS = ['@fitsy/onboarding', '@fitsy/macro_targets'];
const ACCOUNT_PREFIXES = ['@fitsy/macro_targets:', '@fitsy/search_macro_targets:'];

/** A device hint only; it never identifies or authenticates the next account. */
export async function rememberAccountHistory(): Promise<void> {
  await AsyncStorage.setItem(KEY, '1').catch(() => {});
}

/** Only a newly created account may resume its intentional first-time setup. */
export async function rememberAccountOnboarding(userId: string | null): Promise<void> {
  if (userId) await AsyncStorage.setItem(ONBOARDING_ACCOUNT_KEY, userId);
  else await AsyncStorage.removeItem(ONBOARDING_ACCOUNT_KEY);
}

export async function hasAccountOnboarding(): Promise<boolean> {
  const [owner, { data }] = await Promise.all([
    AsyncStorage.getItem(ONBOARDING_ACCOUNT_KEY), supabase.auth.getSession(),
  ]);
  return !!owner && owner === data.session?.user.id;
}

export async function readAccountHistory(): Promise<boolean> {
  const [records, keys] = await Promise.all([
    AsyncStorage.multiGet([KEY, ...ACCOUNT_RECORDS]),
    AsyncStorage.getAllKeys(),
  ]);
  if (records[0][1] === '1') return true;
  // Upgrade existing installations without claiming or erasing their data.
  if (records.slice(1).some(([, raw]) => {
    try {
      const owner = JSON.parse(raw ?? 'null')?._owner;
      return typeof owner === 'string' && owner.length > 0;
    } catch { return false; }
  })) return true;
  return keys.some(key => ACCOUNT_PREFIXES.some(prefix => key.startsWith(prefix) && key.length > prefix.length));
}
