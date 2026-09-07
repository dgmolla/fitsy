import { act, renderHook } from '@testing-library/react-native';
import { MISMATCH_DELAYS_MS, useEntitlementMismatch } from './useEntitlementMismatch';

const flush = async () => { await act(async () => { await new Promise((r) => setImmediate(r)); }); };

type Props = { entitled: boolean | null; isPro: boolean; locked: boolean | null; fetchSeq: number };

beforeEach(() => {
  // Keep setImmediate real so `flush` can drain the sync promise chain.
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
});
afterEach(() => jest.useRealTimers());

function setup(initial: Partial<Props>) {
  const refetch = jest.fn();
  const syncEntitlement = jest.fn<Promise<boolean | null>, ['mismatch']>();
  const hook = renderHook(
    (p: Props) => useEntitlementMismatch({ ...p, refetch, syncEntitlement }),
    { initialProps: { entitled: null, isPro: false, locked: null, fetchSeq: 0, ...initial } },
  );
  return { ...hook, refetch, syncEntitlement };
}

describe('useEntitlementMismatch', () => {
  it.each([
    { entitled: false, isPro: false, locked: true },
    { entitled: null, isPro: false, locked: true },
    { entitled: true, isPro: true, locked: false },
    { entitled: true, isPro: true, locked: null },
  ])('does nothing for %j', async (props) => {
    const { syncEntitlement } = setup(props);
    act(() => { jest.runAllTimers(); });
    await flush();
    expect(syncEntitlement).not.toHaveBeenCalled();
  });

  it.each([
    { entitled: true, isPro: false },
    { entitled: null, isPro: true },
  ])('syncs immediately and refetches when %j meets a locked page', async (belief) => {
    const { refetch, syncEntitlement } = setup({ ...belief, locked: true });
    syncEntitlement.mockResolvedValue(true);
    act(() => { jest.advanceTimersByTime(0); });
    await flush();
    expect(syncEntitlement).toHaveBeenCalledWith('mismatch');
    expect(syncEntitlement).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('retries with backoff while refetches stay locked, then stops', async () => {
    const { refetch, syncEntitlement, rerender } = setup({ entitled: true, isPro: true, locked: true });
    syncEntitlement.mockResolvedValue(true);
    let seq = 0;
    for (let i = 0; i < MISMATCH_DELAYS_MS.length; i++) {
      act(() => { jest.advanceTimersByTime(MISMATCH_DELAYS_MS[i]!); });
      await flush();
      expect(refetch).toHaveBeenCalledTimes(i + 1);
      // The refetch resolved, still locked.
      rerender({ entitled: true, isPro: true, locked: true, fetchSeq: ++seq });
    }
    act(() => { jest.advanceTimersByTime(60_000); });
    await flush();
    expect(syncEntitlement).toHaveBeenCalledTimes(MISMATCH_DELAYS_MS.length);
    expect(refetch).toHaveBeenCalledTimes(MISMATCH_DELAYS_MS.length);
  });

  it('starts a fresh episode when the belief flips on again (e.g. purchase after an exhausted teaser)', async () => {
    const { refetch, syncEntitlement, rerender } = setup({ entitled: true, isPro: true, locked: true });
    syncEntitlement.mockResolvedValue(true);
    let seq = 0;
    for (let i = 0; i < MISMATCH_DELAYS_MS.length; i++) {
      act(() => { jest.advanceTimersByTime(MISMATCH_DELAYS_MS[i]!); });
      await flush();
      rerender({ entitled: true, isPro: true, locked: true, fetchSeq: ++seq });
    }
    expect(refetch).toHaveBeenCalledTimes(MISMATCH_DELAYS_MS.length);
    rerender({ entitled: false, isPro: false, locked: true, fetchSeq: seq });
    rerender({ entitled: true, isPro: true, locked: true, fetchSeq: seq });
    act(() => { jest.advanceTimersByTime(0); });
    await flush();
    expect(refetch).toHaveBeenCalledTimes(MISMATCH_DELAYS_MS.length + 1);
  });

  it('a stored "false" ends the episode (layout redirects); "null" (could not ask) still refetches', async () => {
    const a = setup({ entitled: true, isPro: true, locked: true });
    a.syncEntitlement.mockResolvedValueOnce(false);
    act(() => { jest.advanceTimersByTime(0); });
    await flush();
    expect(a.refetch).not.toHaveBeenCalled();
    a.unmount();

    const b = setup({ entitled: true, isPro: true, locked: true });
    b.syncEntitlement.mockResolvedValueOnce(null);
    act(() => { jest.advanceTimersByTime(0); });
    await flush();
    expect(b.refetch).toHaveBeenCalledTimes(1);
  });

  it('survives parent re-renders while an attempt is pending', async () => {
    const { refetch, syncEntitlement, rerender } = setup({ entitled: true, isPro: true, locked: true });
    syncEntitlement.mockResolvedValue(true);
    // Re-render with identical deps mid-wait (CustomerInfo listener, typing).
    rerender({ entitled: true, isPro: true, locked: true, fetchSeq: 0 });
    rerender({ entitled: true, isPro: true, locked: true, fetchSeq: 0 });
    act(() => { jest.advanceTimersByTime(0); });
    await flush();
    expect(syncEntitlement).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
