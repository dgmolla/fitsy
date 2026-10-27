import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';

const KEY = '@fitsy/discoverySignIn';
let revision = 0;
export function discoveryDestination(value: string | null): '/welcome/location-permission' | '/welcome/preview' | '/(tabs)/search' | `/restaurant/${string}` | null {
  if (value === '/welcome/location-permission' || value === '/welcome/preview' || value === '/(tabs)/search') return value;
  return value && /^\/restaurant\/[a-zA-Z0-9_-]{1,128}$/.test(value) ? value as `/restaurant/${string}` : null;
}
export async function readDiscoverySignIn() {
  try { return discoveryDestination(await AsyncStorage.getItem(KEY)); }
  catch { return null; }
}
export async function clearDiscoverySignIn(): Promise<void> {
  revision++;
  await AsyncStorage.removeItem(KEY).catch(() => {});
}
export async function requestDiscoverySignIn(destination: string, isCurrent: () => boolean = () => true): Promise<void> {
  const safe = discoveryDestination(destination);
  if (!safe) throw new Error('Invalid discovery destination');
  if (!isCurrent()) return;
  const requestRevision = ++revision;
  // A storage failure must still reach sign-in; it cannot authorize data.
  try { await AsyncStorage.setItem(KEY, safe); } catch { /* Sign-in is still required. */ }
  if (requestRevision !== revision) return;
  if (!isCurrent()) { await clearDiscoverySignIn(); return; }
  router.replace({ pathname: '/welcome/signin', params: { returnTo: 'discovery' } });
}
export function discoveryDestinationForApi(path: string): string | null {
  const pathname = path.split('?')[0];
  const menu = pathname?.match(/^\/api\/restaurants\/([a-zA-Z0-9_-]{1,128})\/menu$/);
  if (menu) return `/restaurant/${menu[1]}`;
  if (pathname === '/api/restaurants/preview') return '/welcome/preview';
  if (pathname === '/api/restaurants') return '/(tabs)/search';
  return null;
}
