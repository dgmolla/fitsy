import { mockState, response, routes, renderJourney, withAccountProfile, saveOnboardingField, saveMacroTargets, AsyncStorage, act, fireEvent, waitFor, router } from './OnboardingNavigationHarness';
import { Alert } from 'react-native';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as SecureStore from 'expo-secure-store';
import Purchases, { type CustomerInfo, type PurchasesOffering } from 'react-native-purchases';
import Payment from '../app/welcome/payment';
import Preview from '../app/welcome/preview';
import Goal from '../app/welcome/goal';
import Tried from '../app/welcome/tried';
import HowItWorks from '../app/welcome/how-it-works';
import Problem from '../app/welcome/problem';
import { getOnboardingData } from '../lib/onboardingStorage';

const { loadAll } = require('js-yaml') as { loadAll(source: string): unknown[] };
type Step = {
  openLink?: string;
  tapOn?: string | { id: string };
  extendedWaitUntil?: { visible: { id: string; enabled?: boolean }; timeout: number };
  assertVisible?: { id: string };
  assertNotVisible?: string | { id: string };
  runFlow?: { file?: string; env?: { DESTINATION?: string } };
};
const [, commands] = loadAll(readFileSync(resolve(__dirname, '../e2e/flows/onboarding-returning-preview.yaml'), 'utf8')) as [unknown, Step[]];
const [, signinCommands] = loadAll(readFileSync(resolve(__dirname, '../e2e/helpers/discovery-signin.yaml'), 'utf8')) as [unknown, Step[]];
const login = signinCommands.find(step => typeof step.tapOn === 'object' && step.tapOn.id === 'signup-dev')!.tapOn as { id: string };
const routeMap = { ...routes, 'welcome/payment': () => <Payment />, 'welcome/preview': () => <Preview /> };
const noSubscription = { entitlements: { active: {}, all: {} } } as CustomerInfo;
const annual = { identifier: '$rc_annual', product: { identifier: 'annual', price: 59.99,
  priceString: '$59.99', currencyCode: 'USD', subscriptionPeriod: 'P1Y', introPrice: null } };
const offering = { identifier: 'default', annual, monthly: null, availablePackages: [annual], metadata: {} } as unknown as PurchasesOffering;
const originalEmail = process.env.EXPO_PUBLIC_DEV_LOGIN_EMAIL;
const originalPassword = process.env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD;

beforeEach(() => {
  process.env.EXPO_PUBLIC_DEV_LOGIN_EMAIL = 'returning-fixture@example.test';
  process.env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD = 'fixture-password';
  jest.spyOn(Purchases, 'getCustomerInfo').mockResolvedValue(noSubscription);
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: offering, all: { default: offering } });
  jest.spyOn(Purchases, 'logIn').mockResolvedValue({ customerInfo: noSubscription, created: false });
  jest.spyOn(Purchases, 'getAppUserID').mockImplementation(async () => mockState.session?.user.id ?? '$RCAnonymousID:fixture');
});
afterEach(() => {
  if (originalEmail === undefined) delete process.env.EXPO_PUBLIC_DEV_LOGIN_EMAIL;
  else process.env.EXPO_PUBLIC_DEV_LOGIN_EMAIL = originalEmail;
  if (originalPassword === undefined) delete process.env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD;
  else process.env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD = originalPassword;
});

test('saved authentication checkpoints cover the location and resumed-preview data boundaries', () => {
  const gates = commands.filter(step => step.runFlow?.file === '../helpers/discovery-signin.yaml');
  expect(gates.map(step => step.runFlow?.env?.DESTINATION)).toEqual(Array(2).fill('^location-(use-current|continue-area)$'));
  expect(signinCommands.some(step => step.assertNotVisible === 'Dev Login Failed')).toBe(true);
  expect(login.id).toBe('signup-dev');
});

