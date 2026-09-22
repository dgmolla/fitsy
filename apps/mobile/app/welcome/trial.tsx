import { Redirect } from 'expo-router';

// Old bookmarks and interrupted onboarding continue directly to the live plans.
export default function LegacyTrialScreen() {
  return <Redirect href="/welcome/payment" />;
}
