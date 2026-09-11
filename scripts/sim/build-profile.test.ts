import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const profile = (testStore: boolean, env: Record<string, string>) => spawnSync(process.execPath, ['--input-type=module', '-e',
  `import { buildProfile } from ${JSON.stringify(resolve(__dirname, 'build-profile.mjs'))}; process.stdout.write(JSON.stringify(buildProfile(${testStore}, ${JSON.stringify(env)})));`,
], { encoding: 'utf8' });

test('a Test Store build selects Debug even if a real-store key is also configured', () => {
  const r = profile(true, { EXPO_PUBLIC_REVENUECAT_TEST_KEY: 'test_fixture', EXPO_PUBLIC_REVENUECAT_IOS_KEY: 'appl_fixture' });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toEqual({ configuration: 'Debug', storeMode: 'test-store', buildMode: 'owned-metro-test-store', metroPort: 8099 });
});
test.each([{}, { EXPO_PUBLIC_REVENUECAT_TEST_KEY: 'appl_wrong_store' }])('Test Store refuses missing or wrong store credentials: %j', env => {
  const r = profile(true, env);
  expect(r.status).toBe(1); expect(r.stderr).toContain('--test-store requires EXPO_PUBLIC_REVENUECAT_TEST_KEY');
});
test('a Test Store key in the iOS slot cannot produce a crashing Release build', () => {
  const r = profile(false, { EXPO_PUBLIC_REVENUECAT_IOS_KEY: 'test_fixture' });
  expect(r.status).toBe(1); expect(r.stderr).toContain('cannot be used in a Release build');
});
test.each([['', 'unconfigured'], ['appl_fixture', 'apple-simulator']])('Release identifies the selected iOS store: %s', (key, storeMode) => {
  const r = profile(false, { EXPO_PUBLIC_REVENUECAT_IOS_KEY: key, EXPO_PUBLIC_REVENUECAT_TEST_KEY: 'test_unused_in_release' });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toEqual({ configuration: 'Release', storeMode, buildMode: 'embedded-release' });
});

const nativeDelegate = '#if DEBUG\n    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")\n#else\n    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")\n#endif';
const delegate = (source: string, testStore: boolean) => spawnSync(process.execPath, ['--input-type=module', '-e',
  `import { buildProfile, bundleDelegate } from ${JSON.stringify(resolve(__dirname, 'build-profile.mjs'))}; process.stdout.write(bundleDelegate(${JSON.stringify(source)}, buildProfile(${testStore}, { EXPO_PUBLIC_REVENUECAT_TEST_KEY: 'test_fixture' })));`,
], { encoding: 'utf8' });
test('Debug uses the owned server, avoiding Expo embedded-development startup failure', () => {
  const r = delegate(nativeDelegate, true);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('http://localhost:8099/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&minify=false');
  expect(r.stdout).not.toMatch(/Bundle.main|RCTBundleURLProvider|#if DEBUG/);
});
test('repeated prebuilds preserve the owned endpoint and can return to embedded Release', () => {
  const first = delegate(nativeDelegate, true);
  expect(first.status).toBe(0);
  expect(delegate(first.stdout, true).stdout).toBe(first.stdout);
  const release = delegate(first.stdout, false);
  expect(release.status).toBe(0);
  expect(release.stdout).toContain('Bundle.main.url(forResource: "main", withExtension: "jsbundle")');
  expect(release.stdout).not.toContain('http://');
});
test('unknown native bundle wiring fails instead of testing an unidentified app', () => {
  const r = delegate('return URL(string: "https://unidentified.invalid/bundle")', true);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('Unrecognized bundle delegate');
});

const fixture = (name: string | undefined, reset: boolean) => spawnSync(process.execPath, ['--input-type=module', '-e',
  `import { fixtureLabel } from ${JSON.stringify(resolve(__dirname, 'build-profile.mjs'))}; process.stdout.write(fixtureLabel(${JSON.stringify(name)}, ${reset}));`,
], { encoding: 'utf8' });
test.each([[true, 'fresh-install-no-account'], [false, 'reinstall-preserving-keychain']] as const)('default and matching reserved fixture describe reset=%s', (reset, expected) => {
  const r = fixture(undefined, reset);
  expect(r.status).toBe(0); expect(r.stdout).toBe(expected);
  const explicit = fixture(expected, reset);
  expect(explicit.status).toBe(0); expect(explicit.stdout).toBe(expected);
});
test.each([['fresh-install-no-account', false, 'requires an explicit keychain reset'], ['reinstall-preserving-keychain', true, 'cannot request a keychain reset']] as const)('reserved fixture cannot contradict native state: %s', (name, reset, error) => {
  const r = fixture(name, reset);
  expect(r.status).toBe(1); expect(r.stderr).toContain(error);
});
test.each([true, false])('custom account/scenario names remain usable with reset=%s', reset => {
  const r = fixture('paywall-cancel-retry-account', reset);
  expect(r.status).toBe(0); expect(r.stdout).toBe('paywall-cancel-retry-account');
});
