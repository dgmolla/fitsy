import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { useOnboardingStep } from '@/lib/onboardingResume';
import { trackOnboardingScreenView } from '@/lib/analytics';

export default function HowItWorksScreen() {
  useOnboardingStep('how-it-works');
  useEffect(() => { trackOnboardingScreenView('how_it_works'); }, []);
  return <WelcomeScreen progress={0.61} title={"A little context.\nA better choice."}
    subtitle="Every nutrition label tells you where the numbers come from."
    canContinue onContinue={() => router.push('/welcome/preview')} continueLabel="Explore restaurants">
    <View style={s.panels}>
      <View style={s.panel} testID="nutrition-source-published">
        <Text style={s.badge}>Published</Text><Text style={s.title}>From the restaurant.</Text>
        <Text style={s.body}>Nutrition supplied by the restaurant for the listed meal.</Text>
      </View>
      <View style={s.panel} testID="nutrition-source-estimated">
        <Text style={[s.badge, s.estimated]}>Estimated</Text><Text style={s.title}>A useful approximation.</Text>
        <Text style={s.body}>An estimate when published nutrition isn't available.</Text>
      </View>
    </View>
    <Text style={s.note}>Full menus show each dish’s nutrition source. Portions and preparation can vary.</Text>
  </WelcomeScreen>;
}
const s = StyleSheet.create({
  panels: { gap: 14 },
  panel: { padding: 20, borderRadius: 24, backgroundColor: EDITORIAL.creamCard, gap: 16 },
  badge: { ...TEXT.bodySmall, alignSelf: 'flex-start', borderRadius: 14, overflow: 'hidden', backgroundColor: EDITORIAL.greenAccentTint, color: EDITORIAL.green, paddingHorizontal: 10, paddingVertical: 5 },
  estimated: { backgroundColor: EDITORIAL.creamDeep, color: EDITORIAL.textMid },
  title: { ...TEXT.title, fontSize: 23, lineHeight: 28 },
  body: { ...TEXT.body, lineHeight: 24 },
  note: { ...TEXT.bodySmall, textAlign: 'center', marginTop: 20, lineHeight: 20 },
});
