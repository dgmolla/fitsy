import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@fitsy/onboardingPreviewEntry';

/** Only the nutrition-source Continue action opens another bounded preview pass. */
export async function rememberOnboardingPreviewEntry(): Promise<void> {
  await AsyncStorage.setItem(KEY, '1');
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
}
