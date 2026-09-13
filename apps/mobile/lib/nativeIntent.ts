/** Older onboarding links used the subscription-gated tab route for the preview. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const url = new URL(path, 'https://fitsy.invalid');
    const route = url.protocol === 'com.fitsy.mobile:' ? `/${url.hostname}${url.pathname}` : url.pathname;
    if ((route === '/search' || route === '/(tabs)/search') && url.searchParams.get('preview') === '1') {
      // The welcome route still enforces live preview access and hard decline.
      return '/welcome/preview';
    }
  } catch { /* Preserve unrelated auth/provider links, even if they are not URLs. */ }
  return path;
}
