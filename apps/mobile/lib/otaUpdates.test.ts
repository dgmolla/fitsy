import { Alert } from 'react-native';
import * as Updates from 'expo-updates';
import { trackOtaUpdateCheck } from './analytics';
import { captureException } from './sentry';
import { checkTestflightUpdate, isTestflightOta, otaDiagnostics, __resetOtaCheckForTesting } from './otaUpdates';

jest.mock('expo-updates', () => ({
  __esModule: true,
  isEnabled: true, channel: 'testflight', updateId: 'embedded-id', runtimeVersion: '3b44b178e615',
  isEmbeddedLaunch: true, checkForUpdateAsync: jest.fn(), fetchUpdateAsync: jest.fn(), reloadAsync: jest.fn(),
}));
jest.mock('./analytics', () => ({ trackOtaUpdateCheck: jest.fn() }));
jest.mock('./sentry', () => ({ captureException: jest.fn() }));

const updates = (jest.requireMock('expo-updates') as jest.Mocked<typeof Updates> & { channel: string | null });
const stages = () => (trackOtaUpdateCheck as jest.Mock).mock.calls.map(([p]) => p.stage);
let alertSpy: jest.SpyInstance;

beforeEach(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  jest.clearAllMocks();
  __resetOtaCheckForTesting();
  updates.channel = 'testflight';
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

it('reports what the device runs', () => {
  expect(otaDiagnostics()).toEqual({ updateId: 'embedded-id', channel: 'testflight', runtimeVersion: '3b44b178e615', isEmbeddedLaunch: true });
});

it('downloads a newer update and offers a restart that reloads', async () => {
  updates.checkForUpdateAsync.mockResolvedValue({ isAvailable: true, manifest: { id: 'new-id' } } as never);
  updates.fetchUpdateAsync.mockResolvedValue({ isNew: true, manifest: { id: 'new-id' } } as never);
  await checkTestflightUpdate();
  expect(stages()).toEqual(['check', 'fetch', 'reload_prompt']);
  const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  buttons.find(b => b.text === 'Restart')?.onPress?.();
  expect(updates.reloadAsync).toHaveBeenCalled();
});

it('stops quietly when no update is available, and throttles repeat foreground checks', async () => {
  updates.checkForUpdateAsync.mockResolvedValue({ isAvailable: false } as never);
  await checkTestflightUpdate(1_000_000);
  await checkTestflightUpdate(1_010_000);
  expect(updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
  expect(stages()).toEqual(['check']);
  expect(alertSpy).not.toHaveBeenCalled();
});

it('reports a failed download with its stage to analytics and Sentry', async () => {
  updates.checkForUpdateAsync.mockResolvedValue({ isAvailable: true, manifest: { id: 'new-id' } } as never);
  updates.fetchUpdateAsync.mockRejectedValue(new TypeError('network'));
  await checkTestflightUpdate();
  expect(trackOtaUpdateCheck).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'error', error_name: 'fetch:TypeError' }));
  expect(captureException).toHaveBeenCalledTimes(1);
});

it('does nothing outside the testflight channel', async () => {
  updates.channel = 'production';
  expect(isTestflightOta()).toBe(false);
  await checkTestflightUpdate();
  expect(updates.checkForUpdateAsync).not.toHaveBeenCalled();
});
