import React, { useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as StoreReview from 'expo-store-review';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';
import { LaurelWreath } from '@/components/LaurelWreath';
import { trackOnboardingScreenView, trackRatingPromptRequested } from '@/lib/analytics';

/**
 * Forced post-signup review ask, inserted right after account creation
 * (welcome/signin.tsx) and before location/notification setup.
 *
 * Deliberately has no skip: the CTA is the only way forward. The native
 * StoreKit prompt itself is dismissible, so "no skip" here just means we
 * don't offer a second, easier way to duck the ask before the OS ever
 * shows it. This runs independently of, and in addition to, the gated
 * engagement-based prompt in lib/ratingPrompt.ts — see trackRatingPromptRequested's
 * `source` field for how the two are told apart downstream.
 */
export default function LeaveReviewScreen() {
  const [busy, setBusy] = useState(false);
  const { outOfArea } = useLocalSearchParams<{ outOfArea?: string }>();
  const destination = outOfArea === '1' ? '/welcome/out-of-area' : '/welcome/notification-permission';

  useEffect(() => {
    trackOnboardingScreenView('leave-review');
  }, []);

  async function handleReview() {
    if (busy) return;
    setBusy(true);
    try {
      // hasAction() is false on web, in the simulator without a store, etc.
      if (await StoreReview.hasAction()) {
        trackRatingPromptRequested({ source: 'onboarding' });
        await StoreReview.requestReview();
      }
    } catch {
      // Native prompt failures are non-actionable — continue onboarding regardless.
    } finally {
      router.replace(destination);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        <View style={s.center}>
          <Animated.View entering={FadeIn.duration(500).delay(60)} style={s.wreathRow}>
            <LaurelWreath color={EDITORIAL.greenAccent} mirrored />
            <View style={s.stars}>
              {[0, 1, 2, 3, 4].map((i) => (
                <Animated.View key={i} entering={ZoomIn.duration(350).delay(100 + i * 90)}>
                  <Ionicons name="star" size={26} color={EDITORIAL.greenAccent} />
                </Animated.View>
              ))}
            </View>
            <LaurelWreath color={EDITORIAL.greenAccent} />
          </Animated.View>

          <Animated.Text entering={FadeInDown.duration(500).delay(120)} style={s.title}>
            We&apos;re a small team.
          </Animated.Text>

          <Animated.Text entering={FadeInDown.duration(500).delay(240)} style={s.subtitle}>
            Help us grow by leaving a review.
          </Animated.Text>
        </View>

        <Animated.View entering={FadeIn.duration(400).delay(360)}>
          <AnimatedPress
            style={[s.cta, busy ? s.dim : undefined]}
            onPress={handleReview}
            disabled={busy}
            haptic
            accessibilityRole="button"
            accessibilityLabel="Leave a review"
          >
            <Ionicons name="star" size={17} color={EDITORIAL.cream} />
            <Text style={s.ctaTxt}>{busy ? 'One sec...' : 'Leave a review'}</Text>
          </AnimatedPress>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream },
  content: { flex: 1, paddingHorizontal: 36, paddingBottom: 40, paddingTop: 24 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wreathRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 32,
  },
  stars: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 4,
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
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: EDITORIAL.green,
    borderRadius: 32,
    paddingVertical: 18,
  },
  ctaTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
  dim: { opacity: 0.4 },
});
