import { requireWelcomeGoal } from '@/lib/requireWelcomeGoal';
import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { WelcomeActions } from '@/components/WelcomeActions';
import { AnimatedPress } from '@/components/AnimatedPress';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { rememberGoalReturnTo, useOnboardingStep } from '@/lib/onboardingResume';
import { getOnboardingData, saveOnboardingField } from '@/lib/onboardingStorage';
import { getMacroTargets, type StoredMacroTargets } from '@/lib/macroStorage';
import { trackOnboardingChoiceSelected } from '@/lib/analytics';
import { useRouteContinuation } from '@/lib/useRouteContinuation';

type Mode = 'known' | 'estimate';
function TargetSetupScreen() {
  useOnboardingStep('target-setup');
  const { begin } = useRouteContinuation();
  const [saved, setSaved] = useState<StoredMacroTargets | null>(null);
  const [mode, setMode] = useState<Mode>('known');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  useFocusEffect(useCallback(() => {
    let live = true;
    void Promise.all([getMacroTargets(), getOnboardingData()]).then(async ([targets, data]) => {
      if (!live) return;
      if (!data.goal) {
        setReady(false);
        await rememberGoalReturnTo('/welcome/target-setup');
        if (live) router.replace('/welcome/goal');
        return;
      }
      setSaved(targets); setMode(data.targetMode ?? 'known'); setReady(true);
    });
    return () => { live = false; };
  }, []));
  async function choose(useSaved = false) {
    if (busy || !ready) return;
    const isCurrent = begin();
    setBusy(true);
    const nextMode = useSaved ? 'known' : mode;
    try {
      await saveOnboardingField('targetMode', nextMode);
      if (nextMode === 'estimate') await saveOnboardingField('targetBasis', undefined);
      if (!isCurrent()) return;
      trackOnboardingChoiceSelected({ screen: 'target_setup', value: useSaved ? 'saved' : nextMode });
      router.push(useSaved ? '/welcome/how-it-works' : nextMode === 'known' ? '/welcome/tuning' : '/welcome/height');
    } catch { if (isCurrent()) Alert.alert('Could not save your choice', 'Please try again.'); }
    finally { if (isCurrent()) setBusy(false); }
  }
  const label = mode === 'known' ? (saved ? 'Edit my meal targets' : 'Enter my meal targets') : 'Help me set targets';
  return <WelcomeScreen progress={0.45} title={"Your meal.\nYour targets."} subtitle="Choose how you'd like to get started."
    canContinue={ready && !busy} onContinue={() => choose()}
    footerContent={<WelcomeActions label={label} onPress={() => choose()} disabled={!ready || busy}
      secondaryLabel="What are macros?" onSecondary={() => router.push('/welcome/macros-intro')} secondaryTestID="target-macro-help" />}>
    <View style={s.choices}>
      {saved && <View style={s.saved} testID="target-saved-summary">
        <Text style={s.title}>Your saved meal targets</Text>
        <Text style={s.detail}>{saved.calories} kcal · {saved.protein}g protein{'\n'}{saved.carbs}g carbs · {saved.fat}g fat</Text>
        <AnimatedPress style={s.use} disabled={!ready || busy} onPress={() => choose(true)} accessibilityRole="button" testID="target-use-saved"><Text style={s.useText}>Use these meal targets</Text></AnimatedPress>
      </View>}
      {([
        ['known', saved ? 'Edit my meal targets' : 'Enter my meal targets', 'Calories, protein, carbs and fat. Skip body questions.'],
        ['estimate', 'Help me set targets', 'A few questions for an editable starting point.'],
      ] as const).map(([value, title, detail]) => <AnimatedPress key={value} style={[s.choice, mode === value && s.selected]}
        disabled={!ready || busy} onPress={() => setMode(value)} accessibilityRole="radio" accessibilityState={{ checked: mode === value }} testID={`target-mode-${value}`}>
        <View style={s.copy}><Text style={s.title}>{title}</Text><Text style={s.detail}>{detail}</Text></View>
        <Ionicons name={mode === value ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={mode === value ? EDITORIAL.greenAccent : EDITORIAL.textSoft} />
      </AnimatedPress>)}
    </View>
  </WelcomeScreen>;
}
const s = StyleSheet.create({
  choices: { gap: 14, marginTop: 8 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 18, borderRadius: 22, borderWidth: 1, borderColor: EDITORIAL.border, backgroundColor: EDITORIAL.cream },
  selected: { borderColor: EDITORIAL.greenAccent, backgroundColor: EDITORIAL.greenAccentTint },
  copy: { flex: 1, gap: 7 },
  title: { ...TEXT.body, fontSize: 16, color: EDITORIAL.green },
  detail: { ...TEXT.bodySmall, lineHeight: 21 },
  saved: { padding: 20, borderRadius: 22, backgroundColor: EDITORIAL.greenAccentTint, gap: 9 },
  use: { minHeight: 48, justifyContent: 'center', paddingVertical: 14, borderRadius: 28, backgroundColor: EDITORIAL.green, alignItems: 'center', marginTop: 4 },
  useText: { ...TEXT.cta, fontSize: 14 },
});

export default requireWelcomeGoal(TargetSetupScreen, '/welcome/target-setup');
