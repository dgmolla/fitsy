import AsyncStorage from '@react-native-async-storage/async-storage';
import { canPreviewAfterDecline, paywallVariants, readPaywallDecline, rememberPaywallDecline } from './paywallAccess';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn() } }));

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
  const pending = readPaywallDecline();
  await rememberPaywallDecline(); resolve(null);
  expect(await pending).toBe(true);
  expect(await readPaywallDecline()).toBe(true);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('@fitsy/paywallDeclined', '1');
});
