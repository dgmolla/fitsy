import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@fitsy/onboardingPreviewEntry';
const listeners = new Set<() => void>();

export function subscribeOnboardingPreviewEntry(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Only the nutrition-source Continue action opens another bounded preview pass. */
export async function rememberOnboardingPreviewEntry(): Promise<void> {
  await AsyncStorage.setItem(KEY, '1');
  notify();
}

export async function readOnboardingPreviewEntry(): Promise<boolean> {
  try {
    return await AsyncStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export async function clearOnboardingPreviewEntry(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
  notify();
}
