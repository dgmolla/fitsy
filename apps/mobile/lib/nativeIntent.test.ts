import { redirectSystemPath } from './nativeIntent';

it.each([
  'com.fitsy.mobile://search?preview=1',
  'com.fitsy.mobile://(tabs)/search?preview=1',
  '/search?preview=1',
  '/(tabs)/search?preview=1',
])('recovers the legacy onboarding preview link %s', path => {
  expect(redirectSystemPath({ path, initial: true })).toBe('/welcome/preview');
  expect(redirectSystemPath({ path, initial: false })).toBe('/welcome/preview');
});
it.each(['com.fitsy.mobile://auth/callback?code=example', '/search?query=pizza', '/search?preview=0', '/welcome/payment', 'not a URL'])('preserves unrelated navigation %s', path => {
  expect(redirectSystemPath({ path, initial: false })).toBe(path);
});

it.each([
  'fitsy:///widget',
  'com.fitsy.mobile://widget',
  'com.fitsy.mobile:///widget',
  '/widget',
])('sends a tap on an empty Home Screen widget (%s) to Discovery, not widget setup (#1006)', path => {
  expect(redirectSystemPath({ path, initial: true })).toBe('/(tabs)/search');
  expect(redirectSystemPath({ path, initial: false })).toBe('/(tabs)/search');
});
it.each(['fitsy:///widget?upgrade=1', 'com.fitsy.mobile://widget?upgrade=1', '/widget?upgrade=1'])(
  'keeps the locked widget hand-off to the paywall (%s)', path => {
    expect(redirectSystemPath({ path, initial: false })).toBe(path);
  });
it.each(['fitsy:///restaurant/spot-1?dish=dish-1', 'com.fitsy.mobile://restaurant/spot-1', '/widgets', '/welcome/widget'])(
  'leaves widget dish links and other widget-named routes alone (%s)', path => {
    expect(redirectSystemPath({ path, initial: false })).toBe(path);
  });
