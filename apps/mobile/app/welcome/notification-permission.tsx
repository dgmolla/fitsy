import React, { useEffect, useRef, useState } from 'react';
import { Animated as RNAnimated, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { saveReminderPreferences } from '@/lib/notificationSchedule';
import { getExpoPushTokenAsync, requestPermissionsAsync } from '@/lib/useNotifications';
import {
  trackReminderAction,
  trackNotificationPermissionDenied,
  trackNotificationPermissionGranted,
  trackNotificationPrimingAllowTapped,
  trackNotificationPrimingShown,
  trackNotificationPrimingSkipTapped,
} from '@/lib/analytics';

/** Ask only after the user chooses Allow. Local reminders work without an
 * APNs token; token registration remains available for future push campaigns. */
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
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await saveReminderPreferences(session.user.id, { meals: true, trial: true });
          trackReminderAction({ action: 'preferences_changed', meals: true, trial: true });
        }
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
            Your next meal,{'\n'}made easier.
          </Animated.Text>

          <Animated.Text entering={FadeInDown.duration(500).delay(240)} style={s.subtitle}>
            Turn on two weekly meal-planning nudges and a reminder before an
            eligible trial renews. No more than one a day, with quiet hours
            from 8pm to 9am. Change these in Profile anytime.
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
            testID="notification-allow"
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
            testID="notification-skip"
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
