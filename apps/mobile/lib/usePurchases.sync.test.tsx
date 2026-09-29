/**
 * PurchasesProvider syncEntitlement and auth events: the stale-session
 * guard, and how the verdict is held (null) and settled around sign-in and
 * sign-out so a gate never sees a stale "false".
 */
import {
  deferred,
  flush,
  mockAnalytics,
  mockApi,
  mockForeground,
  freeInfo,
  mockAuth,
  mockRc,
  mockStore,
  cachedEntitlementVerdict,
  proInfo,
  renderProvider,
  setupPurchasesMocks,
} from './usePurchasesTestKit';
import { act, waitFor } from '@testing-library/react-native';
import { ENTITLEMENT_CACHE_KEY } from './entitlement';

setupPurchasesMocks();

type SyncResult = { active: boolean; synced: boolean; verdict: 'active' | 'expired' | 'never_subscribed'; lastRcVerifiedAt: string };

describe('syncEntitlement', () => {
  it('keeps the newer listener Pro result when an older free read finishes last', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.entitled).toBe(false));
    const listener = mockRc.addCustomerInfoListener.mock.calls[0][0];
    const oldRead = deferred<typeof freeInfo>();
    const newRead = deferred<typeof proInfo>();
    mockRc.fetchCustomerInfo.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
    await act(async () => { listener(freeInfo); listener(proInfo); });
    await waitFor(() => expect(mockRc.fetchCustomerInfo).toHaveBeenCalledTimes(2));
    mockApi.syncSubscription.mockResolvedValue({ active: true, synced: true, verdict: 'active', lastRcVerifiedAt: new Date().toISOString() });
    await act(async () => { newRead.resolve(proInfo); });
    await flush();
    expect(result.current.isPro).toBe(true);
    expect(result.current.entitled).toBe(true);
    await act(async () => { oldRead.resolve(freeInfo); });
    await flush();
    expect(result.current.isPro).toBe(true);
    expect(result.current.entitled).toBe(true);
  });
  it('does not let an older listener read replace Pro after checkout completes', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.entitled).toBe(false));
    const listener = mockRc.addCustomerInfoListener.mock.calls[0][0];
    const oldRead = deferred<typeof freeInfo>();
    mockRc.fetchCustomerInfo.mockReturnValueOnce(oldRead.promise);
    await act(async () => { listener(freeInfo); });
    await waitFor(() => expect(mockRc.fetchCustomerInfo).toHaveBeenCalled());
    mockRc.purchasePackage.mockResolvedValue({ outcome: 'purchased', customerInfo: proInfo });
    mockApi.syncSubscription.mockResolvedValue({ active: true, synced: true, verdict: 'active', lastRcVerifiedAt: new Date().toISOString() });
    await act(async () => { expect(await result.current.purchase({} as never, 'test')).toBe(true); });
    expect(result.current.isPro).toBe(true);
    await act(async () => { oldRead.resolve(freeInfo); });
    await flush();
    expect(result.current.isPro).toBe(true);
  });
  it('rechecks the server gate when the current account receives Pro on another device', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.entitled).toBe(false));
    const listener = mockRc.addCustomerInfoListener.mock.calls[0][0];
    mockRc.fetchCustomerInfo.mockResolvedValueOnce(proInfo);
    mockApi.syncSubscription.mockResolvedValue({ active: true, synced: true, verdict: 'active', lastRcVerifiedAt: new Date().toISOString() });
    await act(async () => { listener(proInfo); });
    await waitFor(() => expect(result.current.isPro).toBe(true));
    await waitFor(() => expect(result.current.entitled).toBe(true));
    expect(mockApi.syncSubscription).toHaveBeenCalledWith('mismatch');
  });
  it('leaves the verdict unchanged and returns null when the server cannot be asked', async () => {
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null, verdict: 'active', lastRcVerifiedAt: new Date().toISOString() });
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.entitled).toBe(true));
    mockApi.syncSubscription.mockRejectedValue(new Error('boom'));
    let verdict: boolean | null = true;
    await act(async () => { verdict = await result.current.syncEntitlement('mismatch'); });
    expect(verdict).toBeNull();
    expect(result.current.entitled).toBe(true);
    expect(mockAnalytics.trackEntitlementSyncFailed).toHaveBeenCalledWith({ reason: 'mismatch' });
  });

  it('drops an answer whose session changed or ended mid-flight', async () => {
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null, verdict: 'active', lastRcVerifiedAt: new Date().toISOString() });
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.entitled).toBe(true));
    const pending = deferred<SyncResult>();
    mockApi.syncSubscription.mockReturnValue(pending.promise);
    let verdict: boolean | null = true;
    await act(async () => {
      const p = result.current.syncEntitlement('mismatch');
      await new Promise((r) => setImmediate(r));
      mockAuth.session = { user: { id: 'someone-else' } };
      pending.resolve({ active: false, synced: true, verdict: 'never_subscribed', lastRcVerifiedAt: new Date().toISOString() });
      verdict = await p;
    });
    expect(verdict).toBeNull();
    expect(result.current.entitled).toBe(true);
    expect(cachedEntitlementVerdict()).toBe('active');
  });

  it('non-boot reasons make the server re-read RevenueCat and the verdict flips', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.entitled).toBe(false));
    mockApi.syncSubscription.mockResolvedValue({ active: true, synced: true, verdict: 'active', lastRcVerifiedAt: new Date().toISOString() });
    let verdict: boolean | null = null;
    await act(async () => { verdict = await result.current.syncEntitlement('mismatch'); });
    expect(verdict).toBe(true);
    expect(result.current.entitled).toBe(true);
    expect(mockApi.syncSubscription).toHaveBeenCalledWith('mismatch');
  });

  it('reconciles the signed-in account on foreground return and classifies a real lapse', async () => {
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null, verdict: 'active', lastRcVerifiedAt: new Date().toISOString() });
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.entitled).toBe(true));
    expect(mockForeground.listener).toBeDefined();
    mockApi.syncSubscription.mockResolvedValue({ active: false, synced: true, verdict: 'expired', lastRcVerifiedAt: new Date().toISOString() });
    await act(async () => { mockForeground.listener?.('active'); });
    await waitFor(() => expect(result.current.isLapsed).toBe(true));
    expect(result.current.entitled).toBe(false);
    expect(result.current.isUnknown).toBe(false);
    expect(mockApi.syncSubscription).toHaveBeenCalledWith('mismatch');
  });
});
