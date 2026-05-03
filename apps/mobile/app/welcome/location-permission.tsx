import React, { useEffect, useRef, useState } from 'react';
import { Animated as RNAnimated, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';
import {
  trackLocationPermissionDenied,
  trackLocationPermissionGranted,
  trackLocationPrimingAllowTapped,
  trackLocationPrimingShown,
  trackLocationPrimingSkipTapped,
} from '@/lib/analytics';

/**
 * Location-permission priming screen (S-225).
 *
 * Inserted between sign-in success and `(tabs)/search` to frame *why* Fitsy
 * needs location before the OS dialog appears. iOS only allows calling
 * `Location.requestForegroundPermissionsAsync()` once per install, so this
 * screen is the only opportunity to lift grant rate above the cold-prompt
 * baseline.
 *
 * Critical: the OS prompt is NOT triggered on mount — only on the explicit
 * "Allow location" CTA. "Maybe later" advances without consuming the one-shot
 * prompt; `useLocation` will then fall back to Silver Lake on the search
 * screen until the user grants permission via Settings.
 */
export default function LocationPermissionScreen() {
  const [busy, setBusy] = useState(false);
  const pulse = useRef(new RNAnimated.Value(0.45)).current;

  useEffect(() => {
    trackLocationPrimingShown();
  }, []);

  useEffect(() => {
    RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        RNAnimated.timing(pulse, { toValue: 0.45, duration: 900, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulse]);

  async function handleAllow() {
    if (busy) return;
    setBusy(true);
    trackLocationPrimingAllowTapped();
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        trackLocationPermissionGranted();
      } else {
        // Mirrors useLocation's denied event so the funnel reads as a single
        // permission_denied tally regardless of which surface fired the prompt.
        trackLocationPermissionDenied({ had_last_known: false });
      }
    } catch {
      // OS prompt failures are rare and non-actionable here — let useLocation's
      // error path on the search screen handle telemetry on the next attempt.
    } finally {
      router.replace('/welcome/notification-permission');
    }
  }

  function handleSkip() {
    if (busy) return;
    trackLocationPrimingSkipTapped();
    router.replace('/welcome/notification-permission');
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        <View style={s.center}>
          <Animated.View entering={FadeIn.duration(500)}>
            <RNAnimated.View style={[s.pin, { opacity: pulse }]}>
              <Ionicons name="location" size={36} color={EDITORIAL.greenAccent} />
            </RNAnimated.View>
          </Animated.View>

          <Animated.Text entering={FadeInDown.duration(500).delay(120)} style={s.title}>
            Find restaurants{'\n'}near you.
          </Animated.Text>

          <Animated.Text entering={FadeInDown.duration(500).delay(240)} style={s.subtitle}>
            We use your location to surface nearby spots that match your macros.
            We never store or share it.
          </Animated.Text>
        </View>

        <Animated.View entering={FadeIn.duration(400).delay(360)} style={s.ctas}>
          <AnimatedPress
            style={[s.allow, busy ? s.dim : undefined]}
            onPress={handleAllow}
            disabled={busy}
            haptic
            accessibilityRole="button"
            accessibilityLabel="Allow location"
          >
            <Text style={s.allowTxt}>{busy ? 'Asking…' : 'Allow location'}</Text>
            <Ionicons name="arrow-forward" size={15} color={EDITORIAL.cream} />
          </AnimatedPress>

          <AnimatedPress
            style={s.skip}
            onPress={handleSkip}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Maybe later"
          >
            <Text style={s.skipTxt}>Maybe later</Text>
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
  pin: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: EDITORIAL.creamCard,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  title: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 32,
    color: EDITORIAL.text,
    letterSpacing: -1,
    lineHeight: 40,
    textAlign: 'center',
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: EDITORIAL.textSoft,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  ctas: { gap: 12 },
  allow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: EDITORIAL.green,
    borderRadius: 32,
    paddingVertical: 18,
  },
  allowTxt: { fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
  dim: { opacity: 0.4 },
  skip: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  skipTxt: { fontSize: 15, fontWeight: '500', color: EDITORIAL.textSoft },
});
