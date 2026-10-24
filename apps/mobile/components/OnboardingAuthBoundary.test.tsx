import { withAccountProfile, mockState, selected, response, routes, renderJourney, AsyncStorage, act, fireEvent, waitFor, getPaywallIntent, getStoredToken, rememberPaywallIntent, rememberPaymentSignInContinuation } from './OnboardingNavigationHarness';
import { Alert } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import Purchases, { type CustomerInfo, type PurchasesOffering } from 'react-native-purchases';
import Payment from '../app/welcome/payment';
import { supabase } from '../lib/supabase';
import { fetchSubscriptionStatus } from '../lib/apiClient';

// Only native providers, transport and store inputs are synthetic.
// The sign-in screen, session adoption, navigation and purchase guards are real.
const noSubscription = { entitlements: { active: {}, all: {} } } as CustomerInfo;
const annual = { identifier: '$rc_annual', product: { identifier: 'annual', price: 59.99,
  priceString: '$59.99', currencyCode: 'USD', subscriptionPeriod: 'P1Y', introPrice: null } };
const offering = { identifier: 'default', annual, monthly: null, availablePackages: [annual], metadata: {} } as unknown as PurchasesOffering;

beforeEach(() => {
  jest.spyOn(Purchases, 'getCustomerInfo').mockResolvedValue(noSubscription);
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: offering, all: { default: offering } });
  jest.spyOn(Purchases, 'logIn').mockResolvedValue({ customerInfo: noSubscription, created: false });
  jest.spyOn(Purchases, 'getAppUserID').mockImplementation(async () => mockState.session?.user.id ?? '$RCAnonymousID:fixture');
});

