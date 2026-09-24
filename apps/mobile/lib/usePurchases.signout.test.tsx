/**
 * PurchasesProvider syncEntitlement and auth events: the stale-session
 * guard, and how the verdict is held (null) and settled around sign-in and
 * sign-out so a gate never sees a stale "false".
 */
import {
  deferred,
  flush,
  mockApi,
  mockAuth,
  mockRc,
  mockStore,
  proInfo,
  renderProvider,
  renderProviderTracking,
  setupPurchasesMocks,
  useFakeTimersKeepingFlush,
} from './usePurchasesTestKit';
import { act, waitFor } from '@testing-library/react-native';
import { ENTITLEMENT_CACHE_KEY } from './entitlement';
import { BOOT_VERDICT_CAP_MS } from './usePurchases';

setupPurchasesMocks();

type SyncResult = { active: boolean; synced: boolean };

describe('sign-out', () => {
  it('drops old lapsed CustomerInfo before a new free account can route to resubscribe', async () => {
    mockRc.identifyPurchasesUser.mockResolvedValueOnce({ entitlements: { active: {}, all: { pro: {} } } });
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.isLapsed).toBe(true);
    mockRc.logoutPurchasesUser.mockImplementationOnce(() => new Promise(() => {}));
    mockAuth.session = null;
    await act(async () => { mockAuth.listener?.('SIGNED_OUT', null); });
    expect(result.current.isLapsed).toBe(false);
    const oldListener = mockRc.addCustomerInfoListener.mock.calls[0][0];
    await act(async () => { oldListener({ entitlements: { active: {}, all: { pro: {} } } }); });
    await flush();
    expect(result.current.isLapsed).toBe(false);
    mockAuth.session = { user: { id: 'new-free' } };
    await act(async () => { mockAuth.listener?.('SIGNED_IN', mockAuth.session); });
    await waitFor(() => expect(result.current.entitled).toBe(false));
    mockRc.currentPurchasesUserId.mockResolvedValueOnce('u1');
    await act(async () => { oldListener({ entitlements: { active: {}, all: { pro: {} } } }); });
    await flush();
    expect(result.current.isLapsed).toBe(false);
    mockRc.fetchCustomerInfo.mockResolvedValueOnce({ entitlements: { active: {}, all: {} } });
    await act(async () => { oldListener({ entitlements: { active: {}, all: { pro: {} } } }); });
    await flush();
    expect(result.current.isLapsed).toBe(false);
  });

  it('does not reopen the gate from an old boot verdict while native logout is queued', async () => {
    useFakeTimersKeepingFlush();
    mockRc.identifyPurchasesUser.mockImplementationOnce(() => new Promise(() => {}));
    mockRc.logoutPurchasesUser.mockImplementationOnce(() => new Promise(() => {}));
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null });
    const { result } = renderProvider();
    await flush();
    expect(result.current.entitled).toBeNull();
    mockAuth.session = null;
    await act(async () => { mockAuth.listener?.('SIGNED_OUT', null); });
    expect(result.current.entitled).toBeNull();
    act(() => { jest.advanceTimersByTime(BOOT_VERDICT_CAP_MS); });
    await flush();
    expect(result.current.entitled).toBe(false);
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBeUndefined();
  });

  it('rejects a late sign-in fallback while sign-out is still settling', async () => {
    mockAuth.session = null;
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.entitled).toBe(false));
    const sync = deferred<SyncResult>();
    const logout = deferred<undefined>();
    mockRc.identifyPurchasesUser.mockResolvedValue(proInfo);
    mockApi.syncSubscription.mockReturnValueOnce(sync.promise);
    mockRc.logoutPurchasesUser.mockReturnValueOnce(logout.promise);
    mockAuth.session = { user: { id: 'u2' } };
    await act(async () => { mockAuth.listener?.('SIGNED_IN', mockAuth.session); });
    await waitFor(() => expect(mockApi.syncSubscription).toHaveBeenCalled());
    mockAuth.session = null;
    await act(async () => { mockAuth.listener?.('SIGNED_OUT', null); });
    await act(async () => { sync.resolve({ active: true, synced: true }); });
    await flush();
    expect(result.current.entitled).toBeNull();
    await act(async () => { logout.resolve(undefined); });
    await waitFor(() => expect(result.current.entitled).toBe(false));
    expect(result.current.isPro).toBe(false);
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBeUndefined();
  });

  it('goes false -> null (gates hold while the caller navigates) -> false once the logout settles', async () => {
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null });
    const { result, seen } = renderProviderTracking();
    await waitFor(() => expect(result.current.entitled).toBe(true));
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBe('true');
    const logout = deferred<undefined>();
    mockRc.logoutPurchasesUser.mockReturnValue(logout.promise);
    mockAuth.session = null;
    let returned: unknown = 'not called';
    await act(async () => {
      returned = mockAuth.listener?.('SIGNED_OUT', null);
      await new Promise((r) => setImmediate(r));
    });
    // The listener returned synchronously (supabase-js awaits callbacks).
    expect(returned).toBeUndefined();
    // Logout still in flight: held, cache already gone.
    expect(result.current.entitled).toBeNull();
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBeUndefined();
    await act(async () => { logout.resolve(undefined); });
    await waitFor(() => expect(result.current.entitled).toBe(false));
    expect(mockRc.logoutPurchasesUser).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([null, true, null, false]);
  });

  it('never calls getSession from the SIGNED_OUT path (auth-js holds its lock while notifying)', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.ready).toBe(true));
    mockAuth.getSession.mockClear();
    mockAuth.session = null;
    await act(async () => { mockAuth.listener?.('SIGNED_OUT', null); });
    await waitFor(() => expect(result.current.entitled).toBe(false));
    expect(mockAuth.getSession).not.toHaveBeenCalled();
  });

  it('leaves the verdict to a fast re-sign-in instead of forcing false', async () => {
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null });
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.entitled).toBe(true));
    const logout = deferred<undefined>();
    mockRc.logoutPurchasesUser.mockReturnValue(logout.promise);
    await act(async () => {
      mockAuth.listener?.('SIGNED_OUT', null);
      await new Promise((r) => setImmediate(r));
    });
    // Someone signed in again before the logout settled, and their sync says yes.
    mockAuth.session = { user: { id: 'u2' } };
    mockApi.syncSubscription.mockResolvedValue({ active: true, synced: true });
    await act(async () => { mockAuth.listener?.('SIGNED_IN', { user: { id: 'u2' } }); });
    await waitFor(() => expect(result.current.entitled).toBe(true));
    await act(async () => { logout.resolve(undefined); });
    await flush();
    expect(result.current.entitled).toBe(true);
  });
});
