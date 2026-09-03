import { useRef } from 'react';
import { View } from 'react-native';
import { Tabs, Redirect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, EDITORIAL, FONTS } from '@/lib/brand';
import { usePurchases } from '@/lib/usePurchases';
import { useIsReviewer } from '@/lib/reviewAccess';
import { trackTabSwitched, type TabId } from '@/lib/analytics';

export default function TabLayout() {
  // We track tab switches at the layout level so the event fires once per
  // navigation regardless of which screen renders first. The previous tab is
  // null on cold start so PostHog can distinguish "first tab opened after
  // sign-in" from a mid-session switch.
  const lastTabRef = useRef<TabId | null>(null);

  // Subscription hard-wall: the tabbed app is Pro-only. `isPro` is instant and
  // on-device (a just-purchased user enters immediately), so this is the UX
  // gate; the API independently enforces entitlement server-side
  // (optionalSubscription), which is the real security boundary. `__DEV__`
  // bypasses local development; App Review demo accounts (`useIsReviewer`,
  // mirroring the server `DEMO_REVIEW_EMAILS` allowlist) skip the paywall so the
  // reviewer can see the app without a subscription - the API still gates data.
  const { ready, isPro } = usePurchases();
  const reviewer = useIsReviewer();
  const entitled = isPro || reviewer.isReviewer;
  // `useLocalSearchParams`, not `useGlobalSearchParams` - the latter updates
  // for every navigation anywhere in the app (including this navigator being
  // backgrounded by an unrelated stack push like /restaurant/[id] or
  // /welcome/signin, neither of which carry `preview`), which would zero out
  // `preview` while this layout is merely backgrounded and fire a spurious
  // redirect underneath the screen the user is actually looking at.
  const { preview } = useLocalSearchParams<{ preview?: string }>();

  // Onboarding / lapsed-subscriber / declined-paywall teaser: an unentitled
  // visitor who arrives with `?preview=1` may browse the search tab with
  // server-locked results (`/api/restaurants` `meta.locked`). Entry is never
  // gated on the one-free-look flag (lib/teaserGate) - that flag only decides
  // whether tapping a top-3 row opens a real detail sample or goes straight
  // to the paywall (see search.tsx). Gating entry on it too would bounce a
  // returning visitor to /welcome/payment, whose own "Maybe later" comes
  // right back here: an infinite redirect loop with no way to just browse.
  const allowTeaser = !entitled && preview === '1';
  if (!__DEV__) {
    if (!ready || !reviewer.ready) return null; // hold until entitlement + session resolve, avoids a flash
    if (!entitled && !allowTeaser) return <Redirect href="/welcome/payment" />;
  }

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
