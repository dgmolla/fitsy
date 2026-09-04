const mockSync = jest.fn();
jest.mock('./entitlementSync', () => ({
  syncServerEntitlement: (...args: unknown[]) => mockSync(...args),
}));

import { act, renderHook } from '@testing-library/react-native';
import { SELF_HEAL_DELAYS_MS, useEntitlementSelfHeal } from './useEntitlementSelfHeal';

const flush = async () => { await act(async () => { await new Promise((r) => setImmediate(r)); }); };

beforeEach(() => {
  // Keep setImmediate real so `flush` can drain the sync promise chain.
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  mockSync.mockReset();
});
afterEach(() => jest.useRealTimers());

function setup(initial: { isPro: boolean; locked: boolean | null; fetchSeq?: number }) {
  const refetch = jest.fn();
  const hook = renderHook(
    (p: { isPro: boolean; locked: boolean | null; fetchSeq: number }) =>
      useEntitlementSelfHeal({ ...p, refetch }),
    { initialProps: { fetchSeq: 0, ...initial } },
  );
  return { ...hook, refetch };
}

describe('useEntitlementSelfHeal', () => {
  it.each([
    { isPro: false, locked: true },
    { isPro: true, locked: false },
    { isPro: true, locked: null },
  ])('does nothing for %j', async (props) => {
    setup(props);
    act(() => { jest.runAllTimers(); });
    await flush();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('syncs immediately and refetches when Pro meets a locked page', async () => {
    mockSync.mockResolvedValue({ active: true });
    const { refetch } = setup({ isPro: true, locked: true });
    act(() => { jest.advanceTimersByTime(0); });
    await flush();
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('retries with backoff while refetches stay locked, then stops', async () => {
    mockSync.mockResolvedValue({ active: true });
    const { refetch, rerender } = setup({ isPro: true, locked: true });
    let seq = 0;
    for (let i = 0; i < SELF_HEAL_DELAYS_MS.length; i++) {
      act(() => { jest.advanceTimersByTime(SELF_HEAL_DELAYS_MS[i]!); });
      await flush();
      expect(refetch).toHaveBeenCalledTimes(i + 1);
      // The refetch resolved, still locked.
      rerender({ isPro: true, locked: true, fetchSeq: ++seq });
    }
    act(() => { jest.advanceTimersByTime(60_000); });
    await flush();
    expect(mockSync).toHaveBeenCalledTimes(SELF_HEAL_DELAYS_MS.length);
    expect(refetch).toHaveBeenCalledTimes(SELF_HEAL_DELAYS_MS.length);
  });

  it('starts a fresh episode when Pro flips on again (e.g. purchase after an exhausted teaser)', async () => {
    mockSync.mockResolvedValue({ active: true });
    const { refetch, rerender } = setup({ isPro: true, locked: true });
    let seq = 0;
    for (let i = 0; i < SELF_HEAL_DELAYS_MS.length; i++) {
      act(() => { jest.advanceTimersByTime(SELF_HEAL_DELAYS_MS[i]!); });
      await flush();
      rerender({ isPro: true, locked: true, fetchSeq: ++seq });
    }
    expect(refetch).toHaveBeenCalledTimes(SELF_HEAL_DELAYS_MS.length);
    rerender({ isPro: false, locked: true, fetchSeq: seq });
    rerender({ isPro: true, locked: true, fetchSeq: seq });
    act(() => { jest.advanceTimersByTime(0); });
    await flush();
    expect(refetch).toHaveBeenCalledTimes(SELF_HEAL_DELAYS_MS.length + 1);
  });

  it('gives up when RevenueCat itself says not entitled, but still refetches when the sync could not run', async () => {
    mockSync.mockResolvedValueOnce({ active: false });
    const a = setup({ isPro: true, locked: true });
    act(() => { jest.advanceTimersByTime(0); });
    await flush();
    expect(a.refetch).not.toHaveBeenCalled();
    a.unmount();

    mockSync.mockResolvedValueOnce(null);
    const b = setup({ isPro: true, locked: true });
    act(() => { jest.advanceTimersByTime(0); });
    await flush();
    expect(b.refetch).toHaveBeenCalledTimes(1);
  });

  it('survives parent re-renders while an attempt is pending', async () => {
    mockSync.mockResolvedValue({ active: true });
    const { refetch, rerender } = setup({ isPro: true, locked: true });
    // Re-render with identical deps mid-wait (CustomerInfo listener, typing).
    rerender({ isPro: true, locked: true, fetchSeq: 0 });
    rerender({ isPro: true, locked: true, fetchSeq: 0 });
    act(() => { jest.advanceTimersByTime(0); });
    await flush();
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
