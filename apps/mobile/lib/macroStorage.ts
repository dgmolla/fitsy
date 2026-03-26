import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MacroValues } from '@/lib/macroPresets';

export const MACRO_STORAGE_KEY = '@fitsy/macro_targets';

export async function getMacroTargets(): Promise<MacroValues | null> {
  const raw = await AsyncStorage.getItem(MACRO_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MacroValues;
  } catch {
    return null;
  }
}

export async function saveMacroTargets(values: MacroValues): Promise<void> {
  await AsyncStorage.setItem(MACRO_STORAGE_KEY, JSON.stringify(values));
}
