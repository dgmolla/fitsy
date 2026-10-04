import { mockState, selected, response, deferred, routes, renderJourney, AsyncStorage, router, act, fireEvent, waitFor, MacroSetup, getPaywallIntent, rememberPaywallIntent, saveMacroTargets, saveOnboardingField, hasPaymentSignInContinuation, rememberPaymentSignInContinuation } from './OnboardingNavigationHarness';
import Resubscribe from '../app/welcome/resubscribe';

it('does not render an anonymous resubscribe deep link before sign-in', async () => {
  const screen = renderJourney('/welcome/resubscribe', { ...routes, 'welcome/resubscribe': () => <Resubscribe /> });
  expect(screen.queryByText('Welcome back.')).toBeNull();
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/signin'));
  expect(screen.queryByText('Welcome back.')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/problem'));
  expect(screen.queryByText('Welcome back.')).toBeNull();
});

it('sends an already signed-in never-subscribed deep link to the first-time plan', async () => {
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  global.fetch = jest.fn().mockResolvedValue(response({ active: false, status: null, verdict: 'never_subscribed',
    expiresAt: null, lastRcVerifiedAt: new Date().toISOString(), stale: false, synced: true }));
  const screen = renderJourney('/welcome/resubscribe', { ...routes, 'welcome/resubscribe': () => <Resubscribe /> });
  expect(screen.queryByText('Welcome back.')).toBeNull();
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(screen.queryByText('Welcome back.')).toBeNull();
});

it('routes an ordinary locked-meal sign-in for a lapsed account to resubscribe with its meal', async () => {
  await rememberPaywallIntent(selected);
  global.fetch = jest.fn((url: RequestInfo | URL) => Promise.resolve(String(url).endsWith('/api/auth/login')
    ? response({ token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: false })
    : response({ active: false, status: 'expired', verdict: 'expired', expiresAt: null,
      lastRcVerifiedAt: new Date().toISOString(), stale: false, synced: true })));
  const screen = renderJourney('/welcome/signin');
  expect(await screen.findByText('Varilla')).toBeTruthy();
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  await act(async () => { fireEvent.press(screen.getByTestId('signup-dev')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/resubscribe'));
  expect(await getPaywallIntent()).toEqual(selected);
  expect(screen.queryByText('Trial introduction')).toBeNull();
});

it.each([
  ['never_subscribed', '/welcome/payment'],
  ['expired', '/welcome/resubscribe'],
  ['active', '/search'],
] as const)('settles a resubscribe deep link after sign-in for %s', async (verdict, destination) => {
  await saveMacroTargets({ calories: '600', protein: '40', carbs: '50', fat: '20' });
  global.fetch = jest.fn((url: RequestInfo | URL) => Promise.resolve(String(url).endsWith('/api/auth/login')
    ? response({ token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: false })
    : response({ active: verdict === 'active', status: verdict === 'expired' ? 'expired' : null,
      verdict, expiresAt: null, lastRcVerifiedAt: new Date().toISOString(), stale: false, synced: true })));
  const screen = renderJourney('/welcome/resubscribe', { ...routes, 'welcome/resubscribe': () => <Resubscribe /> });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/signin'));
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  await act(async () => { fireEvent.press(screen.getByTestId('signup-dev')); });
  await waitFor(() => expect(screen.getPathname()).toBe(destination));
  if (verdict === 'never_subscribed') expect(screen.queryByText('Resubscribe plans')).toBeNull();
});

it.each([
  ['never_subscribed', '/welcome/payment'],
  ['expired', '/welcome/resubscribe'],
  ['active', '/restaurant/varilla'],
] as const)('continues anonymous checkout after sign-in using the account verdict: %s', async (verdict, destination) => {
  await rememberPaywallIntent(selected);
  await saveMacroTargets({ calories: '600', protein: '40', carbs: '50', fat: '20' });
  global.fetch = jest.fn((url: RequestInfo | URL) => Promise.resolve(
    String(url).endsWith('/api/auth/login')
      ? response({ token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: false })
      : response({ active: verdict === 'active', status: verdict === 'expired' ? 'expired' : null,
        verdict, expiresAt: null, lastRcVerifiedAt: new Date().toISOString(), stale: false, synced: true }),
  ));
  const screen = renderJourney('/welcome/signin?returnTo=payment');
  expect(await screen.findByText('Varilla')).toBeTruthy();
  expect(screen.queryByText('Payment plans')).toBeNull();
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  await act(async () => { fireEvent.press(screen.getByTestId('signup-dev')); });
  await waitFor(() => expect(screen.getPathname()).toBe(destination));
  if (verdict === 'never_subscribed') expect(await getPaywallIntent()).toEqual(selected);
  if (verdict === 'active') expect(screen.getByText(JSON.stringify({ id: 'varilla', selectedItemId: 'meal-1' }))).toBeTruthy();
});

it('does not transfer account A checkout to account B after an interrupted sign-out', async () => {
  await rememberPaywallIntent(selected);
  await AsyncStorage.setItem('@fitsy/paymentSignInContinuation', 'user:account-a');
  global.fetch = jest.fn((url: RequestInfo | URL) => Promise.resolve(String(url).endsWith('/api/auth/login')
    ? response({ token: 'test-token', refreshToken: 'refresh', user: { id: 'account-b' }, isNewUser: false })
    : response({ active: false, synced: true, verdict: 'never_subscribed', status: null,
      lastRcVerifiedAt: new Date().toISOString(), stale: false, expiresAt: null })));
  const screen = renderJourney('/welcome/signin?returnTo=payment');
  mockState.session = { access_token: 'test-token', user: { id: 'account-b' } };
  await act(async () => { fireEvent.press(screen.getByTestId('signup-dev')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/trial'));
  expect(screen.queryByText('Payment plans')).toBeNull();
  expect(await hasPaymentSignInContinuation()).toBe(false);
  expect(await getPaywallIntent()).toBeNull();
});

it('keeps Back cancellation when an active-account continuation finishes a delayed write', async () => {
  await rememberPaywallIntent(selected);
  await saveMacroTargets({ calories: '600', protein: '40', carbs: '50', fat: '20' });
  const pendingWrite = deferred<void>();
  const originalSet = (AsyncStorage.setItem as jest.Mock).getMockImplementation() as typeof AsyncStorage.setItem;
  let writingPurchased = false;
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
    if (key === '@fitsy/purchasedContinuation' && !writingPurchased) {
      writingPurchased = true;
      await pendingWrite.promise;
    }
    return originalSet(key, value);
  });
  global.fetch = jest.fn((url: RequestInfo | URL) => Promise.resolve(String(url).endsWith('/api/auth/login')
    ? response({ token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: false })
    : response({ active: true, synced: true, verdict: 'active', expiresAt: '2030-01-08T12:00:00Z',
      lastRcVerifiedAt: new Date().toISOString(), stale: false })));
  const screen = renderJourney('/welcome/signin?returnTo=payment');
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  act(() => { fireEvent.press(screen.getByTestId('signup-dev')); });
  await waitFor(() => expect(writingPurchased).toBe(true));
  act(() => { fireEvent.press(screen.getByTestId('welcome-back')); });
  await act(async () => { pendingWrite.resolve(); await pendingWrite.promise; });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/problem'));
  expect(screen.queryByText('Payment plans')).toBeNull();
  expect(await getPaywallIntent()).toBeNull();
});

it.each(['save', 'skip'] as const)('opens the selected meal after an active subscriber %ss missing macro targets', async action => {
  await saveOnboardingField('goal', 'lose_fat');
  await rememberPaywallIntent(selected);
  global.fetch = jest.fn((url: RequestInfo | URL) => Promise.resolve(String(url).endsWith('/api/auth/login')
    ? response({ token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: false })
    : response({ active: true, synced: true, verdict: 'active', expiresAt: '2030-01-08T12:00:00Z',
      lastRcVerifiedAt: new Date().toISOString(), stale: false })));
  const screen = renderJourney('/welcome/signin?returnTo=payment', { ...routes, 'macro-setup': MacroSetup });
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  await act(async () => { fireEvent.press(screen.getByTestId('signup-dev')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/macro-setup'));
  await screen.findByTestId(`macro-setup-${action}`);
  await act(async () => { fireEvent.press(screen.getByTestId(`macro-setup-${action}`)); });
  await waitFor(() => expect(screen.getPathname()).toBe('/restaurant/varilla'));
  expect(screen.getByText(JSON.stringify({ id: 'varilla', selectedItemId: 'meal-1' }))).toBeTruthy();
});

it('cancels an anonymous checkout without exposing its paywall, then permits a clean retry', async () => {
  await rememberPaywallIntent(selected);
  const screen = renderJourney('/welcome/preview');
  await act(async () => { router.push('/welcome/signin?returnTo=payment'); });
  expect(await screen.findByText('Varilla')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/problem'));
  expect(screen.queryByText('Payment plans')).toBeNull();
  expect(await getPaywallIntent()).toBeNull();
  await act(async () => { router.push('/welcome/signin?returnTo=payment'); });
  global.fetch = jest.fn((url: RequestInfo | URL) => Promise.resolve(String(url).endsWith('/api/auth/login')
    ? { ...response({ error: 'Offline' }), ok: false }
    : response({ active: false, verdict: 'never_subscribed', status: null, expiresAt: null,
      lastRcVerifiedAt: new Date().toISOString(), stale: false, synced: true })));
  await act(async () => { fireEvent.press(screen.getByTestId('signup-dev')); });
  expect(screen.getPathname()).toBe('/welcome/signin');
  expect(screen.queryByText('Payment plans')).toBeNull();
  (global.fetch as jest.Mock).mockImplementation((url: string) => Promise.resolve(url.endsWith('/api/auth/login')
    ? response({ token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: false })
    : response({ active: false, verdict: 'never_subscribed', status: null, expiresAt: null,
      lastRcVerifiedAt: new Date().toISOString(), stale: false, synced: true })));
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  await act(async () => { fireEvent.press(screen.getByTestId('signup-dev')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
});

it('uses the durable checkout marker after sign-in query parameters are lost on resume', async () => {
  await rememberPaywallIntent(selected);
  await rememberPaymentSignInContinuation();
  const screen = renderJourney('/welcome/preview');
  await act(async () => { router.push('/welcome/signin'); });
  expect(await screen.findByText('Varilla')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/problem'));
  expect(await hasPaymentSignInContinuation()).toBe(false);
  expect(screen.queryByText('Payment plans')).toBeNull();
});

it('restores an active subscriber\'s owned meal after checkout sign-in is interrupted', async () => {
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  global.fetch = jest.fn().mockResolvedValue(response({ active: true, synced: true, verdict: 'active',
    lastRcVerifiedAt: new Date().toISOString(), stale: false, expiresAt: '2030-01-08T12:00:00Z' }));
  await rememberPaywallIntent(selected);
  await rememberPaymentSignInContinuation();
  await saveMacroTargets({ calories: '600', protein: '40', carbs: '50', fat: '20' });
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'signin');
  const screen = renderJourney('/');
  await waitFor(() => expect(screen.getPathname()).toBe('/restaurant/varilla'));
  expect(screen.getByText(JSON.stringify({ id: 'varilla', selectedItemId: 'meal-1' }))).toBeTruthy();
  expect(await hasPaymentSignInContinuation()).toBe(false);
});
