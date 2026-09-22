import { Redirect } from 'expo-router';

// Preserve old checkpoints without replaying the retired benefits interstitial.
export default function LegacyAbundanceScreen() {
  return <Redirect href="/welcome/value-payoff" />;
}
