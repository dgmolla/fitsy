import { requireWelcomeGoal } from '@/lib/requireWelcomeGoal';
import React, { useEffect } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { useOnboardingStep } from '@/lib/onboardingResume';
import { trackOnboardingScreenView } from '@/lib/analytics';
import { rememberOnboardingPreviewEntry } from '@/lib/onboardingPreviewEntry';

function HowItWorksScreen() {
  useOnboardingStep('how-it-works');
  useEffect(() => { trackOnboardingScreenView('how_it_works'); }, []);
  return <WelcomeScreen progress={0.61} title={"A little context.\nA better choice."}
    canContinue onContinue={() => { void rememberOnboardingPreviewEntry()
      .then(() => router.push('/welcome/preview'))
      .catch(() => Alert.alert('Could not open preview', 'Please try again.')); }}>
    <View style={s.graphic}>
      <View style={s.iconWrap}><Ionicons name="receipt-outline" size={36} color={EDITORIAL.green} /></View>
      <View style={s.badges}>
        <Text style={s.badge} testID="nutrition-source-published">Published</Text>
        <Text style={[s.badge, s.estimated]} testID="nutrition-source-estimated">Estimated</Text>
      </View>
    </View>
  </WelcomeScreen>;
}
const s = StyleSheet.create({
  graphic: { alignItems: 'center', paddingVertical: 36, gap: 24 },
  iconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: EDITORIAL.greenAccentTint, alignItems: 'center', justifyContent: 'center' },
  badges: { flexDirection: 'row', gap: 10 },
  badge: { ...TEXT.bodySmall, borderRadius: 14, overflow: 'hidden', backgroundColor: EDITORIAL.greenAccentTint, color: EDITORIAL.green, paddingHorizontal: 12, paddingVertical: 6 },
  estimated: { backgroundColor: EDITORIAL.creamDeep, color: EDITORIAL.textMid },
});

export default requireWelcomeGoal(HowItWorksScreen, '/welcome/target-setup');
