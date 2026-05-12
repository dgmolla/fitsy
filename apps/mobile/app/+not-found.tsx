import { Redirect } from 'expo-router';

/**
 * Expo Router 404 fallback. Any deep link or route that doesn't match a file
 * (e.g. a stray `fitsy:///` from OAuth browser dismissal) bounces back to the
 * root index, which routes the user based on auth + onboarding state.
 *
 * Without this, post-signin redirects can occasionally land on Expo Router's
 * built-in "Unmatched Route" page when the auth flow drops the user at the
 * scheme root.
 */
export default function NotFound() {
  return <Redirect href="/" />;
}
