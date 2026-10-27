import { mockState, selected, response, deferred, installEligibleTrialOffer, installPurchasedAccount, routes, renderJourney, Alert, AsyncStorage, ExpoNotifications, NotificationHelpers, act, fireEvent, waitFor, readReminderPreferences, getPaywallIntent, rememberPaywallIntent } from './OnboardingNavigationHarness';
import { installAccountProfile } from './test-fixtures/accountProfile';
import { getMacroTargets } from '../lib/macroStorage';
import { recordOnboardingComplete } from '../lib/onboardingCompletion';
import { replayPendingProfileSync } from '../lib/profileSync';
import Payment from '../app/welcome/payment';

it('asks an anonymous trial reminder opt-in to sign in before permission, then returns to the choice', async () => {
  installEligibleTrialOffer();
  (ExpoNotifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'granted' });
  (ExpoNotifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'granted' });
  const screen = renderJourney('/welcome/trial-reminder');
  await screen.findByTestId('trial-reminder-allow');
  expect(ExpoNotifications.getPermissionsAsync).toHaveBeenCalled();
  expect(screen.getByText('Get a trial reminder')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/signin'));
  expect(ExpoNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(await readReminderPreferences('buyer')).toEqual({ meals: false, trial: false });
  (global.fetch as jest.Mock).mockImplementation((url: string) => Promise.resolve(url.endsWith('/api/auth/login')
    ? response({ token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: true })
    : response(String(url).includes('/api/user/profile') ? { user: { birthday: null, heightCm: null, weightKg: null, sex: null, activityLevel: null, goal: null }, macroTarget: null } : { active: false })));
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  await act(async () => { fireEvent.press(screen.getByTestId('signup-dev')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/trial-reminder'));
  expect(ExpoNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  await screen.findByTestId('trial-reminder-allow');
  await act(async () => { fireEvent.press(screen.getByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(ExpoNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(await readReminderPreferences('buyer')).toEqual({ meals: false, trial: true });
});

it('registers a push token after a signed-in trial reminder opt-in', async () => {
  installEligibleTrialOffer();
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  (ExpoNotifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'granted' });
  jest.spyOn(NotificationHelpers, 'getExpoPushTokenAsync').mockResolvedValue('ExponentPushToken[buyer]');
  const screen = renderJourney('/welcome/trial-reminder');
  await screen.findByTestId('trial-reminder-allow');
  await act(async () => { fireEvent.press(screen.getByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(await readReminderPreferences('buyer')).toEqual({ meals: false, trial: true });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/user/push-token'),
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'ExponentPushToken[buyer]' }) }),
  ));
});

it('does not register account A trial token after account B signs in during token retrieval', async () => {
  installEligibleTrialOffer();
  mockState.session = { access_token: 'token-a', user: { id: 'buyer-a' } };
  (ExpoNotifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'granted' });
  const token = deferred<string>();
  jest.spyOn(NotificationHelpers, 'getExpoPushTokenAsync').mockReturnValueOnce(token.promise);
  const screen = renderJourney('/welcome/trial-reminder');
  await screen.findByTestId('trial-reminder-allow');
  await act(async () => { fireEvent.press(screen.getByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  await waitFor(() => expect(NotificationHelpers.getExpoPushTokenAsync).toHaveBeenCalled());
  mockState.session = { access_token: 'token-b', user: { id: 'buyer-b' } };
  await act(async () => { token.resolve('ExponentPushToken[buyer-a]'); });
  expect(global.fetch).not.toHaveBeenCalledWith(
    expect.stringContaining('/api/user/push-token'), expect.anything(),
  );
});

it('does not sign out account B for account A push registration returning 401 late', async () => {
  installEligibleTrialOffer();
  mockState.session = { access_token: 'token-a', user: { id: 'buyer-a' } };
  (ExpoNotifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'granted' });
  jest.spyOn(NotificationHelpers, 'getExpoPushTokenAsync').mockResolvedValueOnce('ExponentPushToken[buyer-a]');
  const pushResponse = deferred<Response>();
  global.fetch = jest.fn((url: RequestInfo | URL) => String(url).endsWith('/api/user/push-token')
    ? pushResponse.promise : Promise.resolve(response({ active: false })));
  const screen = renderJourney('/welcome/trial-reminder');
  await screen.findByTestId('trial-reminder-allow');
  await act(async () => { fireEvent.press(screen.getByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/user/push-token'), expect.objectContaining({ method: 'POST' }),
  ));
  mockState.session = { access_token: 'token-b', user: { id: 'buyer-b' } };
  await act(async () => { pushResponse.resolve({ ok: false, status: 401 } as Response); });
  expect(mockState.session?.user.id).toBe('buyer-b');
  expect(screen.getPathname()).toBe('/welcome/payment');
});

it('shows only explicit notification choices after purchase resets earlier history', async () => {
  await installPurchasedAccount();
  await rememberPaywallIntent(selected);
  const screen = renderJourney('/welcome/complete');
  await act(async () => { fireEvent.press(screen.getByText('Complete purchased onboarding')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/notification-permission'));
  expect(screen.getByTestId('notification-skip')).toBeTruthy();
  expect(screen.queryByTestId('welcome-back')).toBeNull();
});

it('rejects anonymous notification entry without completing or clearing onboarding', async () => {
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'signin');
  await rememberPaywallIntent(selected);
  const screen = renderJourney('/welcome/notification-permission', { ...routes, 'welcome/payment': () => <Payment /> });
  expect(screen.queryByTestId('notification-skip')).toBeNull();
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/signin'));
  expect(await AsyncStorage.getItem('onboardingComplete')).toBeNull();
  expect(await AsyncStorage.getItem('@fitsy/onboardingStep')).toBe('signin');
});

it('keeps Not now as the explicit route to the purchased restaurant and selected dish', async () => {
  await installPurchasedAccount();
  await rememberPaywallIntent(selected);
  const screen = renderJourney('/welcome/notification-permission');
  await screen.findByTestId('notification-skip');
  await act(async () => { fireEvent.press(screen.getByTestId('notification-skip')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/restaurant/varilla'));
  expect(screen.getByText(JSON.stringify({ id: 'varilla', selectedItemId: 'meal-1' }))).toBeTruthy();
  expect(await getPaywallIntent()).toBeNull();
});

it('offers a safe exit when a cold sign-in checkpoint has no earlier route', async () => {
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'signin');
  await rememberPaywallIntent(selected);
  const screen = renderJourney('/');
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/signin'));
  expect(await screen.findByText('Varilla')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/problem'));
  expect(await getPaywallIntent()).toBeNull();
});

it.each(['covered', 'empty', 'failure'])('ignores a %s area response after Back', async (outcome) => {
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  const coverage = deferred<Response>();
  const alert = jest.spyOn(Alert, 'alert');
  (global.fetch as jest.Mock).mockReturnValue(coverage.promise);
  const screen = renderJourney('/welcome/problem');
  await act(async () => { fireEvent.press(screen.getByText('Choose location')); });
  await act(async () => { fireEvent.press(screen.getByTestId('location-choose-area')); });
  await act(async () => { fireEvent.press(screen.getByText({ covered: 'Silver Lake', empty: 'Hollywood', failure: 'Echo Park' }[outcome]!)); });
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  expect(screen.getPathname()).toBe('/welcome/problem');
  await act(async () => { coverage.resolve(outcome === 'failure' ? { ...response({ error: 'Offline' }), ok: false } : response({ data: [], meta: { nearbyDishCount: outcome === 'covered' ? 1 : 0, radiusMiles: 3 } })); });
  expect(screen.getPathname()).toBe('/welcome/problem');
  expect(alert).not.toHaveBeenCalled();
});
it('hydrates a newer account target through selected-meal sign-in before completion can write it', async () => {
  const userId = 'buyer';
  await AsyncStorage.setItem(`@fitsy/macro_targets:${userId}`, JSON.stringify({
    calories: '660', protein: '50', carbs: '70', fat: '20', _mode: 'complete', _owner: userId, _source: 'manual',
  }));
  await rememberPaywallIntent(selected);
  const readTarget = installAccountProfile(userId, { calories: 2590, proteinG: 210, carbsG: 280, fatG: 70, source: 'manual' });
  const screen = renderJourney('/welcome/signin?returnTo=payment');
  await screen.findByTestId('signup-dev');
  await act(async () => { fireEvent.press(screen.getByTestId('signup-dev')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/restaurant/varilla'));
  expect(screen.getByText(JSON.stringify({ id: 'varilla', selectedItemId: 'meal-1' }))).toBeTruthy();
  expect(await getMacroTargets()).toEqual({ calories: '740', protein: '60', carbs: '80', fat: '20' });
  expect(await getPaywallIntent()).toBeNull();
  await recordOnboardingComplete(false);
  await replayPendingProfileSync();
  expect(readTarget()).toEqual({ calories: 2590, proteinG: 210, carbsG: 280, fatG: 70, source: 'manual' });
});
