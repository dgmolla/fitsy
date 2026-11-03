import { withAccountProfile, seedAccountProfile, mockState, response, routes, renderJourney, AsyncStorage, act, fireEvent, waitFor } from './OnboardingNavigationHarness';
import Login from '../app/auth/login';
import { supabase } from '../lib/supabase';
import { readAccountHistory } from '../lib/accountHistory';
import Purchases, { type CustomerInfo } from 'react-native-purchases';

const routeMap = { ...routes, 'auth/login': Login };
const target = { proteinG: 140, carbsG: 175, fatG: 70, calories: 1890, source: 'manual' as const };

function installAccount(verdict: 'active' | 'expired' | 'never_subscribed', hasTargets: boolean) {
  seedAccountProfile('buyer', { user: { goal: 'lose_fat' }, macroTarget: hasTargets ? target : null });
  global.fetch = jest.fn(withAccountProfile(async url => response(/\/api\/auth\/(apple|google|login)$/.test(url)
    ? { token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: false }
    : { active: verdict === 'active', verdict, status: verdict === 'never_subscribed' ? null : verdict,
      synced: true, stale: false, lastRcVerifiedAt: new Date().toISOString(),
      expiresAt: verdict === 'expired' ? '2020-01-01T00:00:00Z' : null })));
}

beforeEach(() => {
  const empty = { entitlements: { active: {}, all: {} } } as CustomerInfo;
  jest.spyOn(Purchases, 'getCustomerInfo').mockResolvedValue(empty);
  jest.spyOn(Purchases, 'logIn').mockResolvedValue({ customerInfo: empty, created: false });
  jest.spyOn(Purchases, 'getAppUserID').mockImplementation(async () => mockState.session?.user.id ?? '$RCAnonymousID:fixture');
  // Only the native/provider boundary is synthetic; authentication, profile
  // reconciliation, purchase state and the root router all run normally.
  jest.spyOn(supabase.auth, 'setSession').mockImplementation(async () => {
    mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
    for (const listener of mockState.authListeners) listener('SIGNED_IN', mockState.session);
    return { data: { session: mockState.session }, error: null } as never;
  });
});

it.each([
  ['expired', true, '/welcome/resubscribe'],
  ['never_subscribed', true, '/welcome/payment'],
  ['active', false, '/macro-setup'],
  ['active', true, '/search'],
] as const)('takes an existing Apple account with %s access and targets=%s past the intro', async (verdict, hasTargets, destination) => {
  installAccount(verdict, hasTargets);
  await AsyncStorage.setItem('@fitsy/discoverySignIn', '/welcome/location-permission');
  const screen = renderJourney('/welcome/signin?returnTo=discovery', routeMap);
  await act(async () => { fireEvent.press(screen.getByTestId('signup-apple')); });
  await waitFor(() => expect(screen.getPathname()).toBe(destination));
  expect(mockState.session?.user.id).toBe('buyer');
  expect(screen.queryByTestId('location-use-current')).toBeNull();
  expect(await readAccountHistory()).toBe(true);
  screen.unmount();
  const restarted = renderJourney('/', routeMap);
  await waitFor(() => expect(restarted.getPathname()).toBe(destination));
});

it.each(['Continue with Apple', 'Continue with Google', 'Dev Login (skip auth)'])(
  'recognizes the reproduced prior-device state and resolves %s through account routing', async button => {
    installAccount('never_subscribed', true);
    const retained = JSON.stringify({ _owner: 'buyer', goal: 'lose_fat' });
    await AsyncStorage.multiSet([
      ['@fitsy/onboarding', retained],
      ['@fitsy/onboardingStep', 'signin'],
      ['@fitsy/discoverySignIn', '/welcome/location-permission'],
    ]);
    const screen = renderJourney('/', routeMap);
    await waitFor(() => expect(screen.getPathname()).toBe('/auth/login'));
    expect(screen.getByText('Welcome back')).toBeTruthy();
    expect(screen.getByText('New here? Start over')).toBeTruthy();
    expect(await AsyncStorage.getItem('@fitsy/onboarding')).toBe(retained);
    await act(async () => { fireEvent.press(screen.getByText(button)); });
    await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
    expect(screen.queryByTestId('location-use-current')).toBeNull();
  },
);

it('lets a returning device start over without erasing retained account or temporary state', async () => {
  installAccount('never_subscribed', true);
  const retained = JSON.stringify({ _owner: 'buyer', goal: 'lose_fat' });
  await AsyncStorage.multiSet([['@fitsy/onboarding', retained], ['@fitsy/onboardingStep', 'signin']]);
  const screen = renderJourney('/', routeMap);
  await waitFor(() => expect(screen.getByTestId('login-start-over')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('login-start-over')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/problem'));
  expect(await AsyncStorage.getItem('@fitsy/onboarding')).toBe(retained);
  expect(await AsyncStorage.getItem('@fitsy/onboardingStep')).toBe('signin');
});
