import { useOnboardingStep } from '@/lib/onboardingResume';
import React, { useCallback, useEffect, useState } from 'react';
import { Linking, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';
import { trackOnboardingScreenView } from '@/lib/analytics';
import { joinSavedAreaWaitlist } from '@/lib/waitlist';
import { isRealAccountSession, supabase } from '@/lib/supabase';

const FITSY_INSTAGRAM = 'https://instagram.com/fitsy.lyfe';

/**
 * Shown when the location preview comes back empty — the user is outside
 * Fitsy's serviceable area (LA-only at launch). A signed-in user is
 * saved to the launch waitlist automatically (POST /api/waitlist, #1012), which
 * stores the account email + a COARSE, city-level location; a visitor without
 * an account gets one "Get notified" sign-in button. At launch the server notifies them by
 * BOTH push and email; email is the durable channel if the app was deleted.
 * Every marketing email includes an unsubscribe link. Instagram is a secondary
 * channel. See docs/engineering/backend/launch-waitlist.md.
 */
export default function OutOfAreaScreen() {
  useOnboardingStep('out-of-area');
  const { joined: joinedOnSignIn } = useLocalSearchParams<{ joined?: string }>();
  // 'checking' until the session is read; signed-in users are saved to the waitlist automatically (#1012).
  const [status, setStatus] = useState<'checking' | 'joined' | 'signin' | 'retry'>(joinedOnSignIn === '1' ? 'joined' : 'checking');

  useEffect(() => {
    trackOnboardingScreenView('out_of_area');
  }, []);

  const autoJoin = useCallback(async () => {
    setStatus('checking');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // An anonymous session (#801) has no email to notify: it needs the real sign-in.
      if (!isRealAccountSession(session)) { setStatus('signin'); return; }
      setStatus(await joinSavedAreaWaitlist() ? 'joined' : 'retry');
    } catch { setStatus('retry'); }
  }, []);
  useEffect(() => { if (status === 'checking') void autoJoin(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content} testID="out-of-area-screen">
        <View style={s.center}>
          <Animated.View entering={FadeIn.duration(500)} style={s.emoji}>
            <Text style={s.emojiTxt}>🌱</Text>
          </Animated.View>

          <Animated.Text entering={FadeInDown.duration(500).delay(120)} style={s.title}>
            More menus are{'\n'}on the way.
          </Animated.Text>

          <Animated.Text entering={FadeInDown.duration(500).delay(240)} style={s.subtitle}>
            We don't have dishes with nutrition in your selected area yet. Join the waitlist for coverage updates.
          </Animated.Text>
        </View>

        <Animated.View entering={FadeIn.duration(400).delay(360)} style={s.ctas}>
          {status === 'joined' && <Text style={s.notifyNote} testID="waitlist-joined">We'll let you know when Fitsy launches nearby.</Text>}
          {(status === 'signin' || status === 'retry') && <AnimatedPress
            style={s.notify}
            onPress={status === 'signin' ? () => router.push('/welcome/signin?outOfArea=1') : () => { void autoJoin(); }}
            haptic
            accessibilityRole="button"
            testID="waitlist-join"
          >
            <Ionicons name="notifications-outline" size={18} color={EDITORIAL.cream} />
            <Text style={s.notifyTxt}>{status === 'signin' ? 'Get notified' : "Couldn't add you. Tap to try again"}</Text>
          </AnimatedPress>}

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
            onPress={() => router.dismissTo('/welcome/location-permission')}
            accessibilityRole="button"
            accessibilityLabel="Choose another area"
            testID="waitlist-change-area"
          >
            <Text style={s.doneTxt}>Choose another area</Text>
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
  notifyNote: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, fontWeight: '600', color: EDITORIAL.greenAccent, textAlign: 'center', paddingVertical: 14 },
  notifyTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
  ig: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 12,
  },
  igTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 14, fontWeight: '600', color: EDITORIAL.greenAccent },
  done: { alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  doneTxt: { fontFamily: FONTS.nunitoSans, fontSize: 15, fontWeight: '500', color: EDITORIAL.textSoft },
});
