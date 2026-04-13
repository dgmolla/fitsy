import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { saveOnboardingField } from '@/lib/onboardingStorage';
import { EDITORIAL, FONTS } from '@/lib/brand';

export default function AgeScreen() {
  const [value, setValue] = useState('');

  return (
    <WelcomeScreen
      step={6}
      totalSteps={8}
      title="How old are you?"
      onContinue={async () => {
        const age = parseInt(value, 10) || 25;
        await saveOnboardingField('birthday', `${new Date().getFullYear() - age}-01-01`);
        router.push('/welcome/activity');
      }}
      canContinue={true}
      onSkip={() => router.push('/welcome/activity')}
    >
      <Animated.View entering={FadeInDown.duration(400).delay(100)} style={s.wrap}>
        <Text style={s.label}>AGE</Text>
        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={value}
            onChangeText={setValue}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="28"
            placeholderTextColor={EDITORIAL.creamDeep}
            autoFocus
          />
          <Text style={s.unit}>yrs</Text>
        </View>
      </Animated.View>
    </WelcomeScreen>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 2, color: EDITORIAL.textSoft, textTransform: 'uppercase' },
  inputRow: {
    flexDirection: 'row', alignItems: 'baseline',
    backgroundColor: EDITORIAL.creamCard, borderRadius: 16, paddingHorizontal: 24, paddingVertical: 20,
  },
  input: { flex: 1, fontFamily: FONTS.newsreaderBold, fontSize: 36, color: EDITORIAL.text, letterSpacing: -1, padding: 0 },
  unit: { fontSize: 18, color: EDITORIAL.textSoft, fontWeight: '500' },
});