test('the saved cancellation-to-preview sequence restores authentication before goal-dependent screens', async () => {
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  await saveOnboardingField('goal', 'lose_fat');
  await saveOnboardingField('area', { lat: 34.05, lng: -118.25, name: 'DTLA', source: 'manual' });
  await saveMacroTargets({ calories: '600', protein: '40', carbs: '60', fat: '20' });
  await AsyncStorage.setItem('@fitsy/paywallDeclined', '1');
  mockState.session = null;
  global.fetch = jest.fn(withAccountProfile(async url => {
    if (url.endsWith('/api/auth/login')) return response({ token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: false });
    if (new URL(url).pathname.startsWith('/api/restaurants'))
      return response({ data: [], meta: { nearbyDishCount: 10, radiusMiles: 3, goalMatch: null } });
    return response({ active: false, synced: true, verdict: 'never_subscribed', lastRcVerifiedAt: new Date().toISOString(), stale: false });
  }));
  const resumedRoutes = { ...routeMap, 'welcome/problem': () => <Problem />,
    'welcome/goal': () => <Goal />, 'welcome/tried': () => <Tried />, 'welcome/how-it-works': () => <HowItWorks /> };
  const screen = renderJourney('/welcome/preview', resumedRoutes);
  await screen.findByTestId('signup-apple');
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  await screen.findByTestId('welcome-start');
  const start = commands.findIndex(step => step.extendedWaitUntil?.visible.id === 'welcome-start');
  const end = commands.findIndex((step, index) => index > start && typeof step.tapOn === 'object' && step.tapOn.id === 'coachmark-skip');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  // Replay the actual saved YAML segment through real screens and routing.
  for (const step of commands.slice(start + 1, end)) {
    const link = step.openLink;
    if (link) await act(async () => { router.push(link.replace('com.fitsy.mobile://', '/') as never); });
    if (typeof step.tapOn === 'object' && step.tapOn.id) {
      const control = await screen.findByTestId(step.tapOn.id);
      await act(async () => { fireEvent.press(control); });
    }
    if (step.runFlow?.file === '../helpers/discovery-signin.yaml') {
      const control = await screen.findByTestId(login.id);
      await act(async () => { fireEvent.press(control); });
      await screen.findAllByTestId(new RegExp(step.runFlow.env!.DESTINATION!));
    }
    if (step.extendedWaitUntil?.visible.id) await screen.findByTestId(step.extendedWaitUntil.visible.id);
  }
  await screen.findByTestId('preview-guide');
  expect(mockState.session).toMatchObject({ user: { id: 'buyer' } });
  expect((await getOnboardingData()).goal).toBe('lose_fat');
  expect(screen.queryByTestId('signup-apple')).toBeNull();
  expect(screen.queryByTestId('paywall-logo')).toBeNull();
});

test('a corrected fixture login reaches the real paywall, records decline and gates anonymous return without purchasing', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const purchase = jest.spyOn(Purchases, 'purchasePackage');
  let rejectLogin = true;
  const fetch = jest.fn(withAccountProfile(async url => {
    if (url.endsWith('/api/auth/login')) return rejectLogin
      ? { ...response({ error: 'Invalid credentials' }), ok: false, status: 401 }
      : response({ token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: false });
    if (url.endsWith('/api/auth/register')) return { ...response({ error: 'Email already registered' }), ok: false, status: 409 };
    return response({ active: false, synced: true, verdict: 'never_subscribed', lastRcVerifiedAt: new Date().toISOString(), stale: false });
  }));
  global.fetch = fetch;
  const screen = renderJourney('/welcome/payment', routeMap);
  const signup = await screen.findByTestId('signup-dev');
  expect(screen.queryByTestId('paywall-logo')).toBeNull();
  await act(async () => { fireEvent.press(signup); });
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Dev Login Failed', 'Invalid credentials'));
  expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/api/auth/register'))).toBe(false);
  expect(mockState.session).toBeNull();
  expect(screen.getPathname()).toBe('/welcome/signin');
  expect(screen.queryByTestId('paywall-logo')).toBeNull();

  rejectLogin = false;
  await act(async () => { fireEvent.press(screen.getByTestId(login.id)); });
  await screen.findByTestId('paywall-offer-paid');
  expect(screen.getByTestId('paywall-logo')).toBeTruthy();
  expect(screen.queryByTestId('signup-dev')).toBeNull();
  expect(mockState.session?.user.id).toBe('buyer');
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-skip')); });
  await act(async () => { fireEvent.press(screen.getByTestId('paywall-decline')); });
  await waitFor(async () => expect(await AsyncStorage.getItem('@fitsy/paywallDeclined')).toBe('1'));
  await screen.findByTestId('paywall-logo');
  await act(async () => { screen.unmount(); });
  // The saved flow clears the disposable keychain, retaining AsyncStorage.
  mockState.session = null;
  await SecureStore.deleteItemAsync('fitsy_authToken');
  const returning = renderJourney('/welcome/preview', routeMap);
  await returning.findByTestId('signup-apple');
  expect(returning.getPathname()).toBe('/welcome/signin');
  expect(returning.queryByTestId('paywall-logo')).toBeNull();
  expect(returning.queryByTestId('preview-guide')).toBeNull();
  expect(await AsyncStorage.getItem('@fitsy/paywallDeclined')).toBe('1');
  await act(async () => { router.push('/welcome/payment'); });
  await returning.findByTestId('signup-dev');
  expect(returning.queryByTestId('paywall-logo')).toBeNull();
  await act(async () => { fireEvent.press(returning.getByTestId(login.id)); });
  await returning.findByTestId('paywall-offer-paid');
  expect(returning.getByTestId('paywall-logo')).toBeTruthy();
  expect(returning.queryByTestId('preview-guide')).toBeNull();
  expect(await AsyncStorage.getItem('@fitsy/paywallDeclined')).toBe('1');
  expect(purchase).not.toHaveBeenCalled();
  await act(async () => { returning.unmount(); });
});
