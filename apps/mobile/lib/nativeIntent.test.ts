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
