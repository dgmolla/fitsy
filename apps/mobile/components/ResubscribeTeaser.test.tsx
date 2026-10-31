import { withAccountProfile, mockState, response, deferred, routes, renderJourney, router, act, fireEvent, waitFor, PurchasesHooks, saveMacroTargets } from './OnboardingNavigationHarness';
import { Button, Image } from 'react-native';
import Purchases, { type CustomerInfo } from 'react-native-purchases';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Resubscribe from '../app/welcome/resubscribe';
import { RESUBSCRIBE_SAMPLE_IMAGE } from '../lib/resubscribeSample';
import { setCachedCoords } from '../lib/locationCache';
import { readDiscoverySignIn } from '../lib/discoverySignIn';

function expiredStatus() {
  return { active: false, status: 'expired', verdict: 'expired', expiresAt: null,
    lastRcVerifiedAt: new Date().toISOString(), stale: false, synced: true };
}
const resubscribeRoutes = { ...routes, 'welcome/resubscribe': () => <Resubscribe /> };

// Keep the real provider and its account-bound RevenueCat re-check running.
// The no-fetch assertion starts when that existing boot work has settled.
function Ready() {
  const { ready } = PurchasesHooks.usePurchases();
  return ready ? <Button title="Open expired plans" onPress={() => router.replace('/welcome/resubscribe')} /> : null;
}

it.each([false, true])('renders the bundled search card without fetch (saved area and targets: %s)', async savedArea => {
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  if (savedArea) {
    await setCachedCoords({ lat: 34.05, lng: -118.25 });
    await saveMacroTargets({ calories: '600', protein: '40', carbs: '50', fat: '20' });
  }
  global.fetch = jest.fn(withAccountProfile(async () => response(expiredStatus())));
  const readyRoutes = { ...resubscribeRoutes, ready: Ready };
  const screen = renderJourney('/ready', readyRoutes);
  await screen.findByText('Open expired plans');
  await act(async () => {});
  const fetch = jest.mocked(global.fetch);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/subscriptions/'), expect.anything());
  fetch.mockClear();
  fetch.mockRejectedValue(new Error('offline'));

  await act(async () => { fireEvent.press(screen.getByText('Open expired plans')); });
  await screen.findByTestId('resubscribe-restore');

  expect(screen.getByText('Sample meal')).toBeTruthy();
  expect(screen.getByText('Chick-fil-A')).toBeTruthy();
  expect(screen.getByText('8 ct Grilled Nuggets')).toBeTruthy();
  for (const macro of ['P 25g', 'C 1g', 'F 3g', '130 kcal']) expect(screen.getByText(macro)).toBeTruthy();
  expect(screen.getByText('Published nutrition · high confidence')).toBeTruthy();
  expect(screen.queryByText(/\d+\.\d mi|% fit/)).toBeNull();
  expect(screen.getByText('Find meals that fit again')).toBeTruthy();
  expect(screen.getByLabelText('Photo of Chick-fil-A').props.source).toEqual(RESUBSCRIBE_SAMPLE_IMAGE);
  expect(screen.getByLabelText('Photo of Chick-fil-A').props.source).not.toEqual(expect.objectContaining({ uri: expect.any(String) }));
  expect(screen.getByTestId('paywall-search-item-card').props.accessibilityRole).toBe('text');

  await act(async () => { fireEvent.press(screen.getByTestId('paywall-search-item-card')); });
  expect(screen.getPathname()).toBe('/welcome/resubscribe');
  // A decode failure must stay local too, without a remote image fallback.
  fireEvent(screen.getByLabelText('Photo of Chick-fil-A'), 'error');
  expect(screen.getByLabelText('Photo unavailable for Chick-fil-A')).toBeTruthy();
  for (const image of screen.UNSAFE_queryAllByType(Image)) {
    expect(image.props.source).not.toEqual(expect.objectContaining({ uri: expect.stringMatching(/^https?:/) }));
  }
  await act(async () => {});
  expect(fetch).not.toHaveBeenCalled();
});

it('returns through the saved Maestro sign-in continuation with no restaurant requests', async () => {
  const { loadAll } = require('js-yaml') as { loadAll(source: string): unknown[] };
  const [, commands] = loadAll(readFileSync(resolve(__dirname, '../e2e/flows/subscription-expired-routing.yaml'), 'utf8')) as [unknown, {
    openLink?: string; runFlow?: { file: string; env: { DESTINATION: string } };
  }[]];
  const continuation = commands.find(step => step.openLink?.includes('/signin?returnTo=resubscribe'))!.openLink!;
  const signin = commands.find(step => step.runFlow?.file === '../helpers/discovery-signin.yaml')!.runFlow!;
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  global.fetch = jest.fn(withAccountProfile(async url => response(url.endsWith('/api/auth/login')
    ? { token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: false }
    : expiredStatus())));
  const screen = renderJourney('/welcome/resubscribe', resubscribeRoutes);
  await screen.findByTestId('resubscribe-restore');

  await act(async () => { router.push(continuation.replace('com.fitsy.mobile://', '/') as never); });
  await screen.findByTestId('signup-dev');
  await act(async () => { fireEvent.press(screen.getByTestId('signup-dev')); });
  await screen.findByTestId(signin.env.DESTINATION);

  expect(screen.getPathname()).toBe('/welcome/resubscribe');
  expect(screen.getByText('8 ct Grilled Nuggets')).toBeTruthy();
  expect(mockState.session?.user.id).toBe('buyer');
  expect(await readDiscoverySignIn()).toBeNull();
  expect(jest.mocked(global.fetch).mock.calls.some(([url]) => String(url).includes('/api/restaurants'))).toBe(false);
});

