import { useRef } from 'react';
import { View } from 'react-native';
import { Tabs, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, EDITORIAL, FONTS } from '@/lib/brand';
import { usePurchases } from '@/lib/usePurchases';
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
  // (requireSubscription), which is the real security boundary. `__DEV__`
  // bypasses local development; the demo review account holds a granted
  // RevenueCat entitlement, so it passes `isPro` in production review.
  const { ready, isPro } = usePurchases();
  if (!__DEV__) {
    if (!ready) return null; // brief hold while RevenueCat settles, avoids a flash
    if (!isPro) return <Redirect href="/welcome/payment" />;
  }

  function emitTabSwitched(next: TabId) {
    if (lastTabRef.current === next) return;
    trackTabSwitched({ tab: next, from_tab: lastTabRef.current });
    lastTabRef.current = next;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: EDITORIAL.cream,
          borderTopWidth: 1,
          borderTopColor: EDITORIAL.border,
          elevation: 0,
          paddingTop: 8,
          height: 80,
        },
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
