import { Redirect, useLocalSearchParams } from 'expo-router';

/** Keep old links usable without asking for a rating during onboarding. */
export default function LeaveReviewScreen() {
  const { outOfArea } = useLocalSearchParams<{ outOfArea?: string }>();
  return <Redirect href={outOfArea === '1' ? '/welcome/out-of-area' : '/welcome/notification-permission'} />;
}
