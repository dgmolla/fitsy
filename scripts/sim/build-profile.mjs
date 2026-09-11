// Test Store is only supported in Debug; never label a Release test key as Apple.
export function buildProfile(testStore, env) {
  if (testStore) {
    if (!env.EXPO_PUBLIC_REVENUECAT_TEST_KEY?.startsWith('test_')) {
      throw new Error('--test-store requires EXPO_PUBLIC_REVENUECAT_TEST_KEY from the dev configuration');
    }
    return { configuration: 'Debug', storeMode: 'test-store', buildMode: 'owned-metro-test-store', metroPort: 8099 };
  }
  if (env.EXPO_PUBLIC_REVENUECAT_IOS_KEY?.startsWith('test_')) {
    throw new Error('A Test Store key cannot be used in a Release build');
  }
  return { configuration: 'Release', storeMode: env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ? 'apple-simulator' : 'unconfigured', buildMode: 'embedded-release' };
}

export const metroRoute = '/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&minify=false';
const embedded = 'Bundle.main.url(forResource: "main", withExtension: "jsbundle")';
export function bundleDelegate(source, profile) {
  const normalized = source
    .replace(/#if DEBUG\n\s*return RCTBundleURLProvider[^\n]+\n#else\n(\s*return Bundle.main[^\n]+)\n#endif/, '$1')
    .replace(/URL\(string: "http:\/\/(?:localhost|127\.0\.0\.1):8099\/\.expo\/\.virtual-metro-entry\.bundle\?platform=ios&dev=true&minify=false"\)/, embedded);
  if (!normalized.includes(embedded) || normalized.includes('RCTBundleURLProvider.sharedSettings()')) {
    throw new Error('Unrecognized bundle delegate; inspect the generated native project');
  }
  return profile.metroPort ? normalized.replace(embedded, `URL(string: "http://localhost:${profile.metroPort}${metroRoute}")`) : normalized;
}
