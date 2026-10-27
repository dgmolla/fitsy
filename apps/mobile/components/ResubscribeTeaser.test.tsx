import { withAccountProfile, mockState, response, deferred, routes, renderJourney, router, act, fireEvent, waitFor } from './OnboardingNavigationHarness';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Resubscribe from '../app/welcome/resubscribe';
import { setCachedCoords } from '../lib/locationCache';
import { readDiscoverySignIn } from '../lib/discoverySignIn';

it('returns to win-back through the saved Maestro sign-in continuation despite a late teaser 401', async () => {
  const { loadAll } = require('js-yaml') as { loadAll(source: string): unknown[] };
  const [, commands] = loadAll(readFileSync(resolve(__dirname, '../e2e/flows/subscription-expired-routing.yaml'), 'utf8')) as [unknown, {
    openLink?: string; runFlow?: { file: string; env: { DESTINATION: string } };
  }[]];
  const continuation = commands.find(step => step.openLink?.includes('/signin?returnTo=resubscribe'))!.openLink!;
  const signin = commands.find(step => step.runFlow?.file === '../helpers/discovery-signin.yaml')!.runFlow!;
  await setCachedCoords({ lat: 34.05, lng: -118.25 });
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  const teaser = deferred<Response>();
  let previews = 0;
  global.fetch = jest.fn(withAccountProfile(async url => {
    if (url.includes('/api/restaurants/preview')) return ++previews === 1 ? teaser.promise : response({ data: [] });
    if (url.endsWith('/api/auth/login')) return response({ token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: false });
    return response({ active: false, status: 'expired', verdict: 'expired', expiresAt: null,
      lastRcVerifiedAt: new Date().toISOString(), stale: false, synced: true });
  }));
  const screen = renderJourney('/welcome/resubscribe', { ...routes, 'welcome/resubscribe': () => <Resubscribe /> });
  await screen.findByTestId('resubscribe-restore');
  await waitFor(() => expect(previews).toBe(1));

  await act(async () => { router.push(continuation.replace('com.fitsy.mobile://', '/') as never); });
  await screen.findByTestId('signup-dev');
  await act(async () => { fireEvent.press(screen.getByTestId('signup-dev')); });
  await screen.findByTestId(signin.env.DESTINATION);
  await act(async () => { teaser.resolve({ ...response({ error: 'Unauthorized' }), ok: false, status: 401 }); });

  expect(screen.getPathname()).toBe('/welcome/resubscribe');
  expect(screen.getByText('Welcome back.')).toBeTruthy();
  expect(mockState.session?.user.id).toBe('buyer');
  expect(await readDiscoverySignIn()).toBeNull();
});

it('loads nearby win-back cards only after the account identity settles', async () => {
  await setCachedCoords({ lat: 34.05, lng: -118.25 });
  const session = { access_token: 'preview-token', user: { id: 'preview-account' } };
  const identity = deferred<{ data: { session: typeof session } }>();
  mockState.session = session;
  mockState.sessionRead = () => identity.promise;
  global.fetch = jest.fn(withAccountProfile(async (url: string) => response(url.includes('/api/restaurants/preview')
    ? { data: [{ id: 'nearby-bowl', name: 'Nearby Bowl', cuisineTags: ['healthy'], distanceMiles: 0.5 }] }
    : { active: false, status: 'expired', verdict: 'expired', expiresAt: null,
      lastRcVerifiedAt: new Date().toISOString(), stale: false, synced: true })));
  const screen = renderJourney('/welcome/resubscribe', { ...routes, 'welcome/resubscribe': () => <Resubscribe /> });
  await act(async () => {});
  expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/restaurants/preview'), expect.anything());

  await act(async () => { identity.resolve({ data: { session } }); });

  expect(await screen.findByText('Nearby Bowl')).toBeTruthy();
  expect(screen.getByTestId('resubscribe-restore')).toBeTruthy();
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/restaurants/preview'), expect.objectContaining({
    headers: { Authorization: 'Bearer preview-token' },
  }));
});

it('keeps anonymous win-back sign-in when a saved area could trigger a teaser request', async () => {
  await setCachedCoords({ lat: 34.05, lng: -118.25 });
  global.fetch = jest.fn(withAccountProfile(async () => ({ ...response({ error: 'Unauthorized' }), ok: false, status: 401 })));
  const screen = renderJourney('/welcome/resubscribe', { ...routes, 'welcome/resubscribe': () => <Resubscribe /> });

  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/signin'));
  await act(async () => {});

  expect(await readDiscoverySignIn()).toBeNull();
  expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/restaurants/preview'), expect.anything());
  expect(screen.getByTestId('signup-dev')).toBeTruthy();
});

it.each(['blur', 'unmount', 'account-change'] as const)('ignores a delayed win-back teaser 401 after %s', async departure => {
  await setCachedCoords({ lat: 34.05, lng: -118.25 });
  mockState.session = { access_token: 'old-token', user: { id: 'old-account' } };
  const teaser = deferred<Response>();
  let previews = 0;
  global.fetch = jest.fn(withAccountProfile((url: string) => url.includes('/api/restaurants/preview')
    ? ++previews === 1 ? teaser.promise : Promise.resolve(response({ data: [] }))
    : Promise.resolve(response({ active: false, status: 'expired', verdict: 'expired', expiresAt: null,
      lastRcVerifiedAt: new Date().toISOString(), stale: false, synced: true }))));
  const screen = renderJourney('/welcome/resubscribe', { ...routes, 'welcome/resubscribe': () => <Resubscribe /> });
  await screen.findByTestId('resubscribe-restore');
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/restaurants/preview'), expect.anything()));
  const firstRequest = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url).includes('/api/restaurants/preview'));

  if (departure === 'blur') act(() => { router.push('/welcome/signin?returnTo=resubscribe'); });
  if (departure === 'unmount') screen.unmount();
  const nextSession = { access_token: 'new-token', user: { id: 'new-account' } };
  await act(async () => {
    mockState.session = nextSession;
    mockState.authListeners.forEach(listener => listener('SIGNED_IN', nextSession));
  });
  await act(async () => { teaser.resolve({ ...response({ error: 'Unauthorized' }), ok: false, status: 401 }); });

  expect(mockState.session).toEqual(nextSession);
  expect(await readDiscoverySignIn()).toBeNull();
  expect(firstRequest?.[1].signal?.aborted).toBe(true);
  if (departure === 'blur') expect(screen.getPathname()).toBe('/welcome/signin');
});
