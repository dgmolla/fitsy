import { mockState, selected, response, routes, renderJourney, AsyncStorage, act, fireEvent, waitFor, getPaywallIntent, rememberPaywallIntent, rememberPaymentSignInContinuation } from './OnboardingNavigationHarness';
import { Alert } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import Purchases, { type CustomerInfo, type PurchasesOffering } from 'react-native-purchases';
import Payment from '../app/welcome/payment';

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

it.each(['Apple failure', 'Apple cancellation', 'Google exchange failure'] as const)(
  '%s cannot expose plans or invoke purchase; only a valid-session retry continues', async kind => {
    const alert = jest.spyOn(Alert, 'alert');
    const purchase = jest.spyOn(Purchases, 'purchasePackage');
    const nativeApple = jest.mocked(AppleAuthentication.signInAsync);
    const credential = { identityToken: 'apple-token', authorizationCode: 'apple-code' } as AppleAuthentication.AppleAuthenticationCredential;
    nativeApple.mockReset().mockResolvedValue(credential);
    if (kind !== 'Google exchange failure') nativeApple.mockRejectedValueOnce(new Error(
      kind === 'Apple cancellation' ? 'The user canceled the authorization attempt' : 'The authorization attempt failed for an unknown reason'));
    global.fetch = jest.fn((url: RequestInfo | URL) => Promise.resolve(String(url).endsWith('/api/auth/google')
      ? { ...response({ error: 'Provider token rejected' }), ok: false, status: 401 }
      : response(String(url).endsWith('/api/auth/apple')
        ? { token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: false }
        : { active: false, synced: true, verdict: 'never_subscribed', lastRcVerifiedAt: new Date().toISOString(), stale: false })));
    await rememberPaywallIntent(selected);
    await rememberPaymentSignInContinuation();
    const routeMap = { ...routes, 'welcome/payment': () => <Payment /> };
    const screen = renderJourney('/welcome/payment', routeMap);
    await waitFor(() => expect(screen.getPathname()).toBe('/welcome/signin'));
    await waitFor(() => expect(screen.getByTestId('signup-selected-restaurant')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId(kind === 'Google exchange failure' ? 'signup-google' : 'signup-apple')); });
    if (kind !== 'Apple cancellation') await waitFor(() => expect(alert).toHaveBeenCalled());
    else expect(alert).not.toHaveBeenCalled();
    expect(mockState.session).toBeNull();
    expect(screen.getPathname()).toBe('/welcome/signin');
    expect(screen.queryByTestId('paywall-logo')).toBeNull();
    expect(screen.queryByTestId('welcome-continue')).toBeNull();
    expect(purchase).not.toHaveBeenCalled();
    expect(await getPaywallIntent()).toEqual(selected);

    // An unauthenticated cold resume cannot turn the failed attempt into checkout.
    screen.unmount();
    const resumed = renderJourney('/welcome/payment', routeMap);
    await waitFor(() => expect(resumed.getPathname()).toBe('/welcome/signin'));
    expect(resumed.queryByTestId('paywall-logo')).toBeNull();
    expect(purchase).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(resumed.getByTestId('signup-apple')); });
    await waitFor(() => expect(resumed.getByTestId('paywall-offer-paid')).toBeTruthy());
    expect(mockState.session?.user.id).toBe('buyer');
    expect(resumed.getAllByTestId('paywall-logo')).toHaveLength(1);
    expect(resumed.queryByTestId('signup-apple')).toBeNull();
    expect(await getPaywallIntent('buyer')).toEqual(selected);
    expect(JSON.parse((await AsyncStorage.getItem('@fitsy/paywallIntent'))!).userId).toBe('buyer');
    expect(purchase).not.toHaveBeenCalled();
  },
);
