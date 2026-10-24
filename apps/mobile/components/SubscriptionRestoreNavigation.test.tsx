import { act, Alert, AsyncStorage, deferred, fireEvent, mockState, renderJourney, response, routes, selected, rememberPaywallIntent, saveMacroTargets, waitFor, withAccountProfile } from './OnboardingNavigationHarness';
import React from 'react';
import Purchases, { type CustomerInfo, type PurchasesOffering } from 'react-native-purchases';
import Payment from '../app/welcome/payment';
import Resubscribe from '../app/welcome/resubscribe';
import SubscriptionCheck from '../app/welcome/subscription-check';
import { ENTITLEMENT_CACHE_KEY } from '../lib/entitlement';

// Synthetic native/HTTP boundaries, not Apple receipt acceptance.
// Screens, routing, purchase actions, reconciliation and cache run for real.
const empty = { entitlements: { active: {}, all: {} } } as CustomerInfo;
const expired = { entitlements: { active: {}, all: { pro: { isActive: false } } } } as unknown as CustomerInfo;
const annual = { identifier: '$rc_annual', product: { identifier: 'annual', price: 59.99,
  priceString: '$59.99', currencyCode: 'USD', subscriptionPeriod: 'P1Y', introPrice: null } };
const offering = { identifier: 'default', annual, monthly: null, availablePackages: [annual], metadata: {} } as unknown as PurchasesOffering;
const restoreRoutes = { ...routes, 'welcome/payment': () => <Payment />, 'welcome/resubscribe': () => <Resubscribe />,
  'welcome/subscription-check': SubscriptionCheck };

function status(verdict: 'active' | 'expired' | 'never_subscribed' | 'unknown', synced = true) {
  return { active: verdict === 'active', verdict, status: verdict, expiresAt: null, synced,
    lastRcVerifiedAt: new Date().toISOString(), stale: verdict === 'unknown' };
}

beforeEach(async () => {
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  jest.spyOn(Purchases, 'getAppUserID').mockResolvedValue('buyer');
  jest.spyOn(Purchases, 'logIn').mockResolvedValue({ customerInfo: empty, created: false });
  jest.spyOn(Purchases, 'getCustomerInfo').mockResolvedValue(empty);
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: offering, all: { default: offering } });
  jest.spyOn(Purchases, 'restorePurchases').mockResolvedValue(expired);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await rememberPaywallIntent(selected);
});

it('reconciles an expired Restore from the ordinary paywall and opens resubscribe without granting access', async () => {
  const appleUser = { id: 'buyer', email: 'hidden@privaterelay.appleid.com' };
  mockState.session = { access_token: 'test-token', user: appleUser };
  const reconciliation = deferred<Response>();
  let restored = false;
  global.fetch = jest.fn(withAccountProfile(async (url, init) => {
    if (url.endsWith('/api/subscriptions/sync') && JSON.parse(String(init?.body)).reason === 'restore_history') {
      restored = true;
      return reconciliation.promise;
    }
    return response(status(restored ? 'expired' : 'never_subscribed'));
  }));
  const screen = renderJourney('/welcome/payment', restoreRoutes);
  await waitFor(() => expect(screen.getByTestId('paywall-restore')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('paywall-restore')); });
  await waitFor(() => expect(restored).toBe(true));
  expect(screen.queryByText('Welcome back.')).toBeNull();
  expect(screen.queryByText('Meal search')).toBeNull();
  await act(async () => { reconciliation.resolve(response(status('expired'))); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/resubscribe'));
  expect(screen.getByText('Welcome back.')).toBeTruthy();
  expect(screen.queryByTestId('paywall-logo')).toBeNull();
  expect(await AsyncStorage.getItem('onboardingComplete')).not.toBe('true');
  expect(JSON.parse((await AsyncStorage.getItem(ENTITLEMENT_CACHE_KEY))!)).toEqual(expect.objectContaining({
    userId: 'buyer', active: false, verdict: 'expired',
  }));
  expect(Alert.alert).not.toHaveBeenCalledWith('Nothing to restore', expect.any(String));
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/subscriptions/sync'), expect.objectContaining({
    body: JSON.stringify({ reason: 'restore_history' }), headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
  }));
  screen.unmount();
  const restarted = renderJourney('/', restoreRoutes);
  expect(restarted.queryByTestId('paywall-logo')).toBeNull();
  await waitFor(() => expect(restarted.getPathname()).toBe('/welcome/resubscribe'));
  expect(restarted.getByText('Welcome back.')).toBeTruthy();
});

