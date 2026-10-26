import { mockState, response, routes, renderJourney, withAccountProfile, AsyncStorage, act, fireEvent, waitFor, router } from './OnboardingNavigationHarness';
import { Alert } from 'react-native';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as SecureStore from 'expo-secure-store';
import Purchases, { type CustomerInfo, type PurchasesOffering } from 'react-native-purchases';
import Payment from '../app/welcome/payment';
import Preview from '../app/welcome/preview';

const { loadAll } = require('js-yaml') as { loadAll(source: string): unknown[] };
type Step = {
  tapOn?: string | { id: string };
  extendedWaitUntil?: { visible: { id: string; enabled?: boolean }; timeout: number };
  assertVisible?: { id: string };
  assertNotVisible?: string | { id: string };
};
const [, commands] = loadAll(readFileSync(resolve(__dirname, '../e2e/flows/onboarding-returning-preview.yaml'), 'utf8')) as [unknown, Step[]];
const loginSteps = commands.flatMap((step, index) => typeof step.tapOn === 'object' && step.tapOn.id === 'signup-dev' ? [index] : []);
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

test('both saved authentication checkpoints distinguish login failure from checkout readiness', () => {
  expect(loginSteps).toHaveLength(2);
  for (const index of loginSteps) {
    const ready = commands[index + 1]?.extendedWaitUntil;
    expect(ready).toEqual({ visible: { id: '^(paywall-logo|signup-dev)$', enabled: true }, timeout: 30000 });
    expect(commands[index + 2]?.assertNotVisible).toBe('Dev Login Failed');
    expect(commands[index + 3]?.assertVisible).toEqual({ id: 'paywall-logo' });
  }
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
  const login = commands[loginSteps[0]!]!.tapOn as { id: string };
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
  const secondLogin = commands[loginSteps[1]!]!.tapOn as { id: string };
  await act(async () => { fireEvent.press(returning.getByTestId(secondLogin.id)); });
  await returning.findByTestId('paywall-offer-paid');
  expect(returning.getByTestId('paywall-logo')).toBeTruthy();
  expect(returning.queryByTestId('preview-guide')).toBeNull();
  expect(await AsyncStorage.getItem('@fitsy/paywallDeclined')).toBe('1');
  expect(purchase).not.toHaveBeenCalled();
  await act(async () => { returning.unmount(); });
});
