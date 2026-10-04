import { mockState, selected, response, deferred, routes, installEligibleTrialOffer, renderJourney, Alert, AsyncStorage, act, fireEvent, waitFor, MacroSetup, getPaywallIntent, rememberPaywallIntent, getStoredToken, saveMacroTargets, saveOnboardingField, hasPaymentSignInContinuation, rememberPaymentSignInContinuation, hasPendingMealClaim, rememberPendingMealClaim } from './OnboardingNavigationHarness';

it('claims an anonymous meal when checkout restarts after the session is saved', async () => {
  await rememberPaywallIntent(selected);
  await rememberPaymentSignInContinuation();
  await saveMacroTargets({ calories: '600', protein: '40', carbs: '50', fat: '20' });
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'signin');
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  global.fetch = jest.fn().mockResolvedValue(response({ active: true, synced: true, verdict: 'active',
    lastRcVerifiedAt: new Date().toISOString(), stale: false, expiresAt: '2030-01-08T12:00:00Z' }));
  expect(await getPaywallIntent()).toBeNull();
  const screen = renderJourney('/');
  await waitFor(() => expect(screen.getPathname()).toBe('/restaurant/varilla'));
  expect(screen.getByText(JSON.stringify({ id: 'varilla', selectedItemId: 'meal-1' }))).toBeTruthy();
  expect(await hasPaymentSignInContinuation()).toBe(false);
});

it('rejects an interrupted checkout and pending meal claim owned by another account', async () => {
  await rememberPaywallIntent(selected);
  await rememberPendingMealClaim();
  await AsyncStorage.setItem('@fitsy/paymentSignInContinuation', 'user:account-a');
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'signin');
  mockState.session = { access_token: 'test-token', user: { id: 'account-b' } };
  installEligibleTrialOffer();
  const screen = renderJourney('/');
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/trial'));
  expect(await getPaywallIntent()).toBeNull();
  expect(await hasPendingMealClaim()).toBe(false);
  expect(await hasPaymentSignInContinuation()).toBe(false);
});

it('claims a first-time anonymous meal after sign-in is interrupted without skipping trial', async () => {
  await rememberPaywallIntent(selected);
  await rememberPendingMealClaim();
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'signin');
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  installEligibleTrialOffer();
  expect(await getPaywallIntent()).toBeNull();
  const screen = renderJourney('/');
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/trial'));
  expect(await getPaywallIntent()).toEqual(selected);
  expect(await hasPendingMealClaim()).toBe(false);
});

it.each(['@fitsy/pendingMealClaim', '@fitsy/paymentSignInContinuation'])(
  'restores an active account meal if sign-in stops just after consuming %s', async interruptedKey => {
  await rememberPaywallIntent(selected);
  await rememberPendingMealClaim();
  await rememberPaymentSignInContinuation();
  await saveMacroTargets({ calories: '600', protein: '40', carbs: '50', fat: '20' });
  global.fetch = jest.fn((url: RequestInfo | URL) => Promise.resolve(String(url).endsWith('/api/auth/login')
    ? response({ token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: false })
    : response({ active: true, synced: true, verdict: 'active',
      lastRcVerifiedAt: new Date().toISOString(), stale: false, expiresAt: '2030-01-08T12:00:00Z' })));
  const originalRemove = (AsyncStorage.removeItem as jest.Mock).getMockImplementation() as typeof AsyncStorage.removeItem;
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (key: string) => {
    await originalRemove(key);
    if (key === interruptedKey) throw new Error('simulated process interruption');
  });
  const screen = renderJourney('/welcome/signin?returnTo=payment');
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  await act(async () => { fireEvent.press(screen.getByTestId('signup-dev')); });
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(originalRemove);
  expect(await AsyncStorage.getItem('@fitsy/purchasedContinuation')).not.toBeNull();
  screen.unmount();
  const restarted = renderJourney('/');
  await waitFor(() => expect(restarted.getPathname()).toBe('/restaurant/varilla'));
  expect(restarted.getByText(JSON.stringify({ id: 'varilla', selectedItemId: 'meal-1' }))).toBeTruthy();
  },
);

