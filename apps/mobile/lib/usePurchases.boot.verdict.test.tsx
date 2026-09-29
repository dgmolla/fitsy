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
  seedEntitlementCache,
  cachedEntitlementVerdict,
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
import { BOOT_VERDICT_CAP_MS } from './usePurchases';

setupPurchasesMocks();

type StatusResult = { active: boolean; status: string | null; expiresAt: string | null; verdict: 'active' | 'expired' | 'never_subscribed'; lastRcVerifiedAt: string };
type SyncResult = { active: boolean; synced: boolean; verdict: 'active' | 'expired' | 'never_subscribed'; lastRcVerifiedAt: string };

describe('boot verdict', () => {
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
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null, verdict: 'active', lastRcVerifiedAt: new Date().toISOString() });
    const { result } = renderProvider();
    expect(result.current.ready).toBe(false);
    expect(result.current.entitled).toBeNull();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entitled).toBe(true);
    expect(mockApi.fetchSubscriptionStatus).toHaveBeenCalledTimes(1);
    expect(mockApi.syncSubscription).not.toHaveBeenCalled();
    expect(cachedEntitlementVerdict()).toBe('active');
    // Device (free) disagreed with the server (active): measured.
    expect(mockAnalytics.trackEntitlementMismatch).toHaveBeenCalledWith({
      reason: 'boot', device_pro: false, server_active: true,
    });
  });

  it('a stale cached "false" never gates: entitled stays null until the prompt server "true" lands', async () => {
    useFakeTimersKeepingFlush();
    seedEntitlementCache('never_subscribed');
    const pending = deferred<StatusResult>();
    mockApi.fetchSubscriptionStatus.mockReturnValue(pending.promise);
    const { result } = renderProvider();
    await flush();
    await flush();
    expect(result.current.entitled).toBeNull();
    expect(result.current.ready).toBe(false);
    await act(async () => { pending.resolve({ active: true, status: null, expiresAt: null, verdict: 'active', lastRcVerifiedAt: new Date().toISOString() }); });
    await flush();
    expect(result.current.ready).toBe(true);
    expect(result.current.entitled).toBe(true);
    expect(cachedEntitlementVerdict()).toBe('active');
    jest.useRealTimers();
  });

  it('past the cap the cached verdict stands and becomes ready; the late server answer is still applied', async () => {
    useFakeTimersKeepingFlush();
    seedEntitlementCache('never_subscribed');
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
    await act(async () => { pending.resolve({ active: true, status: null, expiresAt: null, verdict: 'active', lastRcVerifiedAt: new Date().toISOString() }); });
    await flush();
    expect(result.current.entitled).toBe(true);
    expect(cachedEntitlementVerdict()).toBe('active');
    jest.useRealTimers();
  });

  it('a cached "true" never flashes the app: a prompt server "false" is what settles it', async () => {
    useFakeTimersKeepingFlush();
    seedEntitlementCache('active');
    const pending = deferred<StatusResult>();
    mockApi.fetchSubscriptionStatus.mockReturnValue(pending.promise);
    const { result } = renderProvider();
    await flush();
    await flush();
    expect(result.current.entitled).toBeNull();
    await act(async () => { pending.resolve({ active: false, status: null, expiresAt: null, verdict: 'never_subscribed', lastRcVerifiedAt: new Date().toISOString() }); });
    await flush();
    expect(result.current.ready).toBe(true);
    expect(result.current.entitled).toBe(false);
    expect(cachedEntitlementVerdict()).toBe('never_subscribed');
    jest.useRealTimers();
  });

  it('past the cap with no cache holds unknown until a slow server answer arrives', async () => {
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
    expect(result.current.entitled).toBeNull();
    expect(result.current.isUnknown).toBe(true);
    await act(async () => { pending.resolve({ active: false, status: null, expiresAt: null, verdict: 'never_subscribed', lastRcVerifiedAt: new Date().toISOString() }); });
    await flush();
    expect(result.current.entitled).toBe(false);
    jest.useRealTimers();
  });

  it('holds unknown when offline with no account-bound proof, even if the device says Pro', async () => {
    mockApi.fetchSubscriptionStatus.mockRejectedValue(new Error('offline'));
    mockRc.identifyPurchasesUser.mockResolvedValue(proInfo);
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entitled).toBeNull();
    expect(result.current.isUnknown).toBe(true);
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBeUndefined();
    expect(mockAnalytics.trackEntitlementSyncFailed).toHaveBeenCalledWith({ reason: 'boot' });
  });

  it('offline with a cached negative and current device Pro holds recovery, not the ordinary paywall', async () => {
    seedEntitlementCache('never_subscribed');
    mockApi.fetchSubscriptionStatus.mockRejectedValue(new Error('offline'));
    mockRc.identifyPurchasesUser.mockResolvedValue(proInfo);
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await flush();
    expect(result.current.entitled).toBeNull();
    expect(result.current.isUnknown).toBe(true);
  });

  it('server "false" + device Pro: escalates ONCE to a RevenueCat re-read before settling, so no paywall flash', async () => {
    useFakeTimersKeepingFlush();
    seedEntitlementCache('active');
    mockRc.identifyPurchasesUser.mockResolvedValue(proInfo);
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: false, status: 'expired', expiresAt: null, verdict: 'expired', lastRcVerifiedAt: new Date().toISOString() });
    const pending = deferred<SyncResult>();
    mockApi.syncSubscription.mockReturnValue(pending.promise);
    const { result } = renderProvider();
    await flush();
    await flush();
    // Held while the re-read is out: nothing may gate on the stale "false".
    expect(result.current.entitled).toBeNull();
    expect(mockApi.syncSubscription).toHaveBeenCalledTimes(1);
    expect(mockApi.syncSubscription).toHaveBeenCalledWith('mismatch');
    await act(async () => { pending.resolve({ active: true, synced: true, verdict: 'active', lastRcVerifiedAt: new Date().toISOString() }); });
    await flush();
    expect(result.current.entitled).toBe(true);
    expect(cachedEntitlementVerdict()).toBe('active');
    expect(mockApi.fetchSubscriptionStatus).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('server never + device Pro with a slow re-read: holds unknown at the cap until the late active proof', async () => {
    useFakeTimersKeepingFlush();
    mockRc.identifyPurchasesUser.mockResolvedValue(proInfo);
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: false, status: 'never_subscribed', expiresAt: null, verdict: 'never_subscribed', lastRcVerifiedAt: new Date().toISOString() });
    const pending = deferred<SyncResult>();
    mockApi.syncSubscription.mockReturnValue(pending.promise);
    const { result } = renderProvider();
    await flush();
    await flush();
    expect(result.current.entitled).toBeNull();
    act(() => { jest.advanceTimersByTime(BOOT_VERDICT_CAP_MS); });
    await flush();
    expect(result.current.entitled).toBeNull();
    expect(result.current.isUnknown).toBe(true);
    await act(async () => { pending.resolve({ active: true, synced: true, verdict: 'active', lastRcVerifiedAt: new Date().toISOString() }); });
    await flush();
    expect(result.current.entitled).toBe(true);
    expect(mockApi.syncSubscription).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('does not escalate a server "false" when the device agrees', async () => {
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: false, status: 'expired', expiresAt: null, verdict: 'expired', lastRcVerifiedAt: new Date().toISOString() });
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.entitled).toBe(false));
    await flush();
    expect(mockApi.syncSubscription).not.toHaveBeenCalled();
  });

  it('without a session settles to false at once, never asks the server, and ignores a stale cache', async () => {
    mockAuth.session = null;
    seedEntitlementCache('active');
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entitled).toBe(false);
    expect(mockApi.fetchSubscriptionStatus).not.toHaveBeenCalled();
    expect(mockApi.syncSubscription).not.toHaveBeenCalled();
  });

  it('keeps the server verdict when offering fails, and settles when identity fails', async () => {
    // Store catalog failure cannot make a stale cache overrule the server.
    seedEntitlementCache('active');
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
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null, verdict: 'active', lastRcVerifiedAt: new Date().toISOString() });
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entitled).toBe(true);
    expect(mockRc.identifyPurchasesUser).not.toHaveBeenCalled();
  });
});
