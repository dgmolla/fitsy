import { Redirect } from 'expo-router';

// Older saved links skip the retired middle payoff screen.
export default function LegacyValuePayoffScreen() {
  return <Redirect href="/welcome/goal-payoff" />;
}
