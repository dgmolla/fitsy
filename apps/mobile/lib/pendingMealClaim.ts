import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@fitsy/pendingMealClaim';

/** A locked anonymous meal is waiting for sign-in, even without checkout. */
export async function rememberPendingMealClaim(): Promise<void> {
  await AsyncStorage.setItem(KEY, '1');
}

export async function hasPendingMealClaim(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY)) === '1';
}

export async function clearPendingMealClaim(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
