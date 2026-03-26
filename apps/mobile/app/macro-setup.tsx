import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { saveMacroTargets } from '@/lib/macroStorage';
import { PRESETS } from '@/lib/macroPresets';

interface FormValues {
  protein: string;
  carbs: string;
  fat: string;
}

interface FormErrors {
  protein?: string;
  carbs?: string;
  fat?: string;
}

const EMPTY: FormValues = { protein: '', carbs: '', fat: '' };

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
  };
}

function isValid(errors: FormErrors): boolean {
  return !errors.protein && !errors.carbs && !errors.fat;
}

export default function MacroSetupScreen() {
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
    setTouched({ protein: true, carbs: true, fat: true });
    const errs = validateForm(values);
    setErrors(errs);
    if (!isValid(errs)) return;
    await saveMacroTargets(values);
    router.replace('/(tabs)/search');
  }

  function handleSkip() {
    router.replace('/(tabs)/search');
  }

  function applyPreset(preset: (typeof PRESETS)[number]) {
    const next: FormValues = {
      protein: preset.values.protein,
      carbs: preset.values.carbs,
      fat: preset.values.fat,
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
              We&apos;ll use these to surface meals that fit your daily goals.
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
          </View>

          <View style={styles.actions}>
            <Pressable
              style={[styles.saveButton, !formValid && styles.saveButtonDisabled]}
              onPress={handleSave}
              accessibilityRole="button"
              accessibilityLabel={formValid ? 'Save macro targets' : 'Fill in all macro targets to continue'}
            >
              <Text style={styles.saveText}>Save &amp; Continue</Text>
            </Pressable>

            <Pressable
              style={styles.skipButton}
              onPress={handleSkip}
              accessibilityRole="button"
              accessibilityLabel="Skip for now"
              hitSlop={8}
            >
              <Text style={styles.skipText}>Skip for now</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── MacroField sub-component ─────────────────────────────────────────────────

interface MacroFieldProps {
  label: string;
  accessibilityLabel: string;
  value: string;
  error?: string;
  onChangeText: (text: string) => void;
  onBlur: () => void;
}

function MacroField({ label, accessibilityLabel, value, error, onChangeText, onBlur }: MacroFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, error ? styles.inputError : null]}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        keyboardType="numeric"
        returnKeyType="done"
        maxLength={5}
        placeholder="0"
        placeholderTextColor="#9CA3AF"
        accessibilityLabel={accessibilityLabel}
      />
      {error ? (
        <Text
          style={styles.errorText}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  flex: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 40,
    gap: 32,
  },
  header: {
    alignItems: 'center',
    gap: 12,
  },
  emoji: {
    fontSize: 52,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    lineHeight: 22,
    textAlign: 'center',
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  presetPill: {
    backgroundColor: '#F3F4F6',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  presetText: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '500',
  },
  form: {
    gap: 20,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#FFFFFF',
  },
  inputError: {
    borderColor: '#DC2626',
  },
  errorText: {
    fontSize: 13,
    color: '#DC2626',
  },
  actions: {
    gap: 16,
    alignItems: 'center',
  },
  saveButton: {
    width: '100%',
    height: 52,
    backgroundColor: '#2D7D46',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  skipButton: {
    paddingVertical: 8,
  },
  skipText: {
    fontSize: 15,
    color: '#9CA3AF',
  },
});
