import AsyncStorage from '@react-native-async-storage/async-storage';

const ACTIVE_KEY = '@fitsy/macro_targets';
const LEGACY_KEY = '@fitsy/legacy_unowned_macro_targets';
let queue: Promise<void> = Promise.resolve();
function serialize(work: () => Promise<void>): Promise<void> {
  const attempt = queue.then(work, work);
  queue = attempt.catch(() => {});
  return attempt;
}

/** A delayed pre-deletion read cannot recreate a removed quarantine. */
export function quarantineLegacyMacroRecord(raw: string): Promise<void> {
  return serialize(async () => {
    if (await AsyncStorage.getItem(ACTIVE_KEY) !== raw) return;
    await AsyncStorage.setItem(LEGACY_KEY, raw);
    await AsyncStorage.removeItem(ACTIVE_KEY);
  });
}

export function forgetLegacyMacroRecords(): Promise<void> {
  return serialize(async () => {
    const raw = await AsyncStorage.getItem(ACTIVE_KEY);
    if (raw) {
      try {
        if (JSON.parse(raw)._owner === undefined) await AsyncStorage.removeItem(ACTIVE_KEY);
      } catch { await AsyncStorage.removeItem(ACTIVE_KEY); }
    }
    await AsyncStorage.removeItem(LEGACY_KEY);
  });
}