it('restores an active account\'s selected meal after first-time sign-in and macro setup restart', async () => {
  await rememberPaywallIntent(selected);
  await rememberPendingMealClaim();
  await saveOnboardingField('goal', 'lose_fat');
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'signin');
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  global.fetch = jest.fn().mockResolvedValue(response({ active: true, synced: true, verdict: 'active',
    lastRcVerifiedAt: new Date().toISOString(), stale: false, expiresAt: '2030-01-08T12:00:00Z' }));
  const screen = renderJourney('/', { ...routes, 'macro-setup': MacroSetup });
  await waitFor(() => expect(screen.getPathname()).toBe('/macro-setup'));
  await screen.findByTestId('macro-setup-save');
  await act(async () => { fireEvent.press(screen.getByTestId('macro-setup-save')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/restaurant/varilla'));
  expect(screen.getByText(JSON.stringify({ id: 'varilla', selectedItemId: 'meal-1' }))).toBeTruthy();
});

it('keeps checkout through an unknown account verdict and its later retry', async () => {
  await rememberPaywallIntent(selected);
  await rememberPaymentSignInContinuation();
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  global.fetch = jest.fn((url: RequestInfo | URL) => Promise.resolve(String(url).endsWith('/api/auth/login')
    ? response({ token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: false })
    : response({ active: false, synced: false, verdict: 'unknown', stale: true })));
  const screen = renderJourney('/welcome/signin?returnTo=payment');
  await act(async () => { fireEvent.press(screen.getByTestId('signup-dev')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/subscription-check'));
  expect(await hasPaymentSignInContinuation('buyer')).toBe(true);
  expect(await getPaywallIntent()).toEqual(selected);
  screen.unmount();
  installEligibleTrialOffer();
  const restarted = renderJourney('/');
  await waitFor(() => expect(restarted.getPathname()).toBe('/welcome/payment'));
  expect(await hasPaymentSignInContinuation('buyer')).toBe(true);
});

it('restores an authenticated payment checkpoint after a prior decline', async () => {
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  await rememberPaywallIntent(selected);
  await AsyncStorage.setItem('@fitsy/paywallDeclined', '1');
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'payment');
  installEligibleTrialOffer();
  const screen = renderJourney('/');
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(await getPaywallIntent()).toEqual(selected);
});

it('resumes an interrupted signed-in waitlist signup without replaying stale checkout', async () => {
  await rememberPaywallIntent(selected);
  await rememberPaymentSignInContinuation();
  await rememberPendingMealClaim();
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'out-of-area');
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  const screen = renderJourney('/');
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/out-of-area'));
  expect(await hasPaymentSignInContinuation()).toBe(false);
  expect(await hasPendingMealClaim()).toBe(false);
  expect(await getPaywallIntent()).toBeNull();
  expect(screen.queryByText('Payment plans')).toBeNull();
});

it('replays an interrupted active checkout after missing targets are saved', async () => {
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  global.fetch = jest.fn().mockResolvedValue(response({ active: true, synced: true, verdict: 'active',
    lastRcVerifiedAt: new Date().toISOString(), stale: false, expiresAt: '2030-01-08T12:00:00Z' }));
  await saveOnboardingField('goal', 'lose_fat');
  await rememberPaywallIntent(selected);
  await rememberPaymentSignInContinuation();
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'signin');
  const screen = renderJourney('/', { ...routes, 'macro-setup': MacroSetup });
  await waitFor(() => expect(screen.getPathname()).toBe('/macro-setup'));
  expect(await hasPaymentSignInContinuation()).toBe(false);
  await screen.findByTestId('macro-setup-save');
  await act(async () => { fireEvent.press(screen.getByTestId('macro-setup-save')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/restaurant/varilla'));
  expect(screen.getByText(JSON.stringify({ id: 'varilla', selectedItemId: 'meal-1' }))).toBeTruthy();
});

it('opens payment when a selected-meal entitlement becomes never subscribed during macro setup', async () => {
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  global.fetch = jest.fn().mockResolvedValue(response({ active: true, synced: true, verdict: 'active',
    lastRcVerifiedAt: new Date().toISOString(), stale: false, expiresAt: '2030-01-08T12:00:00Z' }));
  await saveOnboardingField('goal', 'lose_fat');
  await rememberPaywallIntent(selected);
  await rememberPaymentSignInContinuation();
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'signin');
  const screen = renderJourney('/', { ...routes, 'macro-setup': MacroSetup });
  await waitFor(() => expect(screen.getPathname()).toBe('/macro-setup'));
  await screen.findByTestId('macro-setup-skip');
  (global.fetch as jest.Mock).mockResolvedValue(response({ active: false, synced: true, verdict: 'never_subscribed',
    lastRcVerifiedAt: new Date().toISOString(), stale: false, expiresAt: null }));
  await act(async () => { fireEvent.press(screen.getByTestId('macro-setup-skip')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(await getPaywallIntent()).toEqual(selected);
  expect(screen.queryByText('Checking subscription')).toBeNull();
});

it('recovers from a stalled account verdict after macro setup without losing the meal', async () => {
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  global.fetch = jest.fn().mockResolvedValue(response({ active: true, synced: true, verdict: 'active',
    lastRcVerifiedAt: new Date().toISOString(), stale: false, expiresAt: '2030-01-08T12:00:00Z' }));
  await saveOnboardingField('goal', 'lose_fat');
  await rememberPaywallIntent(selected);
  await rememberPaymentSignInContinuation();
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'signin');
  const screen = renderJourney('/', { ...routes, 'macro-setup': MacroSetup });
  await waitFor(() => expect(screen.getPathname()).toBe('/macro-setup'));
  await screen.findByTestId('macro-setup-skip');
  global.fetch = jest.fn(() => new Promise<Response>(() => {}));
  await act(async () => { fireEvent.press(screen.getByTestId('macro-setup-skip')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/subscription-check'), { timeout: 5000 });
  expect(global.fetch).toHaveBeenCalled();
  expect(await getPaywallIntent()).toEqual(selected);
});

it.each(['/welcome/signin?returnTo=payment', '/welcome/signin'])('can cancel root checkout sign-in at %s', async route => {
  await rememberPaywallIntent(selected);
  if (route === '/welcome/signin') await rememberPaymentSignInContinuation();
  const screen = renderJourney(route);
  expect(await screen.findByText('Varilla')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/problem'));
  expect(await getPaywallIntent()).toBeNull();
  expect(await hasPaymentSignInContinuation()).toBe(false);
  expect(screen.queryByText('Payment plans')).toBeNull();
  expect(await AsyncStorage.getItem('@fitsy/onboardingStep')).toBeNull();
  screen.unmount();
  const restarted = renderJourney('/');
  await waitFor(() => expect(restarted.getPathname()).toBe('/welcome/problem'));
  expect(restarted.queryByText('Continue with Apple')).toBeNull();
});

it.each([
  ['apple', '/api/auth/apple', true, true], ['apple', '/api/auth/apple', false, true],
  ['google', '/api/auth/google', true, true], ['google', '/api/auth/google', false, true],
  ['dev', '/api/auth/login', true, true], ['dev', '/api/auth/login', false, true],
  ['apple', '/api/auth/apple', true, false], ['google', '/api/auth/google', true, false], ['dev', '/api/auth/login', true, false],
] as const)('continues %s (%s) only when still on sign-in: success=%s, Back=%s', async (provider, path, success, back) => {
  const exchange = deferred<Response>();
  const alert = jest.spyOn(Alert, 'alert');
  (global.fetch as jest.Mock).mockImplementation((url: string) => url.endsWith(path) || url.endsWith('/api/auth/register') ? exchange.promise
    : Promise.resolve(response({ active: false, verdict: 'never_subscribed', status: null, expiresAt: null,
      lastRcVerifiedAt: new Date().toISOString(), stale: false, synced: true })));
  await rememberPaywallIntent(selected);
  const screen = renderJourney('/welcome/preview');
  await act(async () => { fireEvent.press(screen.getByText('Open selected menu')); });
  await act(async () => { fireEvent.press(screen.getByTestId(`signup-${provider}`)); });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining(path), expect.anything()));
  if (back) await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  expect(screen.getPathname()).toBe(back ? '/welcome/preview' : '/welcome/signin');
  await act(async () => { exchange.resolve(success ? response({ token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: true }) : { ...response({ error: 'Offline' }), ok: false }); });
  expect(screen.getPathname()).toBe(back ? '/welcome/preview' : '/welcome/trial');
  expect(await getPaywallIntent()).toEqual(back ? null : selected);
  expect(await getStoredToken()).toBe(success ? 'test-token' : null);
  expect(alert).not.toHaveBeenCalled();
});
