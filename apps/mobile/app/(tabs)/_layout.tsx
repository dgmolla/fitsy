import { useRef } from 'react';
import { View } from 'react-native';
import { Tabs, Redirect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, EDITORIAL, FONTS } from '@/lib/brand';
import { usePurchases } from '@/lib/usePurchases';
import { usePreviewAccess } from '@/lib/usePreviewAccess';
import { useIsReviewer } from '@/lib/reviewAccess';
import { trackTabSwitched, type TabId } from '@/lib/analytics';

export default function TabLayout() {
  // We track tab switches at the layout level so the event fires once per
  // navigation regardless of which screen renders first. The previous tab is
  // null on cold start so PostHog can distinguish "first tab opened after
  // sign-in" from a mid-session switch.
  const lastTabRef = useRef<TabId | null>(null);

  // Subscription hard-wall: the tabbed app is Pro-only. The gate is the
  // SERVER's verdict (`purchases.entitled`; null while boot / sign-in /
  // sign-out is settling it, which is the hold below), the same truth the
  // API uses to lock data (optionalSubscription), so the two cannot disagree
  // for longer than one sync. Local development exercises this same gate.
  // App Review demo accounts (`useIsReviewer`,
  // mirroring the server `DEMO_REVIEW_EMAILS` allowlist) skip the paywall so the
  // reviewer can see the app without a subscription - the API still gates data.
  const purchases = usePurchases();
  const reviewer = useIsReviewer();
  const previewAccess = usePreviewAccess();
  const entitled = purchases.entitled === true || reviewer.isReviewer;
  // `useLocalSearchParams`, not `useGlobalSearchParams` - the latter updates
  // for every navigation anywhere in the app (including this navigator being
  // backgrounded by an unrelated stack push like /restaurant/[id] or
  // /welcome/signin, neither of which carry `preview`), which would zero out
  // `preview` while this layout is merely backgrounded and fire a spurious
  // redirect underneath the screen the user is actually looking at.
  const { preview } = useLocalSearchParams<{ preview?: string }>();

  // Keep the onboarding sample; post-decline browsing requires the explicit
  // live offering experiment. The launch baseline is a hard paywall.
  const allowTeaser = !entitled && preview === '1' && previewAccess.canPreview;
  // A lapsed subscriber can reach the tabs first (cached verdict, or the
  // win-back screen's own entitled redirect) and be bounced by a later
  // server "false": they belong on the win-back screen, not the free-trial
  // paywall, which promises a trial Apple won't grant them twice.
  const unentitledTarget = purchases.isLapsed ? '/welcome/resubscribe' : '/welcome/payment';
  if (purchases.entitled === null || !reviewer.ready || !previewAccess.ready) return null;
  if (!entitled && !allowTeaser) return <Redirect href={unentitledTarget} />;

  function emitTabSwitched(next: TabId) {
    if (lastTabRef.current === next) return;
    trackTabSwitched({ tab: next, from_tab: lastTabRef.current });
    lastTabRef.current = next;
  }

  // Teaser browsing hides the tab bar - Saved/Profile require a real
  // subscription and shouldn't be reachable from an unentitled preview.
  const tabBarStyle = allowTeaser
    ? { display: 'none' as const }
    : {
        backgroundColor: EDITORIAL.cream,
        borderTopWidth: 1,
        borderTopColor: EDITORIAL.border,
        elevation: 0,
        paddingTop: 8,
        height: 80,
      };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle,
        tabBarActiveTintColor: EDITORIAL.green,
        tabBarInactiveTintColor: EDITORIAL.textSoft,
        tabBarLabelStyle: {
          fontFamily: FONTS.nunitoSansSemiBold,
          fontSize: 10,
          fontWeight: '600',
          marginTop: 4,
        },
      }}
    >
      <Tabs.Screen
        name="saved"
        options={{
          title: 'SAVED',
          tabBarIcon: ({ color, focused }: { color: string; size: number; focused: boolean }) => (
            <Ionicons name={focused ? 'bookmark' : 'bookmark-outline'} size={22} color={color} />
          ),
        }}
        listeners={{ tabPress: () => emitTabSwitched('saved') }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: '',
          tabBarIcon: () => (
            <View style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: EDITORIAL.green,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
              shadowColor: EDITORIAL.green,
              shadowOpacity: 0.25,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 3 },
              elevation: 6,
            }}>
              <Ionicons name="search" size={24} color={COLORS.white} />
            </View>
          ),
        }}
        listeners={{ tabPress: () => emitTabSwitched('search') }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'PROFILE',
          tabBarIcon: ({ color, focused }: { color: string; size: number; focused: boolean }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={22} color={color} />
          ),
        }}
        listeners={{ tabPress: () => emitTabSwitched('profile') }}
      />
    </Tabs>
  );
}
