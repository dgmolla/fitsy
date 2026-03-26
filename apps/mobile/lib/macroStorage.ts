import AsyncStorage from '@react-native-async-storage/async-storage';

export const MACRO_TARGETS_KEY = '@fitsy/macro_targets';

export interface StoredMacroTargets {
  protein: string;
  carbs: string;
  fat: string;
  calories: string;
}

export async function getMacroTargets(): Promise<StoredMacroTargets | null> {
  const raw = await AsyncStorage.getItem(MACRO_TARGETS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredMacroTargets;
  } catch {
    return null;
  }
}

export async function saveMacroTargets(targets: StoredMacroTargets): Promise<void> {
  await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify(targets));
}

export async function clearMacroTargets(): Promise<void> {
  await AsyncStorage.removeItem(MACRO_TARGETS_KEY);
}
