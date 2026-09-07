/**
 * PurchasesProvider purchase / restore: a confirmed store flow lets the user
 * in at once, and inside STORE_GRACE_MS a lagging server cannot bounce them
 * (the sync resolves to the verdict in effect, true).
 */
import {
  deferred,
  flush,
  mockAnalytics,
  mockApi,
  mockAuth,
  mockRc,
  mockStore,
  proInfo,
  renderProvider,
  setupPurchasesMocks,
  useFakeTimersKeepingFlush,
  type ProviderResult,
} from './usePurchasesTestKit';
import { act, waitFor } from '@testing-library/react-native';
import { ENTITLEMENT_CACHE_KEY } from './entitlement';
import { POST_PURCHASE_SYNC_CAP_MS, STORE_GRACE_MS } from './usePurchases';

setupPurchasesMocks();

type SyncResult = { active: boolean; synced: boolean };

/** Restore with the server held mid-flight; resolves once the cap has passed. */
async function restoreWithStalledSync(result: ProviderResult) {
  mockRc.restorePurchases.mockResolvedValue(proInfo);
  const pending = deferred<SyncResult>();
  mockApi.syncSubscription.mockReturnValue(pending.promise);
  let got: boolean | undefined;
  await act(async () => {
    const p = result.current.restore();
    await new Promise((r) => setImmediate(r));
    jest.advanceTimersByTime(POST_PURCHASE_SYNC_CAP_MS);
    got = await p;
  });
  return { got, pending };
}

describe('purchase / restore', () => {
  it('a confirmed purchase resolves true and is entitled immediately; a server "false" (REST lag) never downgrades it', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entitled).toBe(false);
    mockRc.purchasePackage.mockResolvedValue({ outcome: 'purchased', customerInfo: proInfo });
    mockApi.syncSubscription.mockResolvedValue({ active: false, synced: true });
    let got: boolean | undefined;
    await act(async () => { got = await result.current.purchase({} as never, 'test'); });
    // payment.tsx does `if (!isPro) return`: a charged user must get in.
    expect(got).toBe(true);
    expect(result.current.isPro).toBe(true);
    expect(result.current.entitled).toBe(true);
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBe('true');
    expect(mockApi.syncSubscription).toHaveBeenCalledWith('purchase');
    expect(mockAnalytics.trackEntitlementMismatch).toHaveBeenCalledWith({
      reason: 'purchase', device_pro: true, server_active: false,
    });
  });

  it('a purchase whose sync stalls or fails still leaves the user entitled', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entitled).toBe(false);
    mockRc.purchasePackage.mockResolvedValue({ outcome: 'purchased', customerInfo: proInfo });
    mockApi.syncSubscription.mockRejectedValue(new Error('offline'));
    let got: boolean | undefined;
    await act(async () => { got = await result.current.purchase({} as never, 'test'); });
    expect(got).toBe(true);
    expect(result.current.entitled).toBe(true);
    expect(mockAnalytics.trackEntitlementSyncFailed).toHaveBeenCalledWith({ reason: 'purchase' });
  });

  it('lets the user in when the sync stalls past the cap, and a late "false" inside the grace window is not applied', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    useFakeTimersKeepingFlush();
    const { got, pending } = await restoreWithStalledSync(result);
    expect(got).toBe(true);
    expect(result.current.entitled).toBe(true);
    expect(mockAnalytics.trackPurchasesRestored).toHaveBeenCalledWith({ is_pro: true });
    await act(async () => { pending.resolve({ active: false, synced: true }); });
    await flush();
    expect(result.current.entitled).toBe(true);
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBe('true');
    expect(mockAnalytics.trackEntitlementMismatch).toHaveBeenCalledWith({
      reason: 'restore', device_pro: true, server_active: false,
    });
    jest.useRealTimers();
  });

  it('a late "true" after a stalled sync still writes the cache', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    useFakeTimersKeepingFlush();
    const { pending } = await restoreWithStalledSync(result);
    // Simulate the optimistic cache write being lost, so the late answer is what refills it.
    delete mockStore[ENTITLEMENT_CACHE_KEY];
    await act(async () => { pending.resolve({ active: true, synced: true }); });
    await waitFor(() => expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBe('true'));
    expect(result.current.entitled).toBe(true);
    jest.useRealTimers();
  });

  it('inside the grace window a sync resolves to the verdict in effect (true) and goes over the wire as "purchase"; after it the server wins', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    useFakeTimersKeepingFlush();
    mockRc.purchasePackage.mockResolvedValue({ outcome: 'purchased', customerInfo: proInfo });
    mockApi.syncSubscription.mockResolvedValue({ active: true, synced: true });
    await act(async () => { await result.current.purchase({} as never, 'test'); });
    expect(result.current.entitled).toBe(true);

    // The search screen's mismatch handler fires right away; REST still lags.
    mockApi.syncSubscription.mockClear();
    mockApi.syncSubscription.mockResolvedValue({ active: false, synced: true });
    let verdict: boolean | null = null;
    await act(async () => { verdict = await result.current.syncEntitlement('mismatch'); });
    expect(verdict).toBe(true);
    expect(result.current.entitled).toBe(true);
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBe('true');
    // Never-downgrade on the server side too: the wire reason is 'purchase'.
    expect(mockApi.syncSubscription).toHaveBeenLastCalledWith('purchase');
    expect(mockAnalytics.trackEntitlementMismatch).toHaveBeenLastCalledWith({
      reason: 'mismatch', device_pro: true, server_active: false,
    });

    act(() => { jest.advanceTimersByTime(STORE_GRACE_MS); });
    await act(async () => { verdict = await result.current.syncEntitlement('mismatch'); });
    expect(verdict).toBe(false);
    expect(result.current.entitled).toBe(false);
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBe('false');
    expect(mockApi.syncSubscription).toHaveBeenLastCalledWith('mismatch');
    jest.useRealTimers();
  });

  it('a session dropped right after a purchase does not bounce the charged user (grace window)', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    useFakeTimersKeepingFlush();
    mockRc.purchasePackage.mockResolvedValue({ outcome: 'purchased', customerInfo: proInfo });
    mockApi.syncSubscription.mockResolvedValue({ active: true, synced: true });
    await act(async () => { await result.current.purchase({} as never, 'test'); });
    expect(result.current.entitled).toBe(true);

    mockAuth.session = null;
    let verdict: boolean | null = null;
    await act(async () => { verdict = await result.current.syncEntitlement('mismatch'); });
    expect(verdict).toBe(true);
    expect(result.current.entitled).toBe(true);

    act(() => { jest.advanceTimersByTime(STORE_GRACE_MS); });
    await act(async () => { verdict = await result.current.syncEntitlement('mismatch'); });
    expect(verdict).toBe(false);
    expect(result.current.entitled).toBe(false);
    jest.useRealTimers();
  });

  it('does not ask the server when the store says no', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    mockRc.purchasePackage.mockResolvedValue({ outcome: 'cancelled', customerInfo: null });
    let got: boolean | undefined;
    await act(async () => { got = await result.current.purchase({} as never, 'test'); });
    expect(got).toBe(false);
    expect(mockApi.syncSubscription).not.toHaveBeenCalled();
  });

  it('exposes the App Store manage sheet through the context (screens never touch the native seam)', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { await result.current.showManageSubscriptions(); });
    expect(mockRc.showManageSubscriptions).toHaveBeenCalledTimes(1);
  });
});
