import { useOnboardingStep } from '@/lib/onboardingResume';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { saveOnboardingField } from '@/lib/onboardingStorage';

export default function TargetSetupScreen() {
  useOnboardingStep('target-setup');
  return (
    <WelcomeScreen title={"Your meal.\nYour targets."} subtitle="Match what you want to eat with what works for you." hideFooter canContinue onContinue={() => {}}>
      <View style={s.choices}>
        {([
          ['known', 'I know my targets', 'Enter the macros you want in a meal.'],
          ['estimate', 'Help me set them', 'A few questions for an editable starting point.'],
        ] as const).map(([mode, title, detail]) => (
          <AnimatedPress key={mode} style={s.choice} testID={`target-mode-${mode}`} accessibilityRole="button" onPress={async () => {
            await saveOnboardingField('targetMode', mode);
            router.push(mode === 'known' ? '/welcome/tuning' : '/welcome/goal');
          }}>
            <Text style={s.title}>{title}</Text><Text style={s.detail}>{detail}</Text>
          </AnimatedPress>
        ))}
      </View>
    </WelcomeScreen>
  );
}
const s = StyleSheet.create({
  choices: { gap: 16, marginTop: 20 },
  choice: { padding: 24, borderRadius: 22, borderWidth: 1, borderColor: EDITORIAL.border, backgroundColor: EDITORIAL.creamCard },
  title: { ...TEXT.body, fontSize: 18, color: EDITORIAL.green, marginBottom: 8 },
  detail: { ...TEXT.bodySmall },
});
