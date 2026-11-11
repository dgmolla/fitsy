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
      <View style={s.sources}>
        <View style={s.sourceRow}>
          <Text style={s.badge} testID="nutrition-source-published">Published</Text>
          <Text style={s.sourceText}>Straight from the restaurant’s menu.</Text>
        </View>
        <View style={s.sourceRow}>
          <Text style={[s.badge, s.estimated]} testID="nutrition-source-estimated">Estimated</Text>
          <Text style={s.sourceText}>Our best approximation when it isn’t.</Text>
        </View>
      </View>
    </View>
  </WelcomeScreen>;
}
const s = StyleSheet.create({
  graphic: { alignItems: 'center', paddingVertical: 36, gap: 28 },
  iconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: EDITORIAL.greenAccentTint, alignItems: 'center', justifyContent: 'center' },
  sources: { gap: 16, alignSelf: 'stretch' },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { ...TEXT.bodySmall, borderRadius: 14, overflow: 'hidden', backgroundColor: EDITORIAL.greenAccentTint, color: EDITORIAL.green, paddingHorizontal: 12, paddingVertical: 6 },
  estimated: { backgroundColor: EDITORIAL.creamDeep, color: EDITORIAL.textMid },
  sourceText: { ...TEXT.body, flex: 1, fontSize: 14, lineHeight: 20, color: EDITORIAL.textMid },
});

export default requireWelcomeGoal(HowItWorksScreen, '/welcome/target-setup');
