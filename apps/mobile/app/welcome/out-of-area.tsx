import React, { useEffect } from 'react';
import { Linking, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';
import { trackOnboardingScreenView } from '@/lib/analytics';

// TODO(marketing): confirm the real Instagram handle before launch.
const FITSY_INSTAGRAM = 'https://instagram.com/fitsy';

/**
 * Shown when the location preview comes back empty — the user is outside
 * Fitsy's serviceable area (LA-only at launch). A soft, terminal capture
 * screen: the account was created earlier in onboarding, so we already have
 * their email and can notify them at launch (sending is future infra — see the
 * marketing backlog); Instagram is the secondary channel.
 */
export default function OutOfAreaScreen() {
  useEffect(() => {
    trackOnboardingScreenView('out_of_area');
  }, []);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        <View style={s.center}>
          <Animated.View entering={FadeIn.duration(500)} style={s.emoji}>
            <Text style={s.emojiTxt}>🌱</Text>
          </Animated.View>

          <Animated.Text entering={FadeInDown.duration(500).delay(120)} style={s.title}>
            Fitsy isn't in your{'\n'}city yet.
          </Animated.Text>

          <Animated.Text entering={FadeInDown.duration(500).delay(240)} style={s.subtitle}>
            We're launching in Los Angeles first. We'll email you the moment we
            go live near you — you're on the list.
          </Animated.Text>
        </View>

        <Animated.View entering={FadeIn.duration(400).delay(360)} style={s.ctas}>
          <AnimatedPress
            style={s.ig}
            onPress={() => Linking.openURL(FITSY_INSTAGRAM)}
            haptic
            accessibilityRole="button"
            accessibilityLabel="Follow Fitsy on Instagram"
          >
            <Ionicons name="logo-instagram" size={18} color={EDITORIAL.cream} />
            <Text style={s.igTxt}>Follow us for launch updates</Text>
          </AnimatedPress>

          <AnimatedPress
            style={s.done}
            onPress={() => router.replace('/welcome/problem')}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <Text style={s.doneTxt}>Done</Text>
          </AnimatedPress>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream },
  content: { flex: 1, paddingHorizontal: 36, paddingBottom: 40, paddingTop: 24 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emoji: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: EDITORIAL.creamCard,
    alignItems: 'center', justifyContent: 'center', marginBottom: 32,
  },
  emojiTxt: { fontSize: 38 },
  title: {
    fontFamily: FONTS.frauncesDisplay, fontSize: 32, color: EDITORIAL.text,
    letterSpacing: -1, lineHeight: 40, textAlign: 'center', marginBottom: 16,
  },
  subtitle: {
    fontFamily: FONTS.nunitoSans, fontSize: 15, lineHeight: 22,
    color: EDITORIAL.textSoft, textAlign: 'center', paddingHorizontal: 8,
  },
  ctas: { gap: 12 },
  ig: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: EDITORIAL.green, borderRadius: 32, paddingVertical: 18,
  },
  igTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
  done: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  doneTxt: { fontFamily: FONTS.nunitoSans, fontSize: 15, fontWeight: '500', color: EDITORIAL.textSoft },
});
