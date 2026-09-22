import React, { useCallback, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { useOnboardingStep } from '@/lib/onboardingResume';
import { getOnboardingData } from '@/lib/onboardingStorage';
import { onboardingPitch } from '@/lib/onboardingPersonalization';
import { trackOnboardingScreenView } from '@/lib/analytics';

export default function ResponseScreen() {
  useOnboardingStep('response');
  const [pitch, setPitch] = useState<ReturnType<typeof onboardingPitch>>();
  useFocusEffect(useCallback(() => {
    let live = true;
    void getOnboardingData().then(data => {
      if (!live) return;
      setPitch(onboardingPitch(data.tried));
      trackOnboardingScreenView(`response_${data.tried ?? 'nothing'}`);
    });
    return () => { live = false; };
  }, []));
  return <WelcomeScreen progress={0.29} title={pitch?.headline ?? 'Made for your meals.'} subtitle={pitch?.body}
    canContinue={!!pitch} onContinue={() => router.push('/welcome/value-payoff')} continueLabel="See how it supports my goals">
    <View style={s.photoWrap}><Image source={require('@/assets/dishes/06.jpg')} style={s.photo} accessibilityLabel="Meal inspiration" /><Text style={s.caption}>Meal inspiration</Text></View>
    <View style={s.proof}><Ionicons name="reader-outline" size={20} color={EDITORIAL.greenAccent} /><Text style={s.note}>Real menus. Nutrition sources included.</Text></View>
  </WelcomeScreen>;
}
const s = StyleSheet.create({
  photoWrap: { height: 248, borderRadius: 24, overflow: 'hidden', backgroundColor: EDITORIAL.creamCard },
  photo: { width: '100%', height: '100%', resizeMode: 'cover' },
  caption: { ...TEXT.bodySmall, position: 'absolute', left: 12, bottom: 12, backgroundColor: EDITORIAL.cream, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  proof: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 25 },
  note: { ...TEXT.bodySmall, color: EDITORIAL.greenAccent, flexShrink: 1 },
});