it.each(['Apple failure', 'Apple cancellation', 'Google exchange failure', 'Google cancellation', 'Google missing token', 'Apple session rejection', 'Google session rejection'] as const)(
  '%s cannot expose plans or invoke purchase; only a valid-session retry continues', async kind => {
    const alert = jest.spyOn(Alert, 'alert');
    const purchase = jest.spyOn(Purchases, 'purchasePackage');
    const nativeApple = jest.mocked(AppleAuthentication.signInAsync);
    const credential = { identityToken: 'apple-token', authorizationCode: 'apple-code' } as AppleAuthentication.AppleAuthenticationCredential;
    nativeApple.mockReset().mockResolvedValue(credential);
    if (kind === 'Apple failure' || kind === 'Apple cancellation') nativeApple.mockRejectedValueOnce(new Error(
      kind === 'Apple cancellation' ? 'The user canceled the authorization attempt' : 'The authorization attempt failed for an unknown reason'));
    if (kind.endsWith('session rejection')) jest.spyOn(supabase.auth, 'setSession').mockImplementationOnce(async () => {
      // A rejected refresh during adoption can emit SIGNED_OUT before returning.
      for (const listener of mockState.authListeners) listener('SIGNED_OUT', null);
      return { data: { session: null, user: null }, error: new Error('Session rejected') } as never;
    });
    if (kind === 'Google cancellation') mockState.googleResponse = 'cancel';
    if (kind === 'Google missing token') mockState.googleResponse = 'missing-token';
    let rejectGoogle = kind === 'Google exchange failure';
    global.fetch = jest.fn(withAccountProfile((url: string) => {
      if (String(url).endsWith('/api/auth/google') && rejectGoogle) {
        rejectGoogle = false;
        return Promise.resolve({ ...response({ error: 'Provider token rejected' }), ok: false, status: 401 });
      }
      return Promise.resolve(response(/\/api\/auth\/(apple|google)$/.test(String(url))
        ? { token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: false }
        : { active: false, synced: true, verdict: 'never_subscribed', lastRcVerifiedAt: new Date().toISOString(), stale: false }));
    }));
    await rememberPaywallIntent(selected);
    await rememberPaymentSignInContinuation();
    const routeMap = { ...routes, 'welcome/payment': () => <Payment /> };
    const screen = renderJourney('/welcome/payment', routeMap);
    await waitFor(() => expect(screen.getPathname()).toBe('/welcome/signin'));
    await waitFor(() => expect(screen.getByTestId('signup-selected-restaurant')).toBeTruthy());
    const providerControl = kind.startsWith('Google') ? 'signup-google' : 'signup-apple';
    await act(async () => { fireEvent.press(screen.getByTestId(providerControl)); });
    if (!kind.endsWith('cancellation')) await waitFor(() => expect(alert).toHaveBeenCalled());
    else expect(alert).not.toHaveBeenCalled();
    expect(mockState.session).toBeNull();
    expect(screen.getPathname()).toBe('/welcome/signin');
    expect(screen.queryByTestId('paywall-logo')).toBeNull();
    expect(screen.queryByTestId('welcome-continue')).toBeNull();
    expect(purchase).not.toHaveBeenCalled();
    expect(await getPaywallIntent()).toEqual(selected);
    expect(screen.getByTestId('signup-selected-restaurant-name').props.children).toBe(selected.restaurantName);
    expect(await getStoredToken()).toBeNull();
    expect(JSON.parse((await AsyncStorage.getItem('@fitsy/paywallIntent'))!).userId).toBeNull();
    expect(screen.getByTestId(providerControl).props.accessibilityState.disabled).toBe(false);

    // An unauthenticated cold resume cannot turn the failed attempt into checkout.
    screen.unmount();
    const resumed = renderJourney('/', routeMap);
    await waitFor(() => expect(resumed.getPathname()).toBe('/welcome/signin'));
    expect(resumed.queryByTestId('paywall-logo')).toBeNull();
    expect(purchase).not.toHaveBeenCalled();
    mockState.googleResponse = undefined;
    await act(async () => { fireEvent.press(resumed.getByTestId(providerControl)); });
    await waitFor(() => expect(resumed.getByTestId('paywall-offer-paid')).toBeTruthy());
    expect(mockState.session?.user.id).toBe('buyer');
    expect(resumed.getAllByTestId('paywall-logo')).toHaveLength(1);
    expect(resumed.queryByTestId('signup-apple')).toBeNull();
    expect(await getPaywallIntent('buyer')).toEqual(selected);
    expect(JSON.parse((await AsyncStorage.getItem('@fitsy/paywallIntent'))!).userId).toBe('buyer');
    expect(purchase).not.toHaveBeenCalled();
    // Synthetic native purchase boundary: only the later valid session unlocks it.
    await act(async () => { fireEvent.press(resumed.getByTestId('welcome-continue')); });
    expect(purchase).toHaveBeenCalledTimes(1);
  },
);

