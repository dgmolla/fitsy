import React, { useEffect, useRef } from 'react';
import { Animated as RNAnimated, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import AnimatedRN, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { fetchPreviewRestaurants } from '@/lib/previewSearch';
import { prefetchedRestaurants } from '@/lib/teaserCache';
import { trackOnboardingScreenView, trackPreviewFetchFailed } from '@/lib/analytics';

const MIN_DISPLAY_MS = 2200;

export default function FindingScreen() {
  const pulse = useRef(new RNAnimated.Value(0.3)).current;

  useEffect(() => {
    trackOnboardingScreenView('finding');
  }, []);

  useEffect(() => {
    // Pulsing dot animation
    RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        RNAnimated.timing(pulse, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ]),
    ).start();

    const start = Date.now();

    async function prefetch() {
      try {
        const data = await fetchPreviewRestaurants();
        prefetchedRestaurants.data = data;
        prefetchedRestaurants.error = false;
      } catch (err) {
        // Flag the cache so the results screen can render an explicit
        // "network problem, retry" UI rather than conflating this with the
        // empty-DB state. Also surface the failure in PostHog + console so
        // we can see how often this fires in the field.
        prefetchedRestaurants.data = null;
        prefetchedRestaurants.error = true;
        // eslint-disable-next-line no-console
        console.warn('[finding] /api/restaurants/preview prefetch failed:', err);
        trackPreviewFetchFailed(err);
      }

      const elapsed = Date.now() - start;
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
      setTimeout(() => router.replace('/welcome/results'), remaining);
    }

    prefetch();
  }, [pulse]);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        <View style={s.topBar}>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.round((17 / 18) * 100)}%` }]} />
          </View>
        </View>

        <View style={s.center}>
          <AnimatedRN.View entering={FadeIn.duration(600)}>
            <RNAnimated.View style={[s.dot, { opacity: pulse }]}>
              <Ionicons name="location" size={32} color={EDITORIAL.greenAccent} />
            </RNAnimated.View>
          </AnimatedRN.View>

          <AnimatedRN.Text entering={FadeInDown.duration(500).delay(200)} style={s.title}>
            Finding restaurants{'\n'}near you...
          </AnimatedRN.Text>

          <AnimatedRN.Text entering={FadeInDown.duration(500).delay(400)} style={s.subtitle}>
            Scanning menus that match your macros
          </AnimatedRN.Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream },
  content: { flex: 1, paddingHorizontal: 36 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    paddingLeft: 56,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    backgroundColor: EDITORIAL.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: EDITORIAL.greenAccent,
    borderRadius: 2,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 80,
  },
  dot: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: EDITORIAL.creamCard,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  title: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 28,
    color: EDITORIAL.text,
    letterSpacing: -0.8,
    lineHeight: 36,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 15,
    color: EDITORIAL.textSoft,
    textAlign: 'center',
  },
});
