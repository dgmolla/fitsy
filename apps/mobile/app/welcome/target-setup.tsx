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

type Mode = 'saved' | 'known' | 'estimate';
function TargetSetupScreen() {
  useOnboardingStep('target-setup');
  const { begin } = useRouteContinuation();
  const [saved, setSaved] = useState<StoredMacroTargets | null>(null);
  const [mode, setMode] = useState<Mode>('known');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  useFocusEffect(useCallback(() => {
    let live = true;
    setReady(false);
    setBusy(false);
    void Promise.all([getMacroTargets(), getOnboardingData()]).then(async ([targets, data]) => {
      if (!live) return;
      if (!data.goal) {
        setReady(false);
        await rememberGoalReturnTo('/welcome/target-setup');
        if (live) router.replace('/welcome/goal');
        return;
      }
      setSaved(targets);
      setMode(data.targetChoiceInProgress && data.targetMode ? data.targetMode : targets ? 'saved' : data.targetMode ?? 'known');
      setReady(true);
    });
    return () => { live = false; };
  }, []));
  async function saveSelection(): Promise<'known' | 'estimate'> {
    const nextMode = mode === 'saved' ? 'known' : mode;
    await saveOnboardingField('targetMode', nextMode);
    await saveOnboardingField('targetChoiceInProgress', mode !== 'saved');
    return nextMode;
  }
  async function showMacroHelp() {
    if (busy || !ready) return;
    const isCurrent = begin();
    setBusy(true);
    try {
      await saveSelection();
      if (isCurrent()) router.push('/welcome/macros-intro');
    } catch { if (isCurrent()) Alert.alert('Could not save your choice', 'Please try again.'); }
    finally { if (isCurrent()) setBusy(false); }
  }
  async function choose() {
    if (busy || !ready) return;
    const isCurrent = begin();
    setBusy(true);
    try {
      const nextMode = await saveSelection();
      if (nextMode === 'estimate') await saveOnboardingField('targetBasis', undefined);
      if (!isCurrent()) return;
      trackOnboardingChoiceSelected({ screen: 'target_setup', value: mode });
      router.push(mode === 'saved' ? '/welcome/how-it-works' : nextMode === 'known' ? '/welcome/tuning' : '/welcome/height');
    } catch { if (isCurrent()) Alert.alert('Could not save your choice', 'Please try again.'); }
    finally { if (isCurrent()) setBusy(false); }
  }
  return <WelcomeScreen progress={0.45} title={"Your meal.\nYour targets."} subtitle="Choose how you'd like to get started."
    canContinue={ready && !busy} onContinue={() => choose()}
    footerContent={<WelcomeActions label="Continue" onPress={() => choose()} disabled={!ready || busy}
      secondaryLabel="What are macros?" onSecondary={() => showMacroHelp()} secondaryTestID="target-macro-help" />}>
    <View style={s.choices}>
      {saved && <AnimatedPress style={[s.choice, mode === 'saved' && s.selected]} disabled={!ready || busy} onPress={() => setMode('saved')}
        accessibilityRole="radio" accessibilityState={{ checked: mode === 'saved' }} testID="target-mode-saved">
        <View style={s.copy}><Text style={s.title}>Use saved meal targets</Text>
          <Text style={s.detail}>{saved.calories} kcal · {saved.protein}g protein · {saved.carbs}g carbs · {saved.fat}g fat</Text></View>
        <Ionicons name={mode === 'saved' ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={mode === 'saved' ? EDITORIAL.greenAccent : EDITORIAL.textSoft} />
      </AnimatedPress>}
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
  choices: { gap: 10, marginTop: 4 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 74, borderRadius: 20, borderWidth: 1, borderColor: EDITORIAL.border, backgroundColor: EDITORIAL.cream },
  selected: { borderColor: EDITORIAL.greenAccent, backgroundColor: EDITORIAL.greenAccentTint },
  copy: { flex: 1, gap: 4 },
  title: { ...TEXT.body, fontSize: 16, color: EDITORIAL.green },
  detail: { ...TEXT.bodySmall, lineHeight: 21 },
});

export default requireWelcomeGoal(TargetSetupScreen, '/welcome/target-setup');
