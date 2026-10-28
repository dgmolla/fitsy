import { act, deferred, fireEvent, mockState, renderJourney, response, routes, waitFor, withAccountProfile } from './OnboardingNavigationHarness';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Purchases, { type CustomerInfo } from 'react-native-purchases';
import SubscriptionCheck from '../app/welcome/subscription-check';

// Real screens, router, provider and API client; only native/HTTP boundaries are synthetic.
const empty = { entitlements: { active: {}, all: {} } } as CustomerInfo;
const recoveryRoutes = { ...routes, 'welcome/subscription-check': SubscriptionCheck };
const offline = 'We could not confirm your subscription just now. Try again when you are connected.';
const server = 'Our servers are having trouble. Try again in a few minutes.';
const rateLimit = 'Too many attempts, try again shortly.';
const failures = [
  { name: '503', message: server, fail: async () => ({ ...response({ error: 'Unavailable' }), ok: false, status: 503 }) },
  { name: 'network', message: offline, fail: async (): Promise<Response> => { throw new TypeError('Network request failed'); } },
  { name: '429', message: rateLimit, fail: async () => ({ ...response({ error: 'Rate limited' }), ok: false, status: 429 }) },
];
const { loadAll } = require('js-yaml') as { loadAll(source: string): unknown[] };
const [, retryCommands] = loadAll(readFileSync(resolve(__dirname, '../e2e/helpers/subscription-check-retry.yaml'), 'utf8')) as [unknown, {
  assertVisible?: string | { id: string };
  tapOn?: { id: string };
}[]];

beforeEach(() => {
  mockState.session = { access_token: 'test-token', user: { id: 'buyer' } };
  jest.spyOn(Purchases, 'getAppUserID').mockResolvedValue('buyer');
  jest.spyOn(Purchases, 'logIn').mockResolvedValue({ customerInfo: empty, created: false });
  jest.spyOn(Purchases, 'getCustomerInfo').mockResolvedValue(empty);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

it.each(failures)('shows distinct $name copy at boot and retries failed /sync before recovering', async ({ message, fail }) => {
  const retry = deferred<void>();
  let attempts = 0;
  global.fetch = jest.fn(withAccountProfile(async url => {
    if (url.endsWith('/api/subscriptions/status')) return fail();
    if (url.endsWith('/api/subscriptions/sync')) {
      if (++attempts === 1) { await retry.promise; return fail(); }
      return response({ active: false, status: null, verdict: 'never_subscribed', expiresAt: null,
        synced: true, stale: false, lastRcVerifiedAt: new Date().toISOString() });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  const screen = renderJourney('/', recoveryRoutes);
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/subscription-check'));
  expect(screen.getByText(message)).toBeTruthy();
  for (const other of [offline, server, rateLimit].filter(copy => copy !== message)) {
    expect(screen.queryByText(other)).toBeNull();
  }
  for (const command of retryCommands) {
    if (command.assertVisible) {
      const target = command.assertVisible;
      if (typeof target === 'string') expect(screen.getByText(target.replace('${SUBSCRIPTION_ERROR_COPY}', message))).toBeTruthy();
      else expect(screen.getByTestId(target.id)).toBeTruthy();
    }
    if (command.tapOn) {
      await act(async () => { fireEvent.press(screen.getByTestId(command.tapOn!.id)); });
      expect(screen.getByText('Checking...')).toBeTruthy();
      expect(screen.getByTestId(command.tapOn.id).props.accessibilityState).toMatchObject({ disabled: true, busy: true });
      await act(async () => { fireEvent.press(screen.getByTestId(command.tapOn!.id)); });
      expect(attempts).toBe(1);
      await act(async () => { retry.resolve(); });
      await waitFor(() => expect(screen.getByText('Try again')).toBeTruthy());
    }
  }
  expect(attempts).toBe(1);
  expect(screen.getByText(message)).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('subscription-check-retry')); });
  await waitFor(() => expect(screen.getPathname()).not.toBe('/welcome/subscription-check'));
  expect(attempts).toBe(2);
  expect(screen.queryByText('Checking your subscription')).toBeNull();
});

it.each([500, 502, 599])('shows server copy for other HTTP %s responses without a JSON body', async status => {
  global.fetch = jest.fn(withAccountProfile(async () => ({ ok: false, status,
    json: async () => { throw new SyntaxError('HTML error page'); } } as unknown as Response)));
  const screen = renderJourney('/', recoveryRoutes);
  await waitFor(() => expect(screen.getByText(server)).toBeTruthy());
  expect(screen.queryByText(offline)).toBeNull();
});

it.each([
  { name: 'unresolved verdict', result: response({ verdict: 'unknown', stale: true }) },
  { name: 'malformed verdict', result: response({ active: false }) },
  { name: 'other HTTP error', result: { ...response({ error: 'Bad request' }), ok: false, status: 400 } },
])('keeps $name recovery neutral instead of blaming the connection', async ({ result }) => {
  global.fetch = jest.fn(withAccountProfile(async () => result));
  const screen = renderJourney('/', recoveryRoutes);
  await waitFor(() => expect(screen.getByText('We could not confirm your subscription just now. Please try again.')).toBeTruthy());
  expect(screen.queryByText(offline)).toBeNull();
});

it('updates the cause on each unsuccessful retry instead of keeping the initial connection message', async () => {
  let attempts = 0;
  global.fetch = jest.fn(withAccountProfile(async url => {
    if (url.endsWith('/api/subscriptions/status')) return failures[1].fail();
    return failures[attempts++ % failures.length].fail();
  }));
  const screen = renderJourney('/', recoveryRoutes);
  await waitFor(() => expect(screen.getByText(offline)).toBeTruthy());
  for (const failure of failures) {
    await act(async () => { fireEvent.press(screen.getByTestId('subscription-check-retry')); });
    await waitFor(() => expect(screen.getByText(failure.message)).toBeTruthy());
    expect(screen.getPathname()).toBe('/welcome/subscription-check');
    expect(screen.getByText('Try again')).toBeTruthy();
  }
});
