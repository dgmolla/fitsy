import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { resetPreviewSample } from '@/lib/teaserGate';
import { trackOnboardingScreenView } from '@/lib/analytics';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const ROWS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'restaurant-outline',
    title: 'Your top 3 spots, unlocked',
    body: 'Real restaurants near you that fit the macros you just set.',
  },
  {
    icon: 'eye-outline',
    title: 'One free look inside',
    body: 'Tap any of the three to open a real menu sample, with macros.',
  },
  {
    icon: 'lock-closed-outline',
    title: 'The rest stays blurred',
    body: 'Every other match and dish unlocks when you subscribe.',
  },
];

// Explainer between the "finding restaurants" beat and the locked search
// teaser, so the blurred rows and the single free detail look read as
// intentional rather than broken. Sits at the same 17/18 step as finding.tsx.
export default function PreviewIntroScreen() {
  useEffect(() => {
    trackOnboardingScreenView('preview-intro');
  }, []);

  return (
    <WelcomeScreen
      progress={17 / 18}
      title={"Here's what we found."}
      subtitle="A quick tour before you look around."
      showBack={false}
      onContinue={() => {
        // A fresh onboarding pass is a fresh tease - a free look spent in an
        // earlier session (re-onboarding, testing) must not carry over.
        resetPreviewSample().finally(() => router.replace('/(tabs)/search?preview=1'));
      }}
      canContinue
      continueLabel="Show me"
    >
      <View style={s.rows}>
        {ROWS.map((r) => (
          <View key={r.title} style={s.row}>
            <View style={s.iconWrap}>
              <Ionicons name={r.icon} size={20} color={EDITORIAL.greenAccent} />
            </View>
            <View style={s.rowText}>
              <Text style={s.rowTitle}>{r.title}</Text>
              <Text style={s.rowBody}>{r.body}</Text>
            </View>
          </View>
        ))}
      </View>
    </WelcomeScreen>
  );
}

const s = StyleSheet.create({
  rows: { gap: 18 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  iconWrap: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: EDITORIAL.creamCard, alignItems: 'center', justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 3 },
  rowTitle: { fontFamily: FONTS.frauncesDisplay, fontSize: 18, color: EDITORIAL.text, letterSpacing: -0.3 },
  rowBody: { fontFamily: FONTS.nunitoSans, fontSize: 14, lineHeight: 20, color: EDITORIAL.textSoft },
});