it.each(['failed', 'unknown', 'stale', 'missing-proof', 'old-proof', 'future-proof', 'no-history'])(
  'holds failed Restore reconciliation (%s) without showing ordinary plans, then retries', async failure => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let retried = false;
    global.fetch = jest.fn(withAccountProfile(async (url, init) => {
      if (url.endsWith('/api/subscriptions/sync')) {
        if (JSON.parse(String(init?.body)).reason === 'restore_history') {
          if (failure === 'failed') throw new Error('offline');
          return response(failure === 'unknown' ? status('unknown', false)
            : failure === 'stale' ? { ...status('expired'), stale: true }
            : failure === 'missing-proof' ? { ...status('expired'), lastRcVerifiedAt: null }
            : failure === 'old-proof' ? { ...status('expired'), lastRcVerifiedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() }
            : failure === 'future-proof' ? { ...status('expired'), lastRcVerifiedAt: new Date(Date.now() + 120_000).toISOString() }
            : status('never_subscribed'));
        }
        retried = true;
      }
      return response(status(retried ? 'expired' : 'never_subscribed'));
    }));
    const screen = renderJourney('/welcome/payment', restoreRoutes);
    await waitFor(() => expect(screen.getByTestId('paywall-restore')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('paywall-restore')); });
    await waitFor(() => expect(screen.getPathname()).toBe('/welcome/subscription-check'));
    expect(screen.queryByTestId('paywall-logo')).toBeNull();
    expect(screen.queryByText('Welcome back.')).toBeNull();
    expect(await AsyncStorage.getItem('onboardingComplete')).not.toBe('true');
    expect(await AsyncStorage.getItem(ENTITLEMENT_CACHE_KEY)).toBeNull();
    expect(Alert.alert).toHaveBeenCalledWith('Could not verify purchase history', expect.any(String));
    await act(async () => { fireEvent.press(screen.getByTestId('subscription-check-retry')); });
    await waitFor(() => expect(screen.getPathname()).toBe('/welcome/resubscribe'));
    expect(screen.getByText('Welcome back.')).toBeTruthy();
    expect(screen.queryByTestId('paywall-logo')).toBeNull();
  },
);

it('preserves known expired history when a subsequent Restore cannot verify the receipt', async () => {
  global.fetch = jest.fn(withAccountProfile(async (url) => response(status('expired', !url.endsWith('/api/subscriptions/sync')))));
  const screen = renderJourney('/welcome/resubscribe', restoreRoutes);
  await waitFor(() => expect(screen.getByTestId('resubscribe-restore')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('resubscribe-restore')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/subscription-check'));
  expect(screen.queryByTestId('paywall-logo')).toBeNull();
  expect(JSON.parse((await AsyncStorage.getItem(ENTITLEMENT_CACHE_KEY))!)).toEqual(expect.objectContaining({
    userId: 'buyer', verdict: 'expired', active: false,
  }));
});

it.each(['restore', 'rebuy'])('returns an active %s to its selected meal while server synchronization lags', async action => {
  const pro = { isActive: true, expirationDate: '2030-01-08T12:00:00Z', periodType: 'NORMAL', willRenew: true };
  const active = { entitlements: { active: { pro }, all: { pro } } } as unknown as CustomerInfo;
  jest.mocked(Purchases.restorePurchases).mockResolvedValue(active);
  jest.spyOn(Purchases, 'purchasePackage').mockResolvedValue({ customerInfo: active } as never);
  await saveMacroTargets({ calories: '600', protein: '40', carbs: '50', fat: '20' });
  global.fetch = jest.fn(withAccountProfile(async () => response(status(action === 'rebuy' ? 'expired' : 'never_subscribed', false))));
  const screen = renderJourney(action === 'rebuy' ? '/welcome/resubscribe' : '/welcome/payment', restoreRoutes);
  const button = action === 'rebuy' ? 'welcome-continue' : 'paywall-restore';
  await waitFor(() => expect(screen.getByTestId(button)).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId(button)); });
  await waitFor(() => expect(screen.getPathname()).toBe('/restaurant/varilla'));
  expect(screen.getByText(JSON.stringify({ id: 'varilla', selectedItemId: 'meal-1' }))).toBeTruthy();
  expect(await AsyncStorage.getItem('onboardingComplete')).toBe('true');
  expect(screen.queryByTestId('paywall-logo')).toBeNull();
  expect(screen.queryByText('Welcome back.')).toBeNull();
});

it('retains the ordinary paywall for a completed Restore with no purchase history', async () => {
  jest.mocked(Purchases.restorePurchases).mockResolvedValue(empty);
  global.fetch = jest.fn(withAccountProfile(async () => response(status('never_subscribed'))));
  const screen = renderJourney('/welcome/payment', restoreRoutes);
  await waitFor(() => expect(screen.getByTestId('paywall-restore')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('paywall-restore')); });
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Nothing to restore', expect.any(String)));
  expect(screen.getPathname()).toBe('/welcome/payment');
  expect(screen.getByTestId('paywall-logo')).toBeTruthy();
  expect(await AsyncStorage.getItem('onboardingComplete')).not.toBe('true');
});
