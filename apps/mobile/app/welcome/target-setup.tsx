import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { useOnboardingStep } from '@/lib/onboardingResume';
import { saveOnboardingField } from '@/lib/onboardingStorage';
import { getMacroTargets, type StoredMacroTargets } from '@/lib/macroStorage';
import { trackOnboardingChoiceSelected } from '@/lib/analytics';

export default function TargetSetupScreen() {
  useOnboardingStep('target-setup');
  const [saved, setSaved] = useState<StoredMacroTargets | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  useFocusEffect(useCallback(() => {
    let live = true;
    void getMacroTargets().then(targets => { if (live) { setSaved(targets); setReady(true); } });
    return () => { live = false; };
  }, []));
  async function choose(mode: 'known' | 'estimate', useSaved = false) {
    if (busy || !ready) return;
    setBusy(true);
    try {
      await saveOnboardingField('targetMode', mode);
      if (mode === 'estimate') await saveOnboardingField('targetBasis', undefined);
      trackOnboardingChoiceSelected({ screen: 'target_setup', value: useSaved ? 'saved' : mode });
      router.push(useSaved ? '/welcome/preview' : mode === 'known' ? '/welcome/tuning' : '/welcome/goal');
    } catch { Alert.alert('Could not save your choice', 'Please try again.'); }
    finally { setBusy(false); }
  }
  return <WelcomeScreen progress={0.7} title={"Your meal.\nYour targets."} subtitle="Set the numbers. We'll find the meals." hideFooter canContinue onContinue={() => {}}>
    <View style={s.choices}>
      {saved && <View style={s.saved} testID="target-saved-summary">
        <Text style={s.title}>Your saved meal targets</Text>
        <Text style={s.detail}>{saved.calories} kcal · {saved.protein}g protein{'\n'}{saved.carbs}g carbs · {saved.fat}g fat</Text>
        <AnimatedPress style={s.use} disabled={!ready || busy} onPress={() => choose('known', true)} accessibilityRole="button" testID="target-use-saved"><Text style={s.useText}>Use these meal targets</Text></AnimatedPress>
      </View>}
      <AnimatedPress style={s.choice} disabled={!ready || busy} onPress={() => choose('known')} accessibilityRole="button" testID="target-mode-known">
        <Text style={s.title}>{saved ? 'Edit my meal targets' : 'Enter my meal targets'}</Text><Text style={s.detail}>Calories, protein, carbs and fat. No body measurements needed.</Text>
      </AnimatedPress>
      <AnimatedPress style={s.choice} disabled={!ready || busy} onPress={() => choose('estimate')} accessibilityRole="button" testID="target-mode-estimate">
        <Text style={s.title}>{saved ? 'Help me recalculate' : 'Help me set targets'}</Text><Text style={s.detail}>A few questions for an editable starting point.</Text>
      </AnimatedPress>
      <AnimatedPress style={s.help} onPress={() => router.push('/welcome/macros-intro')} accessibilityRole="button" testID="target-macro-help"><Text style={s.link}>What are macros?</Text></AnimatedPress>
    </View>
  </WelcomeScreen>;
}
const s = StyleSheet.create({
  choices: { gap: 14, marginTop: 8 },
  choice: { padding: 22, borderRadius: 22, borderWidth: 1, borderColor: EDITORIAL.border, backgroundColor: EDITORIAL.creamCard, gap: 7 },
  title: { ...TEXT.body, fontSize: 18, color: EDITORIAL.green },
  detail: { ...TEXT.bodySmall, lineHeight: 21 },
  saved: { padding: 20, borderRadius: 22, backgroundColor: EDITORIAL.greenAccentTint, gap: 9 },
  use: { paddingVertical: 14, borderRadius: 28, backgroundColor: EDITORIAL.green, alignItems: 'center', marginTop: 4 },
  useText: { ...TEXT.cta, fontSize: 14 },
  help: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  link: { ...TEXT.bodySmall, color: EDITORIAL.green },
});
