import { Redirect } from 'expo-router';

// Older links enter the corresponding step of the restored flow.
export default function LegacyOnboardingScreen() {
  return <Redirect href="/welcome/value-abundance" />;
}
