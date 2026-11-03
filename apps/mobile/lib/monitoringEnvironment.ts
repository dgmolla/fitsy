import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

/** Release-mode validation bundles must never page production. */
export function monitoringEnvironment(): 'production' | 'development' {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if ((typeof __DEV__ !== 'undefined' && __DEV__) || Constants.expoConfig?.hostUri ||
      Updates.channel !== 'production' || !apiUrl) return 'development';
  try {
    return new URL(apiUrl).origin === 'https://fitsy.org' ? 'production' : 'development';
  } catch {
    return 'development';
  }
}