it.each(['welcome-continue', 'paywall-restore', 'api-401'])('session expiry before %s returns to sign-in without a native transaction', async control => {
  const purchase = jest.spyOn(Purchases, 'purchasePackage');
  const restore = jest.spyOn(Purchases, 'restorePurchases');
  jest.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
    identityToken: 'apple-token', authorizationCode: 'apple-code',
  } as AppleAuthentication.AppleAuthenticationCredential);
  global.fetch = jest.fn(withAccountProfile((url: string) => Promise.resolve(response(url.endsWith('/api/auth/apple')
    ? { token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: false }
    : { active: false, synced: true, verdict: 'never_subscribed', lastRcVerifiedAt: new Date().toISOString(), stale: false }))));
  await rememberPaywallIntent(selected);
  await rememberPaymentSignInContinuation();
  const screen = renderJourney('/welcome/signin?returnTo=payment', { ...routes, 'welcome/payment': () => <Payment /> });
  await act(async () => { fireEvent.press(screen.getByTestId('signup-apple')); });
  await waitFor(() => expect(screen.getByTestId('paywall-offer-paid')).toBeTruthy());
  // getSession can discover expiry before the auth listener rerenders payment.
  if (control === 'api-401') {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ...response({ error: 'Session expired' }), ok: false, status: 401 });
    await act(async () => { await expect(fetchSubscriptionStatus()).rejects.toMatchObject({ status: 401 }); });
    expect(await getStoredToken()).toBeNull();
  } else {
    mockState.session = null;
    await act(async () => { fireEvent.press(screen.getByTestId(control)); });
  }
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/signin'));
  // An expired account's selection stays durable but hidden while anonymous.
  expect(JSON.parse((await AsyncStorage.getItem('@fitsy/paywallIntent'))!).intent).toEqual(selected);
  expect(screen.queryByTestId('signup-selected-restaurant')).toBeNull();
  expect(screen.queryByTestId('paywall-logo')).toBeNull();
  expect(purchase).not.toHaveBeenCalled();
  expect(restore).not.toHaveBeenCalled();
  await act(async () => {
    for (const listener of mockState.authListeners) listener('SIGNED_OUT', null);
  });
  expect(JSON.parse((await AsyncStorage.getItem('@fitsy/paywallIntent'))!).intent).toEqual(selected);
  await act(async () => { fireEvent.press(screen.getByTestId('signup-apple')); });
  await waitFor(() => expect(screen.getByTestId('paywall-offer-paid')).toBeTruthy());
  expect(await getPaywallIntent('buyer')).toEqual(selected);
  expect(purchase).not.toHaveBeenCalled();
  expect(restore).not.toHaveBeenCalled();
});

it.each(['malformed', 'unavailable'] as const)(
  'keeps checkout on sign-in for a %s account profile and continues after a valid-profile retry', async kind => {
    const alert = jest.spyOn(Alert, 'alert');
    const purchase = jest.spyOn(Purchases, 'purchasePackage');
    jest.mocked(AppleAuthentication.signInAsync).mockReset().mockResolvedValue({
      identityToken: 'apple-token', authorizationCode: 'apple-code',
    } as AppleAuthentication.AppleAuthenticationCredential);
    const authAndSubscription = async (url: string) => response(url.endsWith('/api/auth/apple')
      ? { token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: false }
      : { active: false, synced: true, verdict: 'never_subscribed',
        lastRcVerifiedAt: new Date().toISOString(), stale: false });
    // Deliberately wrong profile transport, not a stub of profileSync or sign-in.
    global.fetch = jest.fn(withAccountProfile(authAndSubscription, async () => kind === 'malformed'
      ? response({ macroTarget: null })
      : { ...response({ error: 'Profile unavailable' }), ok: false, status: 503 }));
    await rememberPaywallIntent(selected);
    await rememberPaymentSignInContinuation();
    const screen = renderJourney('/welcome/payment', { ...routes, 'welcome/payment': () => <Payment /> });
    await waitFor(() => expect(screen.getPathname()).toBe('/welcome/signin'));
    await act(async () => { fireEvent.press(screen.getByTestId('signup-apple')); });
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Sign In Failed',
      'Could not load your account targets. Try again when you are connected.'));
    expect(mockState.session?.user.id).toBe('buyer');
    expect(screen.getPathname()).toBe('/welcome/signin');
    expect(screen.queryByTestId('paywall-logo')).toBeNull();
    expect(await getPaywallIntent('buyer')).toEqual(selected);
    expect(purchase).not.toHaveBeenCalled();

    global.fetch = jest.fn(withAccountProfile(authAndSubscription));
    await act(async () => { fireEvent.press(screen.getByTestId('signup-apple')); });
    await waitFor(() => expect(screen.getByTestId('paywall-offer-paid')).toBeTruthy());
    expect(screen.getPathname()).toBe('/welcome/payment');
    expect(screen.queryByTestId('signup-apple')).toBeNull();
    expect(await getPaywallIntent('buyer')).toEqual(selected);
    expect(purchase).not.toHaveBeenCalled();
  },
);
