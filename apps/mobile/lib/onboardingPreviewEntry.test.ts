import AsyncStorage from '@react-native-async-storage/async-storage';
import { consumeShowWidgetTip, rememberShowWidgetTip } from './onboardingPreviewEntry';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() } }));

beforeEach(() => jest.clearAllMocks());

test('the widget tip is remembered once and consumed exactly once', async () => {
  jest.mocked(AsyncStorage.setItem).mockResolvedValue();
  jest.mocked(AsyncStorage.removeItem).mockResolvedValue();
  await rememberShowWidgetTip();
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('@fitsy/onboardingWidgetTip', '1');

  jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce('1');
  expect(await consumeShowWidgetTip()).toBe(true);
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@fitsy/onboardingWidgetTip');

  // A second read (e.g. a returning sign-in that reaches payment directly,
  // or re-entering completion after the first consume) finds nothing left.
  jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce(null);
  expect(await consumeShowWidgetTip()).toBe(false);
});

test('a storage read failure never shows the tip, and a missing value is false', async () => {
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage unavailable'));
  expect(await consumeShowWidgetTip()).toBe(false);
  jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce(null);
  expect(await consumeShowWidgetTip()).toBe(false);
});
