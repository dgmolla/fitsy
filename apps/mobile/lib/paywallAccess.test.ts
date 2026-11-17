import AsyncStorage from '@react-native-async-storage/async-storage';
import { canPreviewAfterDecline, paywallVariants, readPaywallDecline, rememberPaywallDecline, setDevPaywallAccess } from './paywallAccess';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() } }));

test('approved launch defaults use meal imagery and a hard paywall; explicit variants remain available', () => {
  expect(paywallVariants()).toEqual({ access: 'hard', image: 'meal' });
  expect(paywallVariants({ paywall_access_variant: true, paywall_image_variant: 'unknown' })).toEqual({ access: 'hard', image: 'meal' });
  expect(paywallVariants({ paywall_image_variant: 'none' })).toEqual({ access: 'hard', image: 'none' });
  expect(paywallVariants({ paywall_access_variant: 'preview', paywall_image_variant: 'meal' })).toEqual({ access: 'preview', image: 'meal' });
  expect(canPreviewAfterDecline(false, 'hard')).toBe(true);
  expect(canPreviewAfterDecline(true, 'hard')).toBe(false);
  expect(canPreviewAfterDecline(true, 'preview')).toBe(true);
});
test('a pending storage read cannot reopen preview after the user declines', async () => {
  let resolve!: (value: string | null) => void;
  jest.mocked(AsyncStorage.getItem).mockReturnValue(new Promise(done => { resolve = done; }));
  jest.mocked(AsyncStorage.setItem).mockResolvedValue();
  jest.mocked(AsyncStorage.removeItem).mockResolvedValue();
  const pending = readPaywallDecline();
  await rememberPaywallDecline(); resolve(null);
  expect(await pending).toBe(true);
  expect(await readPaywallDecline()).toBe(true);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('@fitsy/paywallDeclined', '1');
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@fitsy/onboardingPreviewEntry');
});

const globals = globalThis as { __DEV__?: boolean };

test('a Debug-only pin overrides the live metadata for native flows, and any other value clears it', () => {
  globals.__DEV__ = true;
  expect(paywallVariants({ paywall_access_variant: 'unknown' }).access).toBe('hard');
  setDevPaywallAccess('preview');
  expect(paywallVariants().access).toBe('preview');
  expect(paywallVariants({ paywall_access_variant: 'preview' }).access).toBe('preview');
  setDevPaywallAccess('hard');
  expect(paywallVariants({ paywall_access_variant: 'preview' }).access).toBe('hard');
  setDevPaywallAccess('nonsense');
  expect(paywallVariants({ paywall_access_variant: 'preview' }).access).toBe('preview');
  expect(paywallVariants().access).toBe('hard');
  delete globals.__DEV__;
});

test('release builds ignore the pin entirely', () => {
  const original = globals.__DEV__;
  globals.__DEV__ = false;
  try {
    jest.isolateModules(() => {
      const release = require('./paywallAccess') as typeof import('./paywallAccess');
      release.setDevPaywallAccess('preview');
      expect(release.paywallVariants().access).toBe('hard');
    });
  } finally { if (original === undefined) delete globals.__DEV__; else globals.__DEV__ = original; }
});
