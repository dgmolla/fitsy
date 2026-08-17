import React, { useEffect, useState } from 'react';
import { Linking, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';
import { trackOnboardingScreenView } from '@/lib/analytics';
import { api } from '@/lib/api';
import { getCachedCoords } from '@/lib/locationCache';

// TODO(marketing): confirm the real Instagram handle before launch.
const FITSY_INSTAGRAM = 'https://instagram.com/fitsy';

/**
 * Shown when the location preview comes back empty — the user is outside
 * Fitsy's serviceable area (LA-only at launch). Explicit opt-in: tapping "Notify
 * me" joins the launch waitlist (POST /api/waitlist), which stores the account
 * email + a COARSE, city-level location. At launch the server notifies them by
 * BOTH push and email; email is the durable channel if the app was deleted.
 * Every marketing email includes an unsubscribe link. Instagram is a secondary
 * channel. See docs/engineering/backend/launch-waitlist.md.
 */
export default function OutOfAreaScreen() {
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    trackOnboardingScreenView('out_of_area');
  }, []);

  async function joinWaitlist() {
    if (joining || joined) return;
    setJoining(true);
    try {
      const coords = await getCachedCoords();
      if (coords) {
        await api.post('/api/waitlist', { lat: coords.lat, lng: coords.lng }, true);
      }
      setJoined(true);
    } catch {
      // Non-fatal: they can still follow on Instagram. Show as joined so we
      // don't nag; the account email is already on file for a retry path.
      setJoined(true);
    } finally {
      setJoining(false);
    }
  }

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
            We're launching in Los Angeles first. Want us to let you know the
            moment we go live near you?
          </Animated.Text>
        </View>

        <Animated.View entering={FadeIn.duration(400).delay(360)} style={s.ctas}>
          <AnimatedPress
            style={[s.notify, joined && s.notifyDone]}
            onPress={joinWaitlist}
            disabled={joining || joined}
            haptic
            accessibilityRole="button"
            accessibilityLabel="Notify me when Fitsy launches nearby"
          >
            <Ionicons
              name={joined ? 'checkmark-circle' : 'notifications-outline'}
              size={18}
              color={EDITORIAL.cream}
            />
            <Text style={s.notifyTxt}>
              {joined ? "You're on the list" : joining ? 'Adding you…' : 'Notify me at launch'}
            </Text>
          </AnimatedPress>

          <AnimatedPress
            style={s.ig}
            onPress={() => Linking.openURL(FITSY_INSTAGRAM)}
            accessibilityRole="button"
            accessibilityLabel="Follow Fitsy on Instagram"
          >
            <Ionicons name="logo-instagram" size={16} color={EDITORIAL.greenAccent} />
            <Text style={s.igTxt}>Follow us on Instagram</Text>
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
  notify: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: EDITORIAL.green, borderRadius: 32, paddingVertical: 18,
  },
  notifyDone: { backgroundColor: EDITORIAL.greenAccent },
  notifyTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
  ig: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 12,
  },
  igTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 14, fontWeight: '600', color: EDITORIAL.greenAccent },
  done: { alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  doneTxt: { fontFamily: FONTS.nunitoSans, fontSize: 15, fontWeight: '500', color: EDITORIAL.textSoft },
});
