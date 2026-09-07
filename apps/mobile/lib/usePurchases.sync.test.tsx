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

describe('syncEntitlement', () => {
  it('leaves the verdict unchanged and returns null when the server cannot be asked', async () => {
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null });
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
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null });
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.entitled).toBe(true));
    const pending = deferred<SyncResult>();
    mockApi.syncSubscription.mockReturnValue(pending.promise);
    let verdict: boolean | null = true;
    await act(async () => {
      const p = result.current.syncEntitlement('mismatch');
      await new Promise((r) => setImmediate(r));
      mockAuth.session = { user: { id: 'someone-else' } };
      pending.resolve({ active: false, synced: true });
      verdict = await p;
    });
    expect(verdict).toBeNull();
    expect(result.current.entitled).toBe(true);
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBe('true');
  });

  it('non-boot reasons make the server re-read RevenueCat and the verdict flips', async () => {
    const { result } = renderProvider();
    await waitFor(() => expect(result.current.entitled).toBe(false));
    mockApi.syncSubscription.mockResolvedValue({ active: true, synced: true });
    let verdict: boolean | null = null;
    await act(async () => { verdict = await result.current.syncEntitlement('mismatch'); });
    expect(verdict).toBe(true);
    expect(result.current.entitled).toBe(true);
    expect(mockApi.syncSubscription).toHaveBeenCalledWith('mismatch');
  });
});

describe('sign-in', () => {
  it('holds the gates (null) and never shows a stale "false" before a prompt server "true"', async () => {
    mockAuth.session = null;
    const { result, seen } = renderProviderTracking();
    await waitFor(() => expect(result.current.entitled).toBe(false));
    mockAuth.session = { user: { id: 'u2' } };
    mockApi.syncSubscription.mockResolvedValue({ active: true, synced: true });
    await act(async () => { mockAuth.listener?.('SIGNED_IN', { user: { id: 'u2' } }); });
    await waitFor(() => expect(result.current.entitled).toBe(true));
    expect(seen).toEqual([null, false, null, true]);
    expect(mockRc.identifyPurchasesUser).toHaveBeenLastCalledWith('u2');
    expect(mockApi.syncSubscription).toHaveBeenCalledWith('sign_in');
  });

  it('with a slow server: null during the wait, the device verdict at the cap, then the server answer', async () => {
    mockAuth.session = null;
    const { result, seen } = renderProviderTracking();
    await waitFor(() => expect(result.current.entitled).toBe(false));
    useFakeTimersKeepingFlush();
    mockAuth.session = { user: { id: 'u2' } };
    mockRc.identifyPurchasesUser.mockResolvedValue(proInfo);
    const pending = deferred<SyncResult>();
    mockApi.syncSubscription.mockReturnValue(pending.promise);
    await act(async () => {
      mockAuth.listener?.('SIGNED_IN', { user: { id: 'u2' } });
      await new Promise((r) => setImmediate(r));
    });
    await flush();
    expect(result.current.entitled).toBeNull();
    expect(result.current.ready).toBe(false);
    act(() => { jest.advanceTimersByTime(BOOT_VERDICT_CAP_MS); });
    await flush();
    expect(result.current.entitled).toBe(true); // device fallback
    await act(async () => { pending.resolve({ active: false, synced: true }); });
    await flush();
    expect(result.current.entitled).toBe(false); // late server answer wins
    expect(seen).toEqual([null, false, null, true, false]);
    jest.useRealTimers();
  });

  it('ignores the SIGNED_IN that session recovery re-emits for the user boot already resolved', async () => {
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null });
    const { result, seen } = renderProviderTracking();
    await waitFor(() => expect(result.current.entitled).toBe(true));
    const identifies = mockRc.identifyPurchasesUser.mock.calls.length;
    await act(async () => { mockAuth.listener?.('SIGNED_IN', { user: { id: 'u1' } }); });
    await flush();
    expect(mockRc.identifyPurchasesUser).toHaveBeenCalledTimes(identifies);
    expect(mockApi.syncSubscription).not.toHaveBeenCalled();
    expect(seen).toEqual([null, true]);
  });
});

describe('sign-out', () => {
  it('goes false -> null (gates hold while the caller navigates) -> false once the logout settles', async () => {
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null });
    const { result, seen } = renderProviderTracking();
    await waitFor(() => expect(result.current.entitled).toBe(true));
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBe('true');
    const logout = deferred<undefined>();
    mockRc.logoutPurchasesUser.mockReturnValue(logout.promise);
    mockAuth.session = null;
    await act(async () => {
      mockAuth.listener?.('SIGNED_OUT', null);
      await new Promise((r) => setImmediate(r));
    });
    // Logout still in flight: held, cache already gone.
    expect(result.current.entitled).toBeNull();
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBeUndefined();
    await act(async () => { logout.resolve(undefined); });
    await waitFor(() => expect(result.current.entitled).toBe(false));
    expect(mockRc.logoutPurchasesUser).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([null, true, null, false]);
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
    // Someone signed in again before the logout settled.
    mockAuth.session = { user: { id: 'u2' } };
    await act(async () => { logout.resolve(undefined); });
    await flush();
    expect(result.current.entitled).toBeNull();
  });
});
