import { Redirect } from 'expo-router';

// Compatibility for old onboarding links. The opening now fits on one screen.
export default function LegacyOnboardingScreen() {
  return <Redirect href="/welcome/location-permission" />;
}
