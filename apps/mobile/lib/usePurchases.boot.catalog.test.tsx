/**
 * PurchasesProvider boot: who decides (the server), what stands in while it
 * can't (cache, then the device as a last resort), and that `entitled` is
 * set exactly once per boot (`ready` is `entitled !== null`).
 */
import {
  deferred,
  freeInfo,
  flush,
  mockApi,
  mockAuth,
  mockRc,
  proInfo,
  renderProvider,
  setupPurchasesMocks,
  useFakeTimersKeepingFlush,
} from './usePurchasesTestKit';
import { act, waitFor } from '@testing-library/react-native';
jest.mock('react-native-purchases', () => jest.requireActual('../__mocks__/react-native-purchases'));
jest.mock('expo-constants', () => jest.requireActual('../__mocks__/expo-constants'));
import { BOOT_VERDICT_CAP_MS } from './usePurchases';

setupPurchasesMocks();

type StatusResult = { active: boolean; status: null; expiresAt: null };

describe('boot', () => {
  it('keeps plans loaded by Retry when an older boot catalog succeeds late', async () => {
    const bootOffering = deferred<{ identifier: string; availablePackages: never[] }>();
    const retryOffering = { identifier: 'retry', availablePackages: [] };
    const staleOffering = { identifier: 'boot', availablePackages: [] };
    mockRc.fetchCurrentOffering.mockReturnValueOnce(bootOffering.promise as never)
      .mockResolvedValueOnce(retryOffering as never);
    const { result } = renderProvider();
    await waitFor(() => expect(mockRc.fetchCurrentOffering).toHaveBeenCalledTimes(1));
    await act(async () => { await result.current.refreshOffering(); });
    expect(result.current.offering).toEqual(retryOffering);
    await act(async () => { bootOffering.resolve(staleOffering); });
    expect(result.current.offering).toEqual(retryOffering);
  });
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

  it('keeps a newer Pro sync when the capped boot server read returns false later', async () => {
    useFakeTimersKeepingFlush();
    const bootServer = deferred<StatusResult>();
    mockApi.fetchSubscriptionStatus.mockReturnValueOnce(bootServer.promise);
    mockRc.fetchCustomerInfo.mockResolvedValueOnce(proInfo);
    mockApi.syncSubscription.mockResolvedValue({ active: true, synced: true });
    const { result } = renderProvider();
    await flush();
    expect(mockApi.fetchSubscriptionStatus).toHaveBeenCalledTimes(1);
    expect(result.current.entitled).toBeNull();
    act(() => { jest.advanceTimersByTime(BOOT_VERDICT_CAP_MS); });
    await flush();
    expect(result.current.entitled).toBe(false);
    const listener = mockRc.addCustomerInfoListener.mock.calls[0][0];
    await act(async () => { listener(proInfo); });
    await waitFor(() => expect(result.current.entitled).toBe(true));
    await act(async () => { bootServer.resolve({ active: false, status: null, expiresAt: null }); });
    expect(result.current.entitled).toBe(true);
    expect(mockApi.syncSubscription).toHaveBeenCalledWith('mismatch');
    jest.useRealTimers();
  });

  it('does not let late boot CustomerInfo replace Pro from a completed purchase', async () => {
    useFakeTimersKeepingFlush();
    const identity = deferred<typeof freeInfo>();
    mockRc.identifyPurchasesUser.mockReturnValueOnce(identity.promise);
    const { result } = renderProvider();
    await flush();
    act(() => { jest.advanceTimersByTime(BOOT_VERDICT_CAP_MS); });
    await flush();
    expect(result.current.entitled).toBe(false);
    const sameUserRead = deferred<{ data: { session: { user: { id: string } } } }>();
    mockAuth.getSession.mockReturnValueOnce(sameUserRead.promise);
    await act(async () => { identity.resolve(freeInfo); });
    mockRc.purchasePackage.mockResolvedValue({ outcome: 'purchased', customerInfo: proInfo });
    mockApi.syncSubscription.mockResolvedValue({ active: true, synced: true });
    await act(async () => { expect(await result.current.purchase({} as never, 'test')).toBe(true); });
    expect(result.current.isPro).toBe(true);
    await act(async () => { sameUserRead.resolve({ data: { session: mockAuth.session! } }); });
    await flush();
    expect(result.current.isPro).toBe(true);
    jest.useRealTimers();
  });

  it('keeps a Pro listener read that started after an older free boot read', async () => {
    const identity = deferred<typeof freeInfo>();
    const listenerRead = deferred<typeof proInfo>();
    mockRc.identifyPurchasesUser.mockReturnValueOnce(identity.promise);
    mockRc.fetchCustomerInfo.mockReturnValueOnce(listenerRead.promise).mockResolvedValue(proInfo);
    mockApi.syncSubscription.mockResolvedValue({ active: true, synced: true });
    const { result } = renderProvider();
    await waitFor(() => expect(mockRc.identifyPurchasesUser).toHaveBeenCalledTimes(1));
    const listener = mockRc.addCustomerInfoListener.mock.calls[0][0];
    await act(async () => { listener(proInfo); });
    await waitFor(() => expect(mockRc.fetchCustomerInfo).toHaveBeenCalledTimes(1));
    await act(async () => { identity.resolve(freeInfo); });
    await flush();
    expect(result.current.isPro).toBe(false);
    await act(async () => { listenerRead.resolve(proInfo); });
    await flush();
    expect(mockRc.fetchCustomerInfo).toHaveBeenCalledTimes(2);
    expect(result.current.isPro).toBe(true);
    expect(result.current.entitled).toBe(true);
  });

  it('does not replace a Pro boot result with a listener read started before it', async () => {
    const identity = deferred<typeof proInfo>();
    const listenerRead = deferred<typeof freeInfo>();
    mockRc.identifyPurchasesUser.mockReturnValueOnce(identity.promise);
    mockRc.fetchCustomerInfo.mockReturnValueOnce(listenerRead.promise).mockResolvedValue(proInfo);
    const { result } = renderProvider();
    await waitFor(() => expect(mockRc.identifyPurchasesUser).toHaveBeenCalledTimes(1));
    const listener = mockRc.addCustomerInfoListener.mock.calls[0][0];
    await act(async () => { listener(freeInfo); });
    await waitFor(() => expect(mockRc.fetchCustomerInfo).toHaveBeenCalledTimes(1));
    await act(async () => { identity.resolve(proInfo); });
    await flush();
    expect(result.current.isPro).toBe(true);
    await act(async () => { listenerRead.resolve(freeInfo); });
    await flush();
    expect(mockRc.fetchCustomerInfo).toHaveBeenCalledTimes(2);
    expect(result.current.isPro).toBe(true);
  });

  it('accepts a successful boot identity after a same-account listener refresh fails', async () => {
    const identity = deferred<typeof proInfo>();
    mockRc.identifyPurchasesUser.mockReturnValueOnce(identity.promise);
    mockRc.fetchCustomerInfo.mockResolvedValueOnce(null as never);
    const { result } = renderProvider();
    await waitFor(() => expect(mockRc.identifyPurchasesUser).toHaveBeenCalledTimes(1));
    const listener = mockRc.addCustomerInfoListener.mock.calls[0][0];
    await act(async () => { listener(freeInfo); });
    await waitFor(() => expect(mockRc.fetchCustomerInfo).toHaveBeenCalledTimes(1));
    await act(async () => { identity.resolve(proInfo); });
    await flush();
    expect(result.current.customerInfo).toEqual(proInfo);
    expect(result.current.isPro).toBe(true);
  });

});
