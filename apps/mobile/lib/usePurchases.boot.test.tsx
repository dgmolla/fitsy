/**
 * PurchasesProvider boot: who decides (the server), what stands in while it
 * can't (cache, then the device as a last resort), and that `entitled` is
 * set exactly once per boot (`ready` is `entitled !== null`).
 */
import {
  deferred,
  freeInfo,
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
import Purchases from 'react-native-purchases';
jest.mock('react-native-purchases', () => jest.requireActual('../__mocks__/react-native-purchases'));
jest.mock('expo-constants', () => jest.requireActual('../__mocks__/expo-constants'));
import { ENTITLEMENT_CACHE_KEY } from './entitlement';
import { BOOT_VERDICT_CAP_MS, INTRO_ELIGIBILITY_CAP_MS } from './usePurchases';

setupPurchasesMocks();

type StatusResult = { active: boolean; status: null; expiresAt: null };

describe('boot', () => {
  it('keeps plans loaded by Retry when the earlier boot catalog request fails late', async () => {
    const bootOffering = deferred<null>();
    const retryOffering = { identifier: 'retry', availablePackages: [] };
    mockRc.fetchCurrentOffering.mockReturnValueOnce(bootOffering.promise as never)
      .mockResolvedValueOnce(retryOffering as never);
    const { result } = renderProvider();
    await waitFor(() => expect(mockRc.fetchCurrentOffering).toHaveBeenCalledTimes(1));
    await act(async () => { await result.current.refreshOffering(); });
    expect(result.current.offering).toEqual(retryOffering);
    await act(async () => { bootOffering.resolve(null); });
    expect(result.current.offering).toEqual(retryOffering);
  });
  it('accepts a late boot catalog when the newer Retry request failed', async () => {
    const bootOffering = deferred<{ identifier: string; availablePackages: never[] }>();
    const plans = { identifier: 'boot', availablePackages: [] };
    mockRc.fetchCurrentOffering.mockReturnValueOnce(bootOffering.promise as never)
      .mockResolvedValueOnce(null);
    const { result } = renderProvider();
    await waitFor(() => expect(mockRc.fetchCurrentOffering).toHaveBeenCalledTimes(1));
    await act(async () => { await result.current.refreshOffering(); });
    expect(result.current.offering).toBeNull();
    await act(async () => { bootOffering.resolve(plans); });
    expect(result.current.offering).toEqual(plans);
  });
  it('bounds a stalled session read and resolves a late signed-in session', async () => {
    useFakeTimersKeepingFlush();
    const sessionRead = deferred<{ data: { session: { user: { id: string } } } }>();
    mockAuth.getSession.mockReturnValueOnce(sessionRead.promise);
    mockAuth.session = { user: { id: 'u2' } };
    mockApi.syncSubscription.mockResolvedValue({ active: true, synced: true });
    const { result } = renderProvider();
    await flush();
    expect(result.current.ready).toBe(false);
    act(() => { jest.advanceTimersByTime(BOOT_VERDICT_CAP_MS); });
    await flush();
    expect(result.current.entitled).toBe(false);
    await act(async () => { sessionRead.resolve({ data: { session: mockAuth.session! } }); });
    await flush();
    expect(mockRc.identifyPurchasesUser).toHaveBeenCalledWith('u2');
    await waitFor(() => expect(result.current.entitled).toBe(true));
  });

  it('bounds a stalled cache read without suppressing a known server verdict', async () => {
    useFakeTimersKeepingFlush();
    const storage = jest.requireMock('@react-native-async-storage/async-storage').default;
    jest.spyOn(storage, 'getItem').mockImplementationOnce(() => new Promise(() => {}));
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null });
    const { result } = renderProvider();
    await flush();
    act(() => { jest.advanceTimersByTime(BOOT_VERDICT_CAP_MS); });
    await flush();
    expect(result.current.entitled).toBe(true);
  });

  it('bounds an identity read that never settles while preserving a signed-in server verdict', async () => {
    useFakeTimersKeepingFlush();
    mockRc.identifyPurchasesUser.mockImplementationOnce(() => new Promise(() => {}));
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null });
    const { result } = renderProvider();
    await flush();
    expect(result.current.ready).toBe(false);
    act(() => { jest.advanceTimersByTime(BOOT_VERDICT_CAP_MS); });
    await flush();
    expect(result.current.ready).toBe(true);
    expect(result.current.entitled).toBe(true);
    expect(result.current.customerInfo).toBeNull();
  });

  it('accepts a late identity for the same account and rechecks a possible missed entitlement', async () => {
    useFakeTimersKeepingFlush();
    const identity = deferred<typeof proInfo>();
    mockRc.identifyPurchasesUser.mockReturnValueOnce(identity.promise);
    const { result } = renderProvider();
    await flush();
    act(() => { jest.advanceTimersByTime(BOOT_VERDICT_CAP_MS); });
    await flush();
    expect(result.current.entitled).toBe(false);
    await act(async () => { identity.resolve(proInfo); });
    await flush();
    expect(result.current.isPro).toBe(true);
    expect(mockApi.syncSubscription).toHaveBeenCalledWith('mismatch');
  });

  it('ignores an old identity result after a new account signs in during boot', async () => {
    useFakeTimersKeepingFlush();
    const oldIdentity = deferred<typeof proInfo>();
    mockRc.identifyPurchasesUser.mockReturnValueOnce(oldIdentity.promise).mockResolvedValueOnce(proInfo);
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null });
    const { result } = renderProvider();
    await flush();
    mockAuth.session = { user: { id: 'u2' } };
    await act(async () => { mockAuth.listener?.('SIGNED_IN', mockAuth.session); });
    act(() => { jest.advanceTimersByTime(BOOT_VERDICT_CAP_MS); });
    await flush();
    expect(mockRc.identifyPurchasesUser).toHaveBeenCalledWith('u2');
    await act(async () => { oldIdentity.resolve(freeInfo); });
    expect(result.current.ready).toBe(true);
    expect(result.current.isPro).toBe(true);
    expect(mockRc.identifyPurchasesUser).toHaveBeenCalledTimes(2);
  });

  it('keeps the native update listener when a different account signs in before boot identity settles', async () => {
    const oldIdentity = deferred<typeof freeInfo>();
    mockRc.identifyPurchasesUser.mockReturnValueOnce(oldIdentity.promise).mockResolvedValueOnce(freeInfo);
    const { result } = renderProvider();
    await flush();
    mockAuth.session = { user: { id: 'u2' } };
    await act(async () => { mockAuth.listener?.('SIGNED_IN', mockAuth.session); });
    await act(async () => { oldIdentity.resolve(freeInfo); });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(mockRc.addCustomerInfoListener).toHaveBeenCalledTimes(1);
    const listener = mockRc.addCustomerInfoListener.mock.calls[0][0];
    mockRc.fetchCustomerInfo.mockResolvedValueOnce(proInfo);
    mockApi.syncSubscription.mockResolvedValue({ active: true, synced: true });
    await act(async () => { listener(proInfo); });
    await waitFor(() => expect(result.current.entitled).toBe(true));
  });

  it('settles unknown trial eligibility when CustomerInfo is unavailable but plans load', async () => {
    mockRc.identifyPurchasesUser.mockResolvedValueOnce(null as never);
    mockRc.fetchCurrentOffering.mockResolvedValueOnce({ availablePackages: [{ product: { identifier: 'annual' } }] } as never);
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.offering).not.toBeNull();
    expect(result.current.introEligibilityReady).toBe(true);
    expect(result.current.introEligibility).toEqual({});
  });

  it('settles unknown eligibility after a bounded StoreKit response wait', async () => {
    useFakeTimersKeepingFlush();
    expect(jest.requireActual<typeof import('./purchases')>('./purchases').configurePurchases()).toBe(true);
    const pending = deferred<Record<string, { status: number; description: string }>>();
    jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockReturnValueOnce(pending.promise);
    mockRc.fetchCurrentOffering.mockResolvedValueOnce({ availablePackages: [{ product: { identifier: 'annual' } }] } as never);
    const { result } = renderProvider();
    await flush();
    await flush();
    expect(result.current.introEligibilityReady).toBe(false);
    act(() => { jest.advanceTimersByTime(INTRO_ELIGIBILITY_CAP_MS); });
    await flush();
    expect(result.current.introEligibilityReady).toBe(true);
    expect(result.current.introEligibility).toEqual({});
    jest.useRealTimers();
  });

  it('maps live store eligibility into the provider and clears it after a failed offering refresh', async () => {
    const seam = jest.requireActual<typeof import('./purchases')>('./purchases');
    expect(seam.configurePurchases()).toBe(true);
    const ids = ['annual', 'monthly', 'discount', 'unknown', 'missing'];
    const offering = { identifier: 'test', availablePackages: ids.map(identifier => ({ product: { identifier } })) };
    const sdk = jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValue({
      annual: { status: 2, description: 'Eligible' },
      monthly: { status: 1, description: 'Ineligible' },
      discount: { status: 3, description: 'No introductory offer' },
      unknown: { status: 0, description: 'Unknown' },
    });
    mockRc.fetchCurrentOffering.mockResolvedValueOnce(offering as never);
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.introEligibility).toEqual({ annual: true, monthly: false, discount: false }));
    expect(sdk).toHaveBeenCalledWith(ids);
    sdk.mockRejectedValueOnce(new Error('Store unavailable'));
    mockRc.fetchCurrentOffering.mockResolvedValueOnce({ ...offering, identifier: 'refreshed' } as never);
    await act(async () => { await result.current.refreshOffering(); });
    await flush();
    expect(result.current.introEligibility).toEqual({});
    await expect(seam.fetchIntroEligibility([])).resolves.toEqual({});
    expect(sdk).toHaveBeenCalledTimes(2);
  });

  it('ignores an old eligibility response after the offering changes', async () => {
    expect(jest.requireActual<typeof import('./purchases')>('./purchases').configurePurchases()).toBe(true);
    const pending = deferred<Record<string, { status: number; description: string }>>();
    const sdk = jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockReturnValueOnce(pending.promise);
    mockRc.fetchCurrentOffering.mockResolvedValueOnce({ availablePackages: [{ product: { identifier: 'annual' } }] } as never);
    const { result } = renderProvider();
    await waitFor(() => expect(sdk).toHaveBeenCalledWith(['annual']));
    mockRc.fetchCurrentOffering.mockResolvedValueOnce({ availablePackages: [{ product: { identifier: 'monthly' } }] } as never);
    sdk.mockResolvedValueOnce({ monthly: { status: 1, description: 'Ineligible' } });
    await act(async () => { await result.current.refreshOffering(); });
    await waitFor(() => expect(result.current.introEligibility).toEqual({ monthly: false }));
    await act(async () => { pending.resolve({ annual: { status: 2, description: 'Eligible' } }); });
    await flush();
    expect(result.current.introEligibility).toEqual({ monthly: false });
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

  it('keeps the server verdict when offering fails, and settles when identity fails', async () => {
    // Store catalog failure cannot make a stale cache overrule the server.
    mockStore[ENTITLEMENT_CACHE_KEY] = 'true';
    mockRc.fetchCurrentOffering.mockRejectedValueOnce(new Error('boom'));
    const a = renderProvider();
    await waitFor(() => expect(a.result.current.ready).toBe(true));
    expect(a.result.current.entitled).toBe(false);
    a.unmount();

    // Listener registration fails independently: the server verdict still wins.
    delete mockStore[ENTITLEMENT_CACHE_KEY];
    mockRc.identifyPurchasesUser.mockResolvedValue(proInfo);
    mockRc.addCustomerInfoListener.mockImplementationOnce(() => { throw new Error('boom'); });
    const b = renderProvider();
    await waitFor(() => expect(b.result.current.ready).toBe(true));
    expect(b.result.current.entitled).toBe(false);
    expect(b.result.current.isPro).toBe(true);
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
