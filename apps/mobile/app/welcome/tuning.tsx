import { useOnboardingStep } from '@/lib/onboardingResume';
import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { getOnboardingData, saveOnboardingField, type Goal } from '@/lib/onboardingStorage';
import { getMacroTargets, saveMacroTargets, type StoredMacroTargets } from '@/lib/macroStorage';
import { calculateMacros } from '@/lib/macroCalculator';

const FIELDS = [['calories', 'Calories', 'kcal'], ['protein', 'Protein', 'g'], ['carbs', 'Carbs', 'g'], ['fat', 'Fat', 'g']] as const;
const GOALS = [['lose_fat', 'Lose fat'], ['maintain', 'Maintain'], ['build_muscle', 'Build muscle']] as const;
const empty: StoredMacroTargets = { calories: '', protein: '', carbs: '', fat: '' };
const asStrings = (values: ReturnType<typeof calculateMacros>): StoredMacroTargets => ({
  calories: String(values.calories), protein: String(values.protein), carbs: String(values.carbs), fat: String(values.fat),
});

export default function PlanReadyScreen() {
  useOnboardingStep('tuning');
  const [targets, setTargets] = useState(empty);
  const [data, setData] = useState<Awaited<ReturnType<typeof getOnboardingData>>>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  // Store the profile basis separately from edited targets. Back must not
  // silently replace manual edits unless the underlying answers changed.
  const basisOf = (d: typeof data) => JSON.stringify([d.targetMode, d.goal, d.heightCm, d.weightKg, d.birthday, d.sex, d.activity]);
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void Promise.all([getOnboardingData(), getMacroTargets()]).then(([d, saved]) => {
      if (cancelled) return;
      setData(d);
      setTargets(saved && (d.targetMode === 'known' || d.targetBasis === basisOf(d)) ? saved : d.targetMode === 'known' ? empty : asStrings(calculateMacros(d)));
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []));

  const valid = FIELDS.every(([key]) => targets[key].trim() !== '' && Number.isFinite(Number(targets[key]))
    && Number(targets[key]) >= (key === 'calories' ? 1 : 0) && Number(targets[key]) <= (key === 'calories' ? 4000 : 500));
  async function pickGoal(goal: Goal) {
    const next = { ...data, goal };
    setData(next);
    setTargets(asStrings(calculateMacros(next)));
    await saveOnboardingField('goal', goal);
  }
  async function proceed() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await saveMacroTargets(targets);
      await saveOnboardingField('targetBasis', basisOf(data));
      router.push('/welcome/preview');
    } catch { Alert.alert('Could not save targets', 'Please try again.'); }
    finally { setBusy(false); }
  }

  return (
    <WelcomeScreen title={"A target for\nyour next meal."} subtitle={data.targetMode === 'known' ? 'Enter per-meal targets. You can change these anytime.' : 'Estimated from your answers, with room for snacks. Tap any number to make it yours.'}
      onContinue={proceed} canContinue={ready && valid && !busy} continueLabel="Find my meal picks">
      <View style={s.grid}>
        {FIELDS.map(([key, label, unit]) => (
          <View key={key} style={s.cell}>
            <Text style={s.label}>{label} / meal</Text>
            <View style={s.inputRow}>
              <TextInput style={s.input} keyboardType="decimal-pad" value={targets[key]} editable={ready && !busy} selectTextOnFocus
                onChangeText={value => setTargets(previous => ({ ...previous, [key]: value.replace(/[^0-9.]/g, '') }))}
                accessibilityLabel={`${label} per meal`} testID={`meal-target-${key}`} placeholder="0" maxLength={7} />
              <Text style={s.unit}>{unit}</Text>
            </View>
          </View>
        ))}
      </View>
      {data.targetMode !== 'known' && <View style={s.goals}>
        {GOALS.map(([goal, label]) => <AnimatedPress key={goal} style={[s.goal, (data.goal ?? 'maintain') === goal && s.selected]}
          disabled={busy} onPress={() => pickGoal(goal)} accessibilityRole="button" accessibilityState={{ selected: (data.goal ?? 'maintain') === goal }} testID={`meal-goal-${goal}`}>
          <Text style={[s.goalText, (data.goal ?? 'maintain') === goal && s.selectedText]}>{label}</Text>
        </AnimatedPress>)}
      </View>}
      <Text style={s.note}>Fitsy ranks dishes against these meal targets. Nutrition estimates and portion sizes can vary.</Text>
    </WelcomeScreen>
  );
}
const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  cell: { width: '47%', padding: 14, backgroundColor: EDITORIAL.creamCard, borderRadius: 16 },
  label: { ...TEXT.bodySmall, fontSize: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: { ...TEXT.headline, fontSize: 30, flex: 1, minHeight: 52 },
  unit: { ...TEXT.bodySmall },
  goals: { gap: 8 },
  goal: { borderRadius: 16, padding: 14, borderWidth: 1, borderColor: EDITORIAL.border },
  selected: { backgroundColor: EDITORIAL.green },
  goalText: { ...TEXT.body, textAlign: 'center' },
  selectedText: { color: EDITORIAL.cream },
  note: { ...TEXT.bodySmall, fontSize: 12, lineHeight: 18, marginTop: 24 },
});
