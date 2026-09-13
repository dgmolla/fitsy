import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
  return <WelcomeScreen progress={0.3} title={pitch?.headline ?? 'Made for your meals.'} subtitle={pitch?.body}
    canContinue={!!pitch} onContinue={() => router.push('/welcome/location-permission')} continueLabel="Find options near me">
    {pitch && <View style={s.card}><Text style={s.payoff}>{pitch.payoff}</Text></View>}
  </WelcomeScreen>;
}

const s = StyleSheet.create({
  card: { backgroundColor: EDITORIAL.green, borderRadius: 22, padding: 26, marginTop: 12 },
  payoff: { ...TEXT.headline, fontSize: 25, lineHeight: 34, color: EDITORIAL.cream },
});
