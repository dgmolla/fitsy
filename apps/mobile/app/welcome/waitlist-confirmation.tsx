import React, { useEffect } from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';
import { trackOnboardingScreenView } from '@/lib/analytics';

/**
 * Terminal waitlist screen for out-of-area users.
 *
 * Reached only via the out-of-area branch:
 *   results (empty preview) → signin → notification-permission → here.
 *
 * By this point we have the user's account/email (signin) and, if they
 * allowed it, a push token — so we can reach them when we expand. We
 * deliberately do NOT send them to trial/payment: there's nothing to sell
 * someone who has no inventory in their area yet. The single CTA lets them
 * browse the live LA experience instead of dead-ending.
 */
export default function WaitlistConfirmationScreen() {
  useEffect(() => {
    trackOnboardingScreenView('waitlist_confirmation');
  }, []);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        <View style={s.center}>
          <Animated.View entering={FadeIn.duration(500)} style={s.iconCircle}>
            <Ionicons name="checkmark" size={40} color={EDITORIAL.green} />
          </Animated.View>

          <Animated.Text entering={FadeInDown.duration(500).delay(120)} style={s.title}>
            You&apos;re on{'\n'}the list.
          </Animated.Text>

          <Animated.Text entering={FadeInDown.duration(500).delay(240)} style={s.subtitle}>
            We&apos;ll email and notify you the moment Fitsy launches near you.
            Right now we&apos;re live in Los Angeles.
          </Animated.Text>
        </View>

        <Animated.View entering={FadeIn.duration(400).delay(360)} style={s.ctas}>
          <AnimatedPress
            style={s.primary}
            onPress={() => router.replace('/(tabs)/search')}
            haptic
            accessibilityRole="button"
            accessibilityLabel="Take a look around Los Angeles"
          >
            <Text style={s.primaryTxt}>Take a look around LA</Text>
            <Ionicons name="arrow-forward" size={15} color={EDITORIAL.cream} />
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
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: EDITORIAL.creamCard,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  title: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 32,
    color: EDITORIAL.text,
    letterSpacing: -1,
    lineHeight: 40,
    textAlign: 'center',
    marginBottom: 16,
  },
  subtitle: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 15,
    lineHeight: 22,
    color: EDITORIAL.textSoft,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  ctas: { gap: 12 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: EDITORIAL.green,
    borderRadius: 32,
    paddingVertical: 18,
  },
  primaryTxt: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 16,
    fontWeight: '600',
    color: EDITORIAL.cream,
  },
});
