/**
 * PurchasesProvider boot: who decides (the server), what stands in while it
 * can't (cache, then the device as a last resort), and that `entitled` is
 * set exactly once per boot (`ready` is `entitled !== null`).
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
} from './usePurchasesTestKit';
import { act, waitFor } from '@testing-library/react-native';
import { ENTITLEMENT_CACHE_KEY } from './entitlement';
import { BOOT_VERDICT_CAP_MS } from './usePurchases';

setupPurchasesMocks();

type StatusResult = { active: boolean; status: null; expiresAt: null };

describe('boot', () => {
  it('a loaded offering without configured store eligibility never promises a trial', async () => {
    const offering = { identifier: 'test', availablePackages: [{ product: { identifier: 'annual' } }] };
    mockRc.fetchCurrentOffering.mockResolvedValueOnce(offering as never);
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.offering).toEqual(offering));
    await flush();
    expect(result.current.ready).toBe(true);
    expect(result.current.introEligibility).toEqual({});
  });

  it('reads the stored verdict (status, not sync), stores it, caches it, and only then becomes ready', async () => {
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null });
    const { result } = renderProvider();
    expect(result.current.ready).toBe(false);
    expect(result.current.entitled).toBeNull();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entitled).toBe(true);
    expect(mockApi.fetchSubscriptionStatus).toHaveBeenCalledTimes(1);
    expect(mockApi.syncSubscription).not.toHaveBeenCalled();
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBe('true');
    // Device (free) disagreed with the server (active): measured.
    expect(mockAnalytics.trackEntitlementMismatch).toHaveBeenCalledWith({
      reason: 'boot', device_pro: false, server_active: true,
    });
  });

  it('a stale cached "false" never gates: entitled stays null until the prompt server "true" lands', async () => {
    useFakeTimersKeepingFlush();
    mockStore[ENTITLEMENT_CACHE_KEY] = 'false';
    const pending = deferred<StatusResult>();
    mockApi.fetchSubscriptionStatus.mockReturnValue(pending.promise);
    const { result } = renderProvider();
    await flush();
    await flush();
    expect(result.current.entitled).toBeNull();
    expect(result.current.ready).toBe(false);
    await act(async () => { pending.resolve({ active: true, status: null, expiresAt: null }); });
    await flush();
    expect(result.current.ready).toBe(true);
    expect(result.current.entitled).toBe(true);
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBe('true');
    jest.useRealTimers();
  });

  it('past the cap the cached verdict stands and becomes ready; the late server answer is still applied', async () => {
    useFakeTimersKeepingFlush();
    mockStore[ENTITLEMENT_CACHE_KEY] = 'false';
    const pending = deferred<StatusResult>();
    mockApi.fetchSubscriptionStatus.mockReturnValue(pending.promise);
    const { result } = renderProvider();
    await flush();
    await flush();
    expect(result.current.ready).toBe(false);
    act(() => { jest.advanceTimersByTime(BOOT_VERDICT_CAP_MS); });
    await flush();
    expect(result.current.ready).toBe(true);
    expect(result.current.entitled).toBe(false);
    await act(async () => { pending.resolve({ active: true, status: null, expiresAt: null }); });
    await flush();
    expect(result.current.entitled).toBe(true);
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBe('true');
    jest.useRealTimers();
  });

  it('a cached "true" never flashes the app: a prompt server "false" is what settles it', async () => {
    useFakeTimersKeepingFlush();
    mockStore[ENTITLEMENT_CACHE_KEY] = 'true';
    const pending = deferred<StatusResult>();
    mockApi.fetchSubscriptionStatus.mockReturnValue(pending.promise);
    const { result } = renderProvider();
    await flush();
    await flush();
    expect(result.current.entitled).toBeNull();
    await act(async () => { pending.resolve({ active: false, status: null, expiresAt: null }); });
    await flush();
    expect(result.current.ready).toBe(true);
    expect(result.current.entitled).toBe(false);
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBe('false');
    jest.useRealTimers();
  });

  it('past the cap with no cache falls back to the device, and a slow server answer still replaces it', async () => {
    useFakeTimersKeepingFlush();
    mockRc.identifyPurchasesUser.mockResolvedValue(proInfo);
    const pending = deferred<StatusResult>();
    mockApi.fetchSubscriptionStatus.mockReturnValue(pending.promise);
    const { result } = renderProvider();
    await flush();
    await flush();
    expect(result.current.ready).toBe(false);
    act(() => { jest.advanceTimersByTime(BOOT_VERDICT_CAP_MS); });
    await flush();
    expect(result.current.ready).toBe(true);
    expect(result.current.entitled).toBe(true);
    await act(async () => { pending.resolve({ active: false, status: null, expiresAt: null }); });
    await flush();
    expect(result.current.entitled).toBe(false);
    jest.useRealTimers();
  });

  it('falls back to the device verdict only when offline with no cache (subscriber not bounced)', async () => {
    mockApi.fetchSubscriptionStatus.mockRejectedValue(new Error('offline'));
    mockRc.identifyPurchasesUser.mockResolvedValue(proInfo);
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entitled).toBe(true);
    expect(result.current.isPro).toBe(true);
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBeUndefined();
    expect(mockAnalytics.trackEntitlementSyncFailed).toHaveBeenCalledWith({ reason: 'boot' });
  });

  it('offline with a cache keeps the cache, not the device', async () => {
    mockStore[ENTITLEMENT_CACHE_KEY] = 'false';
    mockApi.fetchSubscriptionStatus.mockRejectedValue(new Error('offline'));
    mockRc.identifyPurchasesUser.mockResolvedValue(proInfo);
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await flush();
    expect(result.current.entitled).toBe(false);
  });

  it('server "false" + device Pro: escalates ONCE to a RevenueCat re-read before settling, so no paywall flash', async () => {
    useFakeTimersKeepingFlush();
    mockStore[ENTITLEMENT_CACHE_KEY] = 'true';
    mockRc.identifyPurchasesUser.mockResolvedValue(proInfo);
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: false, status: 'expired', expiresAt: null });
    const pending = deferred<{ active: boolean; synced: boolean }>();
    mockApi.syncSubscription.mockReturnValue(pending.promise);
    const { result } = renderProvider();
    await flush();
    await flush();
    // Held while the re-read is out: nothing may gate on the stale "false".
    expect(result.current.entitled).toBeNull();
    expect(mockApi.syncSubscription).toHaveBeenCalledTimes(1);
    expect(mockApi.syncSubscription).toHaveBeenCalledWith('mismatch');
    await act(async () => { pending.resolve({ active: true, synced: true }); });
    await flush();
    expect(result.current.entitled).toBe(true);
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBe('true');
    expect(mockApi.fetchSubscriptionStatus).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('server "false" + device Pro with a slow re-read: settles false at the cap, the late "true" still lets them in', async () => {
    useFakeTimersKeepingFlush();
    mockRc.identifyPurchasesUser.mockResolvedValue(proInfo);
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: false, status: 'expired', expiresAt: null });
    const pending = deferred<{ active: boolean; synced: boolean }>();
    mockApi.syncSubscription.mockReturnValue(pending.promise);
    const { result } = renderProvider();
    await flush();
    await flush();
    expect(result.current.entitled).toBeNull();
    act(() => { jest.advanceTimersByTime(BOOT_VERDICT_CAP_MS); });
    await flush();
    expect(result.current.entitled).toBe(false);
    await act(async () => { pending.resolve({ active: true, synced: true }); });
    await flush();
    expect(result.current.entitled).toBe(true);
    expect(mockApi.syncSubscription).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('does not escalate a server "false" when the device agrees', async () => {
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: false, status: 'expired', expiresAt: null });
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.entitled).toBe(false));
    await flush();
    expect(mockApi.syncSubscription).not.toHaveBeenCalled();
  });

  it('without a session settles to false at once, never asks the server, and ignores a stale cache', async () => {
    mockAuth.session = null;
    mockStore[ENTITLEMENT_CACHE_KEY] = 'true';
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entitled).toBe(false);
    expect(mockApi.fetchSubscriptionStatus).not.toHaveBeenCalled();
    expect(mockApi.syncSubscription).not.toHaveBeenCalled();
  });

  it('still becomes ready with a verdict when boot throws (cache, else device, else false)', async () => {
    // Throws before the RevenueCat read completes: the cache is consulted anyway.
    mockStore[ENTITLEMENT_CACHE_KEY] = 'true';
    mockRc.fetchCurrentOffering.mockRejectedValueOnce(new Error('boom'));
    const a = renderProvider();
    await waitFor(() => expect(a.result.current.ready).toBe(true));
    expect(a.result.current.entitled).toBe(true);
    a.unmount();

    // Throws after identity, no cache: the device verdict.
    delete mockStore[ENTITLEMENT_CACHE_KEY];
    mockRc.identifyPurchasesUser.mockResolvedValue(proInfo);
    mockRc.addCustomerInfoListener.mockImplementationOnce(() => { throw new Error('boom'); });
    const b = renderProvider();
    await waitFor(() => expect(b.result.current.ready).toBe(true));
    expect(b.result.current.entitled).toBe(true);
    b.unmount();

    // Throws before identity, no cache: not entitled, but ready.
    mockRc.identifyPurchasesUser.mockResolvedValue(proInfo);
    mockRc.fetchCurrentOffering.mockRejectedValueOnce(new Error('boom'));
    mockRc.identifyPurchasesUser.mockRejectedValueOnce(new Error('boom'));
    const c = renderProvider();
    await waitFor(() => expect(c.result.current.ready).toBe(true));
    expect(c.result.current.entitled).toBe(false);
  });

  it('still resolves a verdict when the SDK has no key (Expo Go, web)', async () => {
    mockRc.configurePurchases.mockReturnValueOnce(false);
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null });
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entitled).toBe(true);
    expect(mockRc.identifyPurchasesUser).not.toHaveBeenCalled();
  });
});