it('waits for account identity before displaying the static sample', async () => {
  const session = { access_token: 'test-token', user: { id: 'buyer' } };
  const identity = deferred<{ data: { session: typeof session } }>();
  mockState.session = session;
  mockState.sessionRead = () => identity.promise;
  global.fetch = jest.fn(withAccountProfile(async () => response(expiredStatus())));
  const screen = renderJourney('/welcome/resubscribe', resubscribeRoutes);
  await act(async () => {});
  expect(screen.queryByText('Chick-fil-A')).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();

  await act(async () => { identity.resolve({ data: { session } }); });

  expect(await screen.findByText('8 ct Grilled Nuggets')).toBeTruthy();
  expect(screen.getByTestId('resubscribe-restore')).toBeTruthy();
  expect(jest.mocked(global.fetch).mock.calls.some(([url]) => String(url).includes('/api/restaurants'))).toBe(false);
});

it('keeps anonymous win-back sign-in without fetching or showing the sample', async () => {
  await setCachedCoords({ lat: 34.05, lng: -118.25 });
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  const screen = renderJourney('/welcome/resubscribe', resubscribeRoutes);

  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/signin'));
  await act(async () => {});

  expect(await readDiscoverySignIn()).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.queryByText('Chick-fil-A')).toBeNull();
  expect(screen.getByTestId('signup-dev')).toBeTruthy();
});

it('re-checks a RevenueCat sandbox renewal in production mode and leaves expired plans', async () => {
  const dev = Object.getOwnPropertyDescriptor(globalThis, '__DEV__')!;
  const nodeEnv = process.env.NODE_ENV;
  Object.defineProperty(globalThis, '__DEV__', { value: false, configurable: true });
  process.env.NODE_ENV = 'production';
  try {
    mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
    await saveMacroTargets({ calories: '600', protein: '40', carbs: '50', fat: '20' });
    const expired = { entitlements: { active: {}, all: { pro: { isActive: false, isSandbox: true } } } } as unknown as CustomerInfo;
    const pro = { isActive: true, isSandbox: true, expirationDate: '2030-01-08T12:00:00Z', periodType: 'NORMAL', willRenew: true };
    const active = { entitlements: { active: { pro }, all: { pro } } } as unknown as CustomerInfo;
    let listener: ((info: CustomerInfo) => void) | undefined;
    jest.spyOn(Purchases, 'addCustomerInfoUpdateListener').mockImplementation(callback => { listener = callback; });
    jest.spyOn(Purchases, 'getAppUserID').mockResolvedValue('buyer');
    jest.spyOn(Purchases, 'isAnonymous').mockResolvedValue(false);
    jest.spyOn(Purchases, 'logIn').mockResolvedValue({ customerInfo: expired, created: false });
    const reread = jest.spyOn(Purchases, 'getCustomerInfo').mockResolvedValue(expired);
    const renewed = deferred<Response>();
    global.fetch = jest.fn(withAccountProfile(async url => url.endsWith('/api/subscriptions/sync')
      ? renewed.promise : response(expiredStatus())));
    const screen = renderJourney('/welcome/resubscribe', resubscribeRoutes);
    await screen.findByTestId('resubscribe-restore');
    const initialReads = reread.mock.calls.length;
    reread.mockResolvedValue(active);

    await act(async () => { listener!(active); });
    await waitFor(() => expect(reread).toHaveBeenCalledTimes(initialReads + 1));
    expect(screen.getByText('Welcome back.')).toBeTruthy();
    await act(async () => { renewed.resolve(response({ active: true, status: 'active', verdict: 'active', synced: true,
      lastRcVerifiedAt: new Date().toISOString(), stale: false, expiresAt: pro.expirationDate })); });

    await waitFor(() => expect(screen.getPathname()).toBe('/search'));
    expect(screen.queryByText('Welcome back.')).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/subscriptions/sync'), expect.objectContaining({
      body: JSON.stringify({ reason: 'mismatch' }),
    }));
    expect(jest.mocked(global.fetch).mock.calls.some(([url]) => String(url).includes('/api/restaurants'))).toBe(false);
  } finally {
    Object.defineProperty(globalThis, '__DEV__', dev);
    process.env.NODE_ENV = nodeEnv;
  }
});
