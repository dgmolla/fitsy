import React, { useState, useEffect } from 'react';
import { Alert, Pressable, SafeAreaView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { saveMacroTargets } from '@/lib/macroStorage';
import { MacroScrollPicker } from '@/components/MacroScrollPicker';
import { useTheme } from '@/lib/theme';
import { createStyles } from './macro-setup.styles';
import { SUGGESTION_FILTERS, applySuggestionFilter } from '@/lib/macroSuggestions';
import { getOnboardingData, calculateSuggestedCalories } from '@/lib/onboardingStorage';

interface FormValues {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
}

function snapToStep(v: number, step: number): number {
  return Math.round(v / step) * step;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export default function MacroSetupScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { fromOnboarding } = useLocalSearchParams<{ fromOnboarding?: string }>();

  const [values, setValues] = useState<FormValues>({
    protein: 150,
    carbs: 200,
    fat: 66,
    calories: 2000,
  });
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getOnboardingData().then((data) => {
      const suggestedCalories = calculateSuggestedCalories(data);
      const cal = snapToStep(suggestedCalories, 25);
      // Balanced macro split: ~30% protein, ~45% carbs, ~25% fat
      const protein = clamp(snapToStep(Math.round((cal * 0.3) / 4), 5), 50, 300);
      const carbs = clamp(snapToStep(Math.round((cal * 0.45) / 4), 5), 50, 500);
      const fat = clamp(snapToStep(Math.round((cal * 0.25) / 9), 2), 20, 150);
      const calories = clamp(cal, 1200, 3500);
      setValues({ protein, carbs, fat, calories });
      setLoaded(true);
    });
  }, []);

  async function handleSave() {
    try {
      const mealTargets = {
        protein: String(Math.round(values.protein / 3)),
        carbs: String(Math.round(values.carbs / 3)),
        fat: String(Math.round(values.fat / 3)),
        calories: String(Math.round(values.calories / 3)),
      };
      await saveMacroTargets(mealTargets);
      if (fromOnboarding) {
        router.push('/welcome/signin');
      } else {
        router.replace('/(tabs)/search');
      }
    } catch {
      Alert.alert('Save failed', 'Could not save your macro targets. Please try again.', [
        { text: 'OK' },
      ]);
    }
  }

  function handleSkip() {
    if (fromOnboarding) {
      router.push('/welcome/signin');
    } else {
      router.replace('/(tabs)/search');
    }
  }

  function handleSuggestionFilter(filterId: (typeof SUGGESTION_FILTERS)[number]['id']) {
    const split = applySuggestionFilter(filterId, String(values.calories));
    const protein = clamp(snapToStep(parseInt(split.protein, 10), 5), 50, 300);
    const carbs = clamp(snapToStep(parseInt(split.carbs, 10), 5), 50, 500);
    const fat = clamp(snapToStep(parseInt(split.fat, 10), 2), 20, 150);
    setValues((prev) => ({ ...prev, protein, carbs, fat }));
    setActiveFilter(filterId === activeFilter ? null : filterId);
  }

  if (!loaded) return <SafeAreaView style={styles.container} />;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.header}>
          <Text style={styles.emoji}>🎯</Text>
          <Text style={styles.title}>Set your macro targets</Text>
          <Text style={styles.subtitle}>
            Enter your daily targets — we'll find meals that fit ~1/3 of them.
          </Text>
        </View>

        <View style={styles.suggestionsSection}>
          <Text style={styles.suggestionsLabel}>Diet style</Text>
          <View style={styles.suggestionsRow}>
            {SUGGESTION_FILTERS.map((filter) => {
              const active = activeFilter === filter.id;
              return (
                <Pressable
                  key={filter.id}
                  style={[styles.suggestionPill, active && styles.suggestionPillActive]}
                  onPress={() => handleSuggestionFilter(filter.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Apply ${filter.label} macro split`}
                  accessibilityHint={filter.hint}
                  accessibilityState={{ selected: active }}
                >
                  <Text style={styles.suggestionIcon}>{filter.icon}</Text>
                  <Text style={[styles.suggestionText, active && styles.suggestionTextActive]}>
                    {filter.label}
                  </Text>
                  <Text style={styles.suggestionHint}>{filter.hint}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.pickerGrid}>
          <View style={styles.pickerRow}>
            <MacroScrollPicker
              label="Protein"
              value={values.protein}
              min={50}
              max={300}
              step={5}
              unit="g / day"
              onChange={(v) => setValues((prev) => ({ ...prev, protein: v }))}
            />
            <MacroScrollPicker
              label="Carbs"
              value={values.carbs}
              min={50}
              max={500}
              step={5}
              unit="g / day"
              onChange={(v) => setValues((prev) => ({ ...prev, carbs: v }))}
            />
          </View>
          <View style={styles.pickerRow}>
            <MacroScrollPicker
              label="Fat"
              value={values.fat}
              min={20}
              max={150}
              step={2}
              unit="g / day"
              onChange={(v) => setValues((prev) => ({ ...prev, fat: v }))}
            />
            <MacroScrollPicker
              label="Calories"
              value={values.calories}
              min={1200}
              max={3500}
              step={25}
              unit="kcal / day"
              onChange={(v) => setValues((prev) => ({ ...prev, calories: v }))}
            />
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={styles.saveButton}
            onPress={handleSave}
            accessibilityRole="button"
            accessibilityLabel="Save macro targets"
          >
            <Text style={styles.saveText}>Save & Continue</Text>
          </Pressable>

          <Pressable
            style={styles.skipButton}
            onPress={handleSkip}
            accessibilityRole="button"
            accessibilityLabel="Skip for now"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.skipText}>Skip for now</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
