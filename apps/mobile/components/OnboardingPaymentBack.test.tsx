import { mockState, response, routes, renderJourney, withAccountProfile, act, fireEvent, waitFor,
  saveMacroTargets, saveOnboardingField } from './OnboardingNavigationHarness';
import { useNavigation } from 'expo-router';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import Purchases, { type CustomerInfo, type PurchasesOffering } from 'react-native-purchases';
import Payment from '../app/welcome/payment';
import Preview from '../app/welcome/preview';
import Trial from '../app/welcome/trial';
import { getMacroTargets } from '../lib/macroStorage';
import { installHardwareBackFixture } from './hardwareBackHarness';

const targets = { calories: '654', protein: '0', carbs: '114', fat: '22' };
const noSubscription = { entitlements: { active: {}, all: {} } } as CustomerInfo;
const annual = { identifier: '$rc_annual', product: { identifier: 'annual', price: 59.99,
  priceString: '$59.99', currencyCode: 'USD', subscriptionPeriod: 'P1Y', introPrice: null } };
const offering = { identifier: 'default', annual, monthly: null, availablePackages: [annual], metadata: {} } as unknown as PurchasesOffering;
const restaurant = { id: 'varilla', name: 'Varilla', address: 'Test', lat: 34.04, lng: -118.24,
  distanceMiles: 1, cuisineTags: [], chainFlag: false,
  bestMatch: { menuItemId: 'pizza-1', name: 'Pizza', calories: 650, proteinG: 20, carbsG: 100,
    fatG: 19, confidence: 'HIGH', matchScore: 0 } };
let paymentNavigation: NavigationProp<ParamListBase>;
function ObservedPayment() {
  paymentNavigation = useNavigation<NavigationProp<ParamListBase>>();
  return <Payment />;
}
const routeMap = { ...routes, 'welcome/payment': ObservedPayment,
  'welcome/preview': () => <Preview />, 'welcome/trial': Trial };

async function signInFromPreview() {
  const screen = renderJourney('/welcome/preview', routeMap);
  await screen.findByTestId('discovery-hero');
  if (screen.queryByTestId('coachmark-skip')) await act(async () => { fireEvent.press(screen.getByTestId('coachmark-skip')); });
  await act(async () => { fireEvent.press(screen.getByTestId('discovery-hero')); });
  await screen.findByTestId('signup-apple');
  await act(async () => { fireEvent.press(screen.getByTestId('signup-apple')); });
  return screen;
}

beforeEach(async () => {
  jest.spyOn(Purchases, 'getCustomerInfo').mockResolvedValue(noSubscription);
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: offering, all: { default: offering } });
  jest.spyOn(Purchases, 'logIn').mockResolvedValue({ customerInfo: noSubscription, created: false });
  jest.spyOn(Purchases, 'getAppUserID').mockImplementation(async () => mockState.session?.user.id ?? '$RCAnonymousID:fixture');
  global.fetch = jest.fn(withAccountProfile(async url => {
    if (url.endsWith('/api/auth/apple')) return response({ token: 'test-token', refreshToken: 'refresh',
      user: { id: 'buyer' }, isNewUser: false });
    if (url.includes('/api/restaurants/preview')) return response({ data: [restaurant],
      meta: { radiusMiles: 3, nearbyDishCount: 90 } });
    return response({ active: false, synced: true, verdict: 'never_subscribed',
      lastRcVerifiedAt: new Date().toISOString(), stale: false });
  }));
  await saveMacroTargets(targets);
  await saveOnboardingField('goal', 'lose_fat');
  await saveOnboardingField('area', { lat: 34.0407, lng: -118.2468, name: 'DTLA', source: 'manual' });
  await saveOnboardingField('previewArea', '34.0407:-118.2468');
  await saveOnboardingField('previewCraving', 'pizza');
});

it.each(['paid', 'allow reminder', 'skip reminder'].flatMap(offer =>
  ['visible', 'hardware'].flatMap(kind => [false, true].map(lostHistory => ({ offer, kind, lostHistory }))),
))('returns fresh $offer checkout through $kind Back (lost history: $lostHistory)', async ({ offer, kind, lostHistory }) => {
  const back = kind === 'hardware' ? installHardwareBackFixture() : null;
  const purchase = jest.spyOn(Purchases, 'purchasePackage');
  if (offer !== 'paid') {
    const eligibleAnnual = { ...annual, product: { ...annual.product,
      introPrice: { price: 0, priceString: '$0', period: 'P1W', cycles: 1 } } };
    const eligible = { ...offering, annual: eligibleAnnual, availablePackages: [eligibleAnnual] } as unknown as PurchasesOffering;
    jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: eligible, all: { default: eligible } });
    jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValue({ annual: { status: 2, description: 'Eligible' } });
  }
  const screen = await signInFromPreview();
  if (offer !== 'paid') {
    await screen.findByTestId('trial-no-payment');
    await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
    await screen.findByTestId('trial-reminder-allow');
    await act(async () => { fireEvent.press(screen.getByTestId(offer === 'allow reminder' ? 'trial-reminder-allow' : 'trial-reminder-skip')); });
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    await screen.findByTestId('paywall-logo');
    if (lostHistory) {
      // Exercise history loss with real nested navigation: retain the checkout
      // route but remove its predecessor, without fabricating purchase or app state.
      await act(async () => {
        const state = paymentNavigation.getState();
        const route = state.routes[state.index];
        paymentNavigation.reset({ index: 0, routes: [{ name: route.name, params: route.params }] });
      });
      expect(paymentNavigation.canGoBack()).toBe(false);
      await screen.findByTestId('paywall-logo');
    }
    await act(async () => { if (back) back(); else fireEvent.press(screen.getByTestId('welcome-back')); });
    await waitFor(() => expect(screen.getPathname()).toBe('/welcome/preview'));
    await screen.findByTestId('discovery-hero');
    expect(screen.getByTestId('discovery-search').props.value).toBe('pizza');
    for (const value of ['654', '0g', '114g', '22g']) expect(screen.getByText(value)).toBeTruthy();
    expect(await getMacroTargets()).toEqual(targets);
    expect(screen.queryByTestId('paywall-decline')).toBeNull();
    // The second checkout starts already signed in and must keep the same return.
    if (attempt === 0) await act(async () => { fireEvent.press(screen.getByTestId('discovery-hero')); });
  }
  expect(purchase).not.toHaveBeenCalled();
});

it('retains the intentional exit on cold payment resume after a fresh preview checkout', async () => {
  const screen = await signInFromPreview();
  await screen.findByTestId('paywall-logo');
  await act(async () => { screen.unmount(); });
  const resumed = renderJourney('/', routeMap);
  await resumed.findByTestId('paywall-logo');
  expect(paymentNavigation.canGoBack()).toBe(false);
  await act(async () => { fireEvent.press(resumed.getByTestId('welcome-back')); });
  expect(resumed.getByTestId('paywall-back-to-plans')).toBeTruthy();
  expect(resumed.getPathname()).toBe('/welcome/payment');
  expect(resumed.queryByTestId('preview-back')).toBeNull();
});
