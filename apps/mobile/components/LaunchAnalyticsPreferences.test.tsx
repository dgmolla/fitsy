import { Alert, act, fireEvent, installPurchasedAccount, mockState, renderJourney, response,
  routes, waitFor } from './OnboardingNavigationHarness';
import PostHog from 'posthog-react-native';
import Profile from '../app/(tabs)/profile';
import { useAuthAnalytics } from '../lib/useAuthAnalytics';
import { __resetForTesting } from '../lib/analytics';
import { saveLaunchPreference } from '../lib/launchAnalyticsPreferences';

const identify = jest.fn();
beforeEach(async () => {
  await installPurchasedAccount();
  __resetForTesting(); identify.mockClear();
  jest.mocked(PostHog).mockImplementation(() => ({ identify, capture() {}, reset() {}, reloadFeatureFlags() {} }) as unknown as PostHog);
});
function open() {
  const Root = routes._layout;
  function AnalyticsLayout() { useAuthAnalytics(); return <Root />; }
  const routeMap = { ...routes,
    _layout: AnalyticsLayout, '(tabs)/profile': () => <Profile />,
  };
  return renderJourney('/profile', routeMap);
}

test('Profile opt-in, revocation and test exclusion reach auth storage and the analytics identity listener', async () => {
  const original = global.fetch;
  const put = jest.fn();
  global.fetch = jest.fn(async (input, init) => {
    if (new URL(String(input)).pathname !== '/auth/v1/user') return original(input, init);
    const data = JSON.parse(String(init?.body)).data;
    put(data);
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    mockState.session!.user.user_metadata = { ...mockState.session!.user.user_metadata, ...data };
    return response(mockState.session!.user);
  });
  const screen = open();
  await waitFor(() => expect(screen.getByTestId('la-analytics-consent').props.disabled).toBe(false));
  expect(screen.getByTestId('la-analytics-consent').props.value).toBe(false);
  await act(async () => { fireEvent(screen.getByTestId('la-analytics-consent'), 'valueChange', true); });
  await waitFor(() => expect(screen.getByTestId('la-analytics-consent').props.value).toBe(true));
  expect(put).toHaveBeenLastCalledWith({ fitsy_la_cohort_consent_v1: true });
  expect(identify).toHaveBeenLastCalledWith('buyer', expect.objectContaining({ la_cohort: true }));
  await act(async () => { fireEvent(screen.getByTestId('la-analytics-consent'), 'valueChange', false); });
  await waitFor(() => expect(screen.getByTestId('la-analytics-consent').props.value).toBe(false));
  expect(identify).toHaveBeenLastCalledWith('buyer', expect.objectContaining({ la_cohort: false }));
  const alert = jest.spyOn(Alert, 'alert');
  await act(async () => { fireEvent.press(screen.getByTestId('analytics-exclude-account')); });
  const accept = alert.mock.calls.at(-1)?.[2]?.find(button => button.text === 'Exclude account');
  await act(async () => { accept?.onPress?.(); });
  await screen.findByText('Test account excluded from launch counts');
  expect(put).toHaveBeenLastCalledWith({ fitsy_internal_or_test: true });
  screen.unmount();
  const reopened = open();
  await reopened.findByText('Test account excluded from launch counts');
  expect(reopened.getByTestId('la-analytics-consent').props.value).toBe(false);
});

test('a failed preference write leaves LA consent off and exposes recovery', async () => {
  const original = global.fetch;
  global.fetch = jest.fn(async (input, init) => new URL(String(input)).pathname === '/auth/v1/user'
    ? { ...response({}), ok: false, status: 503 } : original(input, init));
  const screen = open();
  await waitFor(() => expect(screen.getByTestId('la-analytics-consent').props.disabled).toBe(false));
  await act(async () => { fireEvent(screen.getByTestId('la-analytics-consent'), 'valueChange', true); });
  await screen.findByText('Could not save your choice. Please try again.');
  expect(screen.getByTestId('la-analytics-consent').props.value).toBe(false);
  expect(identify).not.toHaveBeenCalled();
});

test('a pending write keeps its original bearer identity and cannot retarget a new account', async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const request = jest.fn(async () => { await pending; return response({ id: 'buyer' }); });
  global.fetch = request;
  const saved = saveLaunchPreference('buyer', 'fitsy_la_cohort_consent_v1', true);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  mockState.session = { access_token: 'second-token', user: { id: 'second' } };
  finish();
  await expect(saved).rejects.toThrow('Account changed');
  expect(jest.mocked(global.fetch).mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
  expect(mockState.session.user.user_metadata).toBeUndefined();
  await expect(saveLaunchPreference('second', 'fitsy_internal_or_test', false)).rejects.toThrow('permanent');
});
