import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { Tabs, Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, EDITORIAL, FONTS } from '@/lib/brand';
import { usePurchases } from '@/lib/usePurchases';
import { useIsReviewer } from '@/lib/reviewAccess';
import { hasUsedPreviewSample } from '@/lib/teaserGate';
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

  // Onboarding + lapsed-subscriber teaser: an unentitled visitor may browse
  // the search tab once with server-locked results (`/api/restaurants`
  // `meta.locked`) as long as they haven't already spent their one free
  // restaurant-detail look (tracked persistently, see lib/teaserGate). Re-read
  // on every focus - not just on mount - so returning here after that sample
  // gets spent (e.g. hardware-back from the paywall) re-locks immediately
  // instead of trusting a stale in-memory value. Skipped entirely for an
  // already-entitled user (the common case) - the flag is structurally
  // irrelevant to them, so there's no reason to hit AsyncStorage every focus.
  const [sampleUsed, setSampleUsed] = useState<boolean | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (entitled) { setSampleUsed(true); return; }
      hasUsedPreviewSample().then(setSampleUsed);
    }, [entitled]),
  );

  const allowTeaser = !entitled && preview === '1' && sampleUsed === false;
  // Single named gate for "still settling" (entitlement/session/teaser-flag
  // reads not yet resolved) vs. the actual admit/deny decision below, so the
  // two questions ("are we ready to decide" and "what did we decide") read as
  // two separate lines instead of one compound boolean expression.
  const isSettling = !ready || !reviewer.ready || sampleUsed === null;

  if (!__DEV__) {
    if (isSettling) return null; // hold while entitlement/session/teaser state settle, avoids a flash
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
