import AsyncStorage from '@react-native-async-storage/async-storage';

const DECLINED_KEY = '@fitsy/paywallDeclined';
const listeners = new Set<() => void>();
let declined: boolean | null = null;
let reading: Promise<boolean> | null = null;
export const subscribePaywallAccess = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** RevenueCat can assign offerings to experiment cohorts. Missing/invalid
 * metadata uses the launch baseline; it never grants post-decline browsing. */
export function paywallVariants(metadata?: Record<string, unknown> | null) {
  return {
    access: metadata?.paywall_access_variant === 'preview' ? 'preview' as const : 'hard' as const,
    image: metadata?.paywall_image_variant === 'none' ? 'none' as const : 'meal' as const,
  };
}
export function canPreviewAfterDecline(hasDeclined: boolean, access: 'hard' | 'preview') {
  return !hasDeclined || access === 'preview';
}
export function readPaywallDecline(): Promise<boolean> {
  if (declined !== null) return Promise.resolve(declined);
  if (!reading) reading = AsyncStorage.getItem(DECLINED_KEY).then(value => {
    // A user may decline while this storage read is in flight.
    declined ??= value === '1'; return declined;
  }).catch(() => { declined ??= true; return declined; });
  return reading;
}
export async function rememberPaywallDecline(): Promise<void> {
  declined = true;
  for (const listener of listeners) listener();
  await AsyncStorage.setItem(DECLINED_KEY, '1');
}
