import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { LaunchAnalyticsPreferences } from '@/components/LaunchAnalyticsPreferences';
import { openLegalLink } from '@/lib/legalLinks';
import { EDITORIAL, FONTS } from '@/lib/brand';

export default function PrivacySettingsScreen() {
  const insets = useSafeAreaInsets();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.nav}>
          <Pressable onPress={() => router.back()} style={s.navBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={18} color={EDITORIAL.text} />
          </Pressable>
          <Text style={s.navTitle}>Privacy</Text>
          <View style={s.navBtn} />
        </View>
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.lede}>
            We use PostHog for product analytics. When you&rsquo;re signed in, that activity is linked to your account, not anonymous.
          </Text>
          <LaunchAnalyticsPreferences />
          <Pressable testID="privacy-settings-full-policy" hitSlop={8} onPress={() => openLegalLink('privacy')} style={s.policyLink}>
            <Text style={s.policyLinkText}>Read the full privacy policy</Text>
            <Ionicons name="chevron-forward" size={14} color={EDITORIAL.creamDeep} />
          </Pressable>
        </ScrollView>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: EDITORIAL.cream },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  navBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  navTitle: { fontFamily: FONTS.frauncesDisplay, fontSize: 18, color: EDITORIAL.text, letterSpacing: -0.3 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40, gap: 16 },
  lede: { fontFamily: FONTS.nunitoSans, fontSize: 13, lineHeight: 20, color: EDITORIAL.textSoft },
  policyLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  policyLinkText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 14, color: EDITORIAL.text },
});
