import { deferred, flush, mockRc, renderProvider, setupPurchasesMocks, useFakeTimersKeepingFlush } from './usePurchasesTestKit';
import { act, waitFor } from '@testing-library/react-native';
import Purchases from 'react-native-purchases';
jest.mock('react-native-purchases', () => jest.requireActual('../__mocks__/react-native-purchases'));
jest.mock('expo-constants', () => jest.requireActual('../__mocks__/expo-constants'));
import { INTRO_ELIGIBILITY_CAP_MS } from './usePurchases';

setupPurchasesMocks();

describe('boot eligibility', () => {
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

});
