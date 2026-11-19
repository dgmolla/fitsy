import 'react-native-url-polyfill/auto';
/** Older onboarding links used the subscription-gated tab route for the preview.
 *  The Home Screen widget links its no-dish states (empty, needs location, signed out)
 *  to `/widget`; a person tapping the widget wants food, not setup steps, so they land on
 *  Discovery's map, which explains the empty state itself (#1006). `?upgrade=1` (the locked
 *  state) still reaches the widget screen's paywall hand-off. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const url = new URL(path, 'https://fitsy.invalid');
    const route = url.protocol === 'com.fitsy.mobile:' ? `/${url.hostname}${url.pathname}` : url.pathname;
    if ((route === '/search' || route === '/(tabs)/search') && url.searchParams.get('preview') === '1') {
      // The welcome route still enforces live preview access and hard decline.
      return '/welcome/preview';
    }
    if (route.replace(/\/{2,}/g, '/') === '/widget' && url.searchParams.get('upgrade') !== '1') return '/(tabs)/search';
  } catch { /* Preserve unrelated auth/provider links, even if they are not URLs. */ }
  return path;
}
