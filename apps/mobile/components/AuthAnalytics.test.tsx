import { act, renderHook } from '@testing-library/react-native';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

const mockClient = {
  identify: jest.fn(), reloadFeatureFlags: jest.fn(), reset: jest.fn(), capture: jest.fn(),
};
jest.mock('posthog-react-native', () => {
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'unit-test-analytics';
  return jest.fn().mockImplementation(() => mockClient);
});
const mockListeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
const mockUnsubscribe = jest.fn();
jest.mock('../lib/supabase', () => ({ supabase: { auth: {
  onAuthStateChange: (listener: (event: AuthChangeEvent, session: Session | null) => void) => {
    mockListeners.add(listener);
    return { data: { subscription: { unsubscribe: () => {
      mockUnsubscribe();
      mockListeners.delete(listener);
    } } } };
  },
} } }));

import { __resetForTesting } from '../lib/analytics';
import { useAuthAnalytics } from '../lib/useAuthAnalytics';

const user = { id: '5f6a80d8-482a-4eba-b716-4e661131e17f', email: 'fixture@privaterelay.appleid.com' };
function emit(event: AuthChangeEvent, account: { id: string; email?: string } | null = user) {
  act(() => {
    for (const listener of mockListeners) listener(event, account ? { user: account } as Session : null);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListeners.clear();
  __resetForTesting();
});

test.each<AuthChangeEvent>(['INITIAL_SESSION', 'SIGNED_IN'])(
  '%s identifies the backend account and email before refreshing flags', event => {
    renderHook(useAuthAnalytics);
    emit(event);
    expect(mockClient.identify).toHaveBeenCalledWith(user.id, { email: user.email });
    expect(mockClient.reloadFeatureFlags).toHaveBeenCalledTimes(1);
    expect(mockClient.identify.mock.invocationCallOrder[0])
      .toBeLessThan(mockClient.reloadFeatureFlags.mock.invocationCallOrder[0]!);
  },
);

test('an anonymous cold start does not identify or refresh account flags', () => {
  renderHook(useAuthAnalytics);
  emit('INITIAL_SESSION', null);
  expect(mockClient.identify).not.toHaveBeenCalled();
  expect(mockClient.reloadFeatureFlags).not.toHaveBeenCalled();
});

test('identification also runs in release mode and supports sessions without email', () => {
  const dev = __DEV__;
  try {
    Object.defineProperty(globalThis, '__DEV__', { value: false, configurable: true });
    renderHook(useAuthAnalytics);
    emit('INITIAL_SESSION', { id: user.id });
    expect(mockClient.identify).toHaveBeenCalledWith(user.id, {});
    expect(mockClient.reloadFeatureFlags).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(globalThis, '__DEV__', { value: dev, configurable: true });
  }
});

test.each(['identify', 'reloadFeatureFlags'] as const)('%s failures do not break authentication', method => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockClient[method].mockImplementationOnce(() => { throw new Error('private SDK error'); });
  try {
    renderHook(useAuthAnalytics);
    expect(() => emit('SIGNED_IN')).not.toThrow();
    expect(warn).toHaveBeenCalledWith('[analytics] capture(identify) failed');
  } finally {
    warn.mockRestore();
  }
});

test('sign-out resets identity before another account signs in', () => {
  renderHook(useAuthAnalytics);
  emit('INITIAL_SESSION');
  emit('SIGNED_OUT', null);
  const next = { id: 'ce88a6ec-8186-4d8b-9ffc-75749ab1374f', email: 'second@example.test' };
  emit('SIGNED_IN', next);
  expect(mockClient.reset).toHaveBeenCalledTimes(1);
  expect(mockClient.identify).toHaveBeenLastCalledWith(next.id, { email: next.email });
  expect(mockClient.reset.mock.invocationCallOrder[0])
    .toBeLessThan(mockClient.identify.mock.invocationCallOrder[1]!);
});

test('refresh telemetry and subscription cleanup remain intact', () => {
  const hook = renderHook(useAuthAnalytics);
  emit('SIGNED_IN');
  emit('TOKEN_REFRESHED');
  emit('SIGNED_OUT', null);
  expect(mockClient.capture).toHaveBeenCalledWith('session_refreshed', {});
  expect(mockClient.capture).toHaveBeenCalledWith('session_refresh_failed', {});
  hook.unmount();
  expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  expect(mockListeners.size).toBe(0);
});
