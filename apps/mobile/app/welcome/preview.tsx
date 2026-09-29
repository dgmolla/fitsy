import React, { useEffect } from 'react';
import { router } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { DiscoveryScreen } from '@/components/DiscoveryScreen';
import { usePreviewAccess } from '@/lib/usePreviewAccess';
import { usePurchases } from '@/lib/usePurchases';
import { routeToPaywall } from '@/lib/teaserGate';

export default function PreviewScreen() {
  const access = usePreviewAccess();
  const { entitled } = usePurchases();
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused || !access.ready || entitled === null) return;
    if (entitled) router.replace('/(tabs)/search');
    else if (!access.canPreview) void routeToPaywall({ replace: true });
  }, [focused, access.ready, access.canPreview, entitled]);
  if (!access.ready || !access.canPreview || entitled) return null;
  return <DiscoveryScreen onboardingPreview />;
}
