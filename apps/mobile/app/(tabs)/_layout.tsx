import { useRef } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs, Redirect, useLocalSearchParams } from 'expo-router';
import { useNavigationState, type NavigationState, type PartialState } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, EDITORIAL, FONTS } from '@/lib/brand';
import { usePurchases } from '@/lib/usePurchases';
import { usePreviewAccess } from '@/lib/usePreviewAccess';
import { useIsReviewer } from '@/lib/reviewAccess';
import { trackTabSwitched, type TabId } from '@/lib/analytics';
import { FloatingTabBar } from '@/components/FloatingTabBar';
import { FloatingNavClearanceContext, floatingTabBarClearance } from '@/lib/floatingNav';
import { useFloatingNavFlag } from '@/lib/useFloatingNavFlag';

function focusedDebugParam(state?: NavigationState | PartialState<NavigationState>): string | undefined {
  const route = state?.routes[state.index ?? 0];
  if (route?.state) return focusedDebugParam(route.state);
  const value = (route?.params as { floatingNavDebug?: unknown } | undefined)?.floatingNavDebug;
  return typeof value === 'string' ? value : undefined;
}

export default function TabLayout() {
  // We track tab switches at the layout level so the event fires once per
  // navigation regardless of which screen renders first. The previous tab is
  // null on cold start so PostHog can distinguish "first tab opened after
  // sign-in" from a mid-session switch.
  const lastTabRef = useRef<TabId | null>(null);
  const insets = useSafeAreaInsets();

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
  // Read only the focused leaf's explicit Debug parameter. Ancestor query
  // params can retain an older selection after a deep link or tab switch.
  const floatingNavDebug = useNavigationState(state => __DEV__ ? focusedDebugParam(state) : undefined);
  const floatingNav = useFloatingNavFlag(floatingNavDebug);

  // Keep the onboarding sample; post-decline browsing requires the explicit
  // live offering experiment. The launch baseline is a hard paywall.
  const allowTeaser = !entitled && preview === '1' && previewAccess.canPreview;
  // A lapsed subscriber can reach the tabs first (cached verdict, or the
  // win-back screen's own entitled redirect) and be bounced by a later
  // server "false": they belong on the win-back screen, not the free-trial
  // paywall, which promises a trial Apple won't grant them twice.
  const unentitledTarget = purchases.isLapsed ? '/welcome/resubscribe' : '/welcome/payment';
  if (!purchases.ready || !reviewer.ready || !previewAccess.ready) return null;
  if (purchases.isUnknown) return <Redirect href="/welcome/subscription-check" />;
  if (purchases.entitled === null) return null;
  if (allowTeaser) return <Redirect href="/welcome/preview" />;
  if (!entitled && !allowTeaser) return <Redirect href={unentitledTarget} />;

  function emitTabSwitched(next: TabId) {
    if (lastTabRef.current === next) return;
    trackTabSwitched({ tab: next, from_tab: lastTabRef.current });
    lastTabRef.current = next;
  }

  // Preview redirects above. The default bar owns the main app's bottom inset;
  // reserve a full icon row independently of the device's home indicator.
  const bottomPadding = Math.max(insets.bottom, 8);
  const tabBarStyle = {
    backgroundColor: EDITORIAL.cream,
    borderTopWidth: 1,
    borderTopColor: EDITORIAL.border,
    elevation: 0,
    paddingTop: 6,
    paddingBottom: bottomPadding,
    height: 64 + bottomPadding,
  };

  return (
    <FloatingNavClearanceContext.Provider value={floatingNav ? floatingTabBarClearance(insets.bottom) : 0}>
    <Tabs
      tabBar={floatingNav ? (props) => <FloatingTabBar {...props} /> : undefined}
      screenOptions={{
        headerShown: false,
        tabBarStyle,
        tabBarLabelPosition: 'below-icon',
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
          tabBarAccessibilityLabel: 'Saved',
          tabBarButtonTestID: 'tab-saved',
          tabBarIcon: ({ color, focused }: { color: string; size: number; focused: boolean }) => (
            <Ionicons name={focused ? 'bookmark' : 'bookmark-outline'} size={floatingNav ? 24 : 22} color={color} />
          ),
        }}
        listeners={{ tabPress: () => emitTabSwitched('saved') }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarAccessibilityLabel: 'Search',
          tabBarButtonTestID: 'tab-search',
          // showLabel belongs to the whole active bar. Hide only this label.
          tabBarLabel: () => null,
          tabBarIconStyle: { width: 44, height: 44 },
          tabBarIcon: ({ color }: { color: string }) => floatingNav ? <Ionicons name="search" size={24} color={color} /> : (
            <View style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: EDITORIAL.green,
              alignItems: 'center',
              justifyContent: 'center',
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
          tabBarAccessibilityLabel: 'Profile',
          tabBarButtonTestID: 'tab-profile',
          tabBarIcon: ({ color, focused }: { color: string; size: number; focused: boolean }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={floatingNav ? 24 : 22} color={color} />
          ),
        }}
        listeners={{ tabPress: () => emitTabSwitched('profile') }}
      />
    </Tabs>
    </FloatingNavClearanceContext.Provider>
  );
}
