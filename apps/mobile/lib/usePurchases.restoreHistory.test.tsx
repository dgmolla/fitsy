import { cachedEntitlementVerdict, deferred, mockApi, mockAuth, mockRc, renderProvider, setupPurchasesMocks } from './usePurchasesTestKit';
import { act, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

setupPurchasesMocks();

type SyncResult = { active: boolean; synced: boolean; verdict: 'active' | 'expired' | 'never_subscribed'; lastRcVerifiedAt: string };

describe('restore history', () => {
  it('distinguishes a failed native Restore from a completed Restore with no subscription', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    mockRc.restorePurchases.mockResolvedValueOnce(null).mockResolvedValueOnce({ entitlements: { active: {}, all: {} } });
    let failed: 'active' | 'expired' | 'none' | null | undefined;
    let empty: 'active' | 'expired' | 'none' | null | undefined;
    await act(async () => { failed = await result.current.restore(); });
    await act(async () => { empty = await result.current.restore(); });
    expect(failed).toBeNull();
    expect(empty).toBe('none');
    expect(Alert.alert).toHaveBeenCalledWith('Restore not completed', 'Please try again.');
    expect(mockRc.restorePurchases).toHaveBeenCalledTimes(2);
    expect(mockApi.syncSubscription).not.toHaveBeenCalled();
  });

  it('reconciles a restored expired receipt to the current account without granting Pro', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    mockRc.restorePurchases.mockResolvedValue({ entitlements: { active: {}, all: { pro: {} } } });
    mockApi.syncSubscription.mockResolvedValue({
      active: false, synced: true, verdict: 'expired', status: 'expired',
      stale: false, expiresAt: null, lastRcVerifiedAt: new Date().toISOString(),
    });
    let outcome: Awaited<ReturnType<typeof result.current.restore>> | undefined;
    await act(async () => { outcome = await result.current.restore(); });
    expect(outcome).toBe('expired');
    expect(mockApi.syncSubscription).toHaveBeenCalledWith('restore_history');
    expect(result.current.isLapsed).toBe(true);
    expect(result.current.entitled).toBe(false);
    expect(result.current.storeConfirmed).toBe(false);
    expect(cachedEntitlementVerdict()).toBe('expired');
  });

  it('asks the server when a restored receipt has past products but its Pro entitlement mapping is absent', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    mockRc.restorePurchases.mockResolvedValue({
      entitlements: { active: {}, all: {} }, allPurchasedProductIdentifiers: ['fitsy_yearly'],
    });
    mockApi.syncSubscription.mockResolvedValue({
      active: false, synced: true, verdict: 'expired', status: 'expired',
      stale: false, expiresAt: null, lastRcVerifiedAt: new Date().toISOString(),
    });
    let outcome: Awaited<ReturnType<typeof result.current.restore>> | undefined;
    await act(async () => { outcome = await result.current.restore(); });
    expect(outcome).toBe('expired');
    expect(mockApi.syncSubscription).toHaveBeenCalledWith('restore_history');
    expect(result.current.entitled).toBe(false);
  });

  it('holds a restored historical receipt when RevenueCat cannot verify it', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    mockRc.restorePurchases.mockResolvedValue({ entitlements: { active: {}, all: { pro: {} } } });
    mockApi.syncSubscription.mockResolvedValue({
      active: false, synced: false, verdict: 'never_subscribed', status: null,
      stale: false, expiresAt: null, lastRcVerifiedAt: null,
    });
    let outcome: Awaited<ReturnType<typeof result.current.restore>> | undefined;
    await act(async () => { outcome = await result.current.restore(); });
    expect(outcome).toBeNull();
    expect(result.current.entitled).toBeNull();
    expect(result.current.isUnknown).toBe(true);
    expect(result.current.storeConfirmed).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith('Could not verify purchase history', expect.any(String));
  });

  it('does not apply a restored historical verdict after the signed-in account changes', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    mockRc.restorePurchases.mockResolvedValue({ entitlements: { active: {}, all: { pro: {} } } });
    const pending = deferred<SyncResult>();
    mockApi.syncSubscription.mockReturnValue(pending.promise);
    let outcome: Awaited<ReturnType<typeof result.current.restore>> | undefined;
    await act(async () => {
      const restore = result.current.restore();
      await new Promise((r) => setImmediate(r));
      mockAuth.session = { user: { id: 'another-account' } };
      pending.resolve({ active: false, synced: true, verdict: 'expired', lastRcVerifiedAt: new Date().toISOString() });
      outcome = await restore;
    });
    expect(outcome).toBeNull();
    expect(result.current.isLapsed).toBe(false);
    expect(result.current.entitled).toBe(false);
    expect(cachedEntitlementVerdict()).toBe('never_subscribed');
  });

  it('retains a newer verified entitlement when an older historical restore fails', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    mockRc.restorePurchases.mockResolvedValue({ entitlements: { active: {}, all: { pro: {} } } });
    const pending = deferred<SyncResult>();
    mockApi.syncSubscription.mockReturnValueOnce(pending.promise);
    let restore!: ReturnType<typeof result.current.restore>;
    await act(async () => {
      restore = result.current.restore();
      await new Promise((r) => setImmediate(r));
    });
    mockApi.syncSubscription.mockResolvedValue({ active: true, synced: true, verdict: 'active', lastRcVerifiedAt: new Date().toISOString() });
    await act(async () => { await result.current.syncEntitlement('mismatch'); });
    await act(async () => {
      pending.resolve({ active: false, synced: false, verdict: 'never_subscribed', lastRcVerifiedAt: new Date().toISOString() });
      await restore;
    });
    expect(result.current.entitled).toBe(true);
    expect(result.current.isUnknown).toBe(false);
    expect(cachedEntitlementVerdict()).toBe('active');
  });
});
