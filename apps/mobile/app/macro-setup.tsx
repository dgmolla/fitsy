import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { saveMacroTargets } from '@/lib/macroStorage';
import { PRESETS } from '@/lib/macroPresets';
import { MacroField } from '@/components';
import { useTheme } from '@/lib/theme';
import { createStyles } from './macro-setup.styles';

interface FormValues {
  protein: string;
  carbs: string;
  fat: string;
  calories: string;
}

interface FormErrors {
  protein?: string;
  carbs?: string;
  fat?: string;
  calories?: string;
}

const EMPTY: FormValues = { protein: '', carbs: '', fat: '', calories: '' };

function validateField(value: string): string | undefined {
  if (value.trim() === '') return 'Required';
  const n = parseFloat(value);
  if (isNaN(n) || n <= 0) return 'Must be a positive number';
  return undefined;
}

function validateForm(values: FormValues): FormErrors {
  return {
    protein: validateField(values.protein),
    carbs: validateField(values.carbs),
    fat: validateField(values.fat),
    calories: validateField(values.calories),
  };
}

function isValid(errors: FormErrors): boolean {
  return !errors.protein && !errors.carbs && !errors.fat && !errors.calories;
}

export default function MacroSetupScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof FormValues, boolean>>>({});

  function handleChange(field: keyof FormValues, text: string) {
    const next = { ...values, [field]: text };
    setValues(next);
    if (touched[field]) {
      setErrors((prev) => ({ ...prev, [field]: validateField(text) }));
    }
  }

  function handleBlur(field: keyof FormValues) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors((prev) => ({ ...prev, [field]: validateField(values[field]) }));
  }

  async function handleSave() {
    setTouched({ protein: true, carbs: true, fat: true, calories: true });
    const errs = validateForm(values);
    setErrors(errs);
    if (!isValid(errs)) return;
    try {
      await saveMacroTargets(values);
      router.replace('/(tabs)/search');
    } catch (e) {
      Alert.alert(
        'Save failed',
        'Could not save your macro targets. Please try again.',
        [{ text: 'OK' }],
      );
    }
  }

  function handleSkip() {
    router.replace('/(tabs)/search');
  }

  function applyPreset(preset: (typeof PRESETS)[number]) {
    const next: FormValues = {
      protein: preset.values.protein,
      carbs: preset.values.carbs,
      fat: preset.values.fat,
      calories: preset.values.calories,
    };
    setValues(next);
    setErrors({});
    setTouched({});
  }

  const formValid = isValid(validateForm(values));

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={styles.emoji}>🎯</Text>
            <Text style={styles.title}>Set your macro targets</Text>
            <Text style={styles.subtitle}>
              We'll use these to surface meals that fit your daily goals.
            </Text>
          </View>

          <View style={styles.presetRow}>
            {PRESETS.map((preset) => (
              <Pressable
                key={preset.label}
                style={styles.presetPill}
                onPress={() => applyPreset(preset)}
                accessibilityRole="button"
                accessibilityLabel={`Apply ${preset.label} preset`}
              >
                <Text style={styles.presetText}>{preset.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.form}>
            <MacroField
              label="Protein (g)"
              accessibilityLabel="Daily protein target in grams"
              value={values.protein}
              error={touched.protein ? errors.protein : undefined}
              onChangeText={(t) => handleChange('protein', t)}
              onBlur={() => handleBlur('protein')}
            />
            <MacroField
              label="Carbs (g)"
              accessibilityLabel="Daily carbohydrate target in grams"
              value={values.carbs}
              error={touched.carbs ? errors.carbs : undefined}
              onChangeText={(t) => handleChange('carbs', t)}
              onBlur={() => handleBlur('carbs')}
            />
            <MacroField
              label="Fat (g)"
              accessibilityLabel="Daily fat target in grams"
              value={values.fat}
              error={touched.fat ? errors.fat : undefined}
              onChangeText={(t) => handleChange('fat', t)}
              onBlur={() => handleBlur('fat')}
            />
            <MacroField
              label="Calories (kcal)"
              accessibilityLabel="Daily calorie target in kilocalories"
              value={values.calories}
              error={touched.calories ? errors.calories : undefined}
              onChangeText={(t) => handleChange('calories', t)}
              onBlur={() => handleBlur('calories')}
            />
          </View>

          <View style={styles.actions}>
            <Pressable
              style={[styles.saveButton, !formValid && styles.saveButtonDisabled]}
              onPress={handleSave}
              accessibilityRole="button"
              accessibilityLabel={formValid ? 'Save macro targets' : 'Fill in all macro targets to continue'}
              accessibilityState={{ disabled: !formValid }}
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
