import React, { useState, useEffect } from 'react';
import { Alert, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { router, useLocalSearchParams } from 'expo-router';
import { saveMacroTargets } from '@/lib/macroStorage';
import { pushProfileToServer } from '@/lib/profileSync';
import { ScrollPicker, rangeValues } from '@/components/ScrollPicker';
import { useTheme, type ThemeColors } from '@/lib/theme';
import { applySuggestionFilter, type SuggestionFilter } from '@/lib/macroSuggestions';
import { getOnboardingData, calculateSuggestedCalories } from '@/lib/onboardingStorage';

interface MacroValues {
  protein: number;
  carbs: number;
  fat: number;
}

const PICKER_VALUES = {
  protein: rangeValues(50, 300, 5),
  carbs: rangeValues(50, 500, 5),
  fat: rangeValues(20, 150, 2),
};

type DietStyleId = SuggestionFilter['id'] | 'recommended' | 'custom';

const DIET_STYLES: { id: DietStyleId; label: string }[] = [
  { id: 'recommended', label: 'Recommended' },
];

function snapToStep(v: number, step: number): number {
  return Math.round(v / step) * step;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function computeCalories(v: MacroValues): number {
  return v.protein * 4 + v.carbs * 4 + v.fat * 9;
}

export default function MacroSetupScreen() {
  const { colors } = useTheme();
  const { fromOnboarding } = useLocalSearchParams<{ fromOnboarding?: string }>();

  const [values, setValues] = useState<MacroValues>({ protein: 150, carbs: 200, fat: 66 });
  const [suggestedCal, setSuggestedCal] = useState(2000);
  const [activeFilter, setActiveFilter] = useState<DietStyleId>('recommended');
  const [loaded, setLoaded] = useState(false);

  const totalCalories = computeCalories(values);

  useEffect(() => {
    getOnboardingData().then((data) => {
      const suggested = calculateSuggestedCalories(data);
      const cal = snapToStep(suggested, 25);
      setSuggestedCal(cal);
      const protein = clamp(snapToStep(Math.round((cal * 0.3) / 4), 5), 50, 300);
      const carbs = clamp(snapToStep(Math.round((cal * 0.45) / 4), 5), 50, 500);
      const fat = clamp(snapToStep(Math.round((cal * 0.25) / 9), 2), 20, 150);
      setValues({ protein, carbs, fat });
      setLoaded(true);
    });
  }, []);

  function applyDietStyle(filterId: DietStyleId) {
    if (filterId === 'custom') {
      setActiveFilter('custom');
      return;
    }

    if (filterId === 'recommended') {
      const cal = suggestedCal;
      const protein = clamp(snapToStep(Math.round((cal * 0.3) / 4), 5), 50, 300);
      const carbs = clamp(snapToStep(Math.round((cal * 0.45) / 4), 5), 50, 500);
      const fat = clamp(snapToStep(Math.round((cal * 0.25) / 9), 2), 20, 150);
      setValues({ protein, carbs, fat });
      setActiveFilter('recommended');
      return;
    }

    const split = applySuggestionFilter(filterId, String(suggestedCal));
    const protein = clamp(snapToStep(parseInt(split.protein, 10), 5), 50, 300);
    const carbs = clamp(snapToStep(parseInt(split.carbs, 10), 5), 50, 500);
    const fat = clamp(snapToStep(parseInt(split.fat, 10), 2), 20, 150);
    setValues({ protein, carbs, fat });
    setActiveFilter(filterId);
  }

  function updateMacro(key: keyof MacroValues, v: number) {
    setValues((prev) => ({ ...prev, [key]: v }));
    setActiveFilter('custom');
  }

  async function handleSave() {
    try {
      const cal = computeCalories(values);
      const mealTargets = {
        protein: String(Math.round(values.protein / 3)),
        carbs: String(Math.round(values.carbs / 3)),
        fat: String(Math.round(values.fat / 3)),
        calories: String(Math.round(cal / 3)),
      };
      await saveMacroTargets(mealTargets);
      if (!fromOnboarding) pushProfileToServer(); // sync to server (onboarding syncs at payment)
      router.push(fromOnboarding ? '/welcome/how-it-works' : '/(tabs)/search');
    } catch {
      Alert.alert('Save failed', 'Could not save your macro targets. Please try again.');
    }
  }

  function handleSkip() {
    router.push(fromOnboarding ? '/welcome/how-it-works' : '/(tabs)/search');
  }

  const s = createStyles(colors);

  if (!loaded) return <SafeAreaView style={s.container} />;

  const content = (
    <View style={s.contentWrap}>
      {!fromOnboarding && (
        <View style={s.header}>
          <Text style={s.title}>Set your macro targets</Text>
          <Text style={s.subtitle}>
            We recommend ~{suggestedCal} kcal/day based on your profile.
            We'll find restaurants based on your targets.
          </Text>
        </View>
      )}

        <View style={s.pickerSection}>
          {/* Diet style pills */}
          <View style={s.dietRow}>
            {DIET_STYLES.map((ds) => {
              const active = activeFilter === ds.id;
              return (
                <Pressable
                  key={ds.id}
                  style={[s.dietPill, active && s.dietPillActive]}
                  onPress={() => applyDietStyle(ds.id)}
                >
                  <Text style={[s.dietLabel, active && s.dietLabelActive]}>{ds.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Three pickers side by side */}
          <View style={s.pickerRow}>
            <View style={s.pickerCol}>
              <Text style={s.pickerLabel}>Protein</Text>
              <ScrollPicker
                values={PICKER_VALUES.protein}
                value={values.protein}
                unit="g"
                onChange={(v) => updateMacro('protein', v)}
                itemHeight={40}
                visibleItems={5}
              />
            </View>
            <View style={s.pickerCol}>
              <Text style={s.pickerLabel}>Carbs</Text>
              <ScrollPicker
                values={PICKER_VALUES.carbs}
                value={values.carbs}
                unit="g"
                onChange={(v) => updateMacro('carbs', v)}
                itemHeight={40}
                visibleItems={5}
              />
            </View>
            <View style={s.pickerCol}>
              <Text style={s.pickerLabel}>Fat</Text>
              <ScrollPicker
                values={PICKER_VALUES.fat}
                value={values.fat}
                unit="g"
                onChange={(v) => updateMacro('fat', v)}
                itemHeight={40}
                visibleItems={5}
              />
            </View>
          </View>

          {/* Live calories */}
          <View style={s.calorieBar}>
            <Text style={s.calorieLabel}>Daily total</Text>
            <Text style={s.calorieValue}>{totalCalories} kcal</Text>
          </View>
        </View>

        <View style={{ flex: 1 }} />

        {/* Actions */}
        <View style={s.actions}>
          <Pressable style={s.saveButton} onPress={handleSave} accessibilityRole="button">
            <Text style={s.saveText}>Save & Continue</Text>
          </Pressable>
          <Pressable style={s.skipButton} onPress={handleSkip} accessibilityRole="button" hitSlop={8}>
            <Text style={s.skipText}>Skip for now</Text>
          </Pressable>
        </View>
    </View>
  );

  if (fromOnboarding) {
    return (
      <WelcomeScreen
        step={6}
        totalSteps={9}
        title="Set your macro targets"
        subtitle={`We recommend ~${suggestedCal} kcal/day based on your profile. We'll find restaurants based on your targets.`}
        onContinue={handleSave}
        canContinue={true}
        hideFooter={true}
      >
        {content}
      </WelcomeScreen>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.inner}>
        {content}
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    inner: { flex: 1, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 },
    contentWrap: { flex: 1, gap: 16 },
    header: { gap: 6 },
    title: { fontSize: 26, fontWeight: '700', color: colors.textPrimary },
    subtitle: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },

    pickerSection: { gap: 20 },

    dietRow: { flexDirection: 'row', marginBottom: 8 },
    dietPill: {
      alignItems: 'center',
      paddingVertical: 6,
      paddingHorizontal: 14,
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.bgCard,
    },
    dietPillActive: { borderColor: colors.accent, backgroundColor: colors.accentBg },
    dietLabel: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
    dietLabelActive: { color: colors.accent },

    pickerRow: { flexDirection: 'row', gap: 4, height: 40 * 5 + 16, marginTop: 12, marginBottom: 20 },
    pickerCol: { flex: 1, alignItems: 'center', gap: 4 },
    pickerLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8 },

    calorieBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.accentBg,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 20,
    },
    calorieLabel: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
    calorieValue: { fontSize: 22, fontWeight: '800', color: colors.accent },

    actions: { gap: 10, alignItems: 'center' },
    saveButton: {
      width: '100%',
      height: 52,
      backgroundColor: colors.accent,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    saveText: { fontSize: 17, fontWeight: '700', color: colors.accentOnAccent },
    skipButton: { paddingVertical: 6 },
    skipText: { fontSize: 15, color: colors.textTertiary },
  });
}
