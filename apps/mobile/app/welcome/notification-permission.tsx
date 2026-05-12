import React, { useEffect, useRef, useState } from 'react';
import { Animated as RNAnimated, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';
import { api } from '@/lib/api';
import { getExpoPushTokenAsync, requestPermissionsAsync } from '@/lib/useNotifications';
import {
  trackNotificationPermissionDenied,
  trackNotificationPermissionGranted,
  trackNotificationPrimingAllowTapped,
  trackNotificationPrimingShown,
  trackNotificationPrimingSkipTapped,
} from '@/lib/analytics';

/**
 * Notification-permission priming screen (S-226b).
 *
 * Inserted between the location-permission screen (S-225) and the search tab.
 * Mirrors S-225's priming pattern: explain *why* before the OS dialog fires
 * so we lift grant rate above the cold-prompt baseline. iOS only allows
 * `Notifications.requestPermissionsAsync()` to surface the system dialog
 * once per install — this screen is the only opportunity.
 *
 * Critical: the OS prompt is NOT triggered on mount — only on the explicit
 * "Allow notifications" CTA. "Maybe later" advances without consuming the
 * one-shot prompt; users can re-grant via Settings later.
 *
 * On grant we POST the Expo push token to `/api/user/push-token` (S-226a) so
 * we have a token registry ready when notification campaigns ship. Token
 * fetch failures (Expo Go, simulator without push entitlement) are silent —
 * the user still completes the redirect.
 */
export default function NotificationPermissionScreen() {
  const [busy, setBusy] = useState(false);
  const pulse = useRef(new RNAnimated.Value(0.45)).current;

  useEffect(() => {
    trackNotificationPrimingShown();
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
    trackNotificationPrimingAllowTapped();
    try {
      const { status } = await requestPermissionsAsync();
      if (status === 'granted') {
        trackNotificationPermissionGranted();
        // Fire-and-forget the token POST. Token fetch returns null in Expo Go
        // and on push-incapable simulators — we don't want to block the
        // redirect on either, so swallow errors and let the next session
        // re-attempt. The S-226a endpoint is idempotent.
        try {
          const token = await getExpoPushTokenAsync();
          if (token) {
            await api.post('/api/user/push-token', { token });
          }
        } catch {
          // Non-actionable here; PostHog already captured `granted`.
        }
      } else {
        trackNotificationPermissionDenied();
      }
    } catch {
      // OS prompt failures are rare and non-actionable — proceed to paywall.
    } finally {
      router.replace('/welcome/trial');
    }
  }

  function handleSkip() {
    if (busy) return;
    trackNotificationPrimingSkipTapped();
    router.replace('/welcome/trial');
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        <View style={s.center}>
          <Animated.View entering={FadeIn.duration(500)}>
            <RNAnimated.View style={[s.bell, { opacity: pulse }]}>
              <Ionicons name="notifications" size={36} color={EDITORIAL.greenAccent} />
            </RNAnimated.View>
          </Animated.View>

          <Animated.Text entering={FadeInDown.duration(500).delay(120)} style={s.title}>
            Stay on{'\n'}your macros.
          </Animated.Text>

          <Animated.Text entering={FadeInDown.duration(500).delay(240)} style={s.subtitle}>
            Get reminders to log meals and nudges when you&apos;re near a
            high-protein spot. Off by default — turn on anytime.
          </Animated.Text>
        </View>

        <Animated.View entering={FadeIn.duration(400).delay(360)} style={s.ctas}>
          <AnimatedPress
            style={[s.allow, busy ? s.dim : undefined]}
            onPress={handleAllow}
            disabled={busy}
            haptic
            accessibilityRole="button"
            accessibilityLabel="Allow notifications"
          >
            <Text style={s.allowTxt}>{busy ? 'Asking…' : 'Allow notifications'}</Text>
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
  bell: {
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
  allow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: EDITORIAL.green,
    borderRadius: 32,
    paddingVertical: 18,
  },
  allowTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
  dim: { opacity: 0.4 },
  skip: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  skipTxt: { fontFamily: FONTS.nunitoSans, fontSize: 15, fontWeight: '500', color: EDITORIAL.textSoft },
});
