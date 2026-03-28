import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/lib/theme';
import { PRESETS, type MacroValues } from '@/lib/macroPresets';

const FIELDS: { key: keyof MacroValues; label: string; unit: string }[] = [
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
  { key: 'calories', label: 'Calories', unit: 'kcal' },
];

export default function FilterScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<Record<string, string>>();
  const [draft, setDraft] = useState<MacroValues>({
    protein: params.protein ?? '',
    carbs: params.carbs ?? '',
    fat: params.fat ?? '',
    calories: params.calories ?? '',
  });

  useEffect(() => {
    setDraft({
      protein: params.protein ?? '',
      carbs: params.carbs ?? '',
      fat: params.fat ?? '',
      calories: params.calories ?? '',
    });
  }, [params.protein, params.carbs, params.fat, params.calories]);

  function handleApply() {
    router.back();
    // Pass values back via params — search screen reads from storage
    // We save to storage here so search screen picks it up
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    AsyncStorage.setItem('fitsy:macroTargets', JSON.stringify(draft)).catch(() => {});
  }

  function handleClear() {
    setDraft({ protein: '', carbs: '', fat: '', calories: '' });
  }

  function handlePreset(values: MacroValues) {
    setDraft(values);
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.headerAction, { color: colors.textSecondary }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Filters</Text>
        <Pressable onPress={handleClear} hitSlop={12}>
          <Text style={[styles.headerAction, { color: colors.textSecondary }]}>Clear</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>MACRO TARGETS</Text>

        {FIELDS.map(({ key, label, unit }) => (
          <View
            key={key}
            style={[styles.fieldRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
          >
            <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>{label}</Text>
            <View style={styles.fieldInputWrap}>
              <TextInput
                style={[styles.fieldInput, { color: colors.textPrimary }]}
                value={draft[key]}
                onChangeText={(text) => setDraft((prev) => ({ ...prev, [key]: text }))}
                keyboardType="numeric"
                placeholder="—"
                placeholderTextColor={colors.textTertiary}
                maxLength={5}
              />
              <Text style={[styles.fieldUnit, { color: colors.textTertiary }]}>{unit}</Text>
            </View>
          </View>
        ))}

        <Text style={[styles.sectionTitle, { color: colors.textTertiary, marginTop: 24 }]}>PRESETS</Text>

        {PRESETS.map((preset) => (
          <Pressable
            key={preset.label}
            style={[styles.presetRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
            onPress={() => handlePreset(preset.values)}
          >
            <Text style={[styles.presetLabel, { color: colors.textPrimary }]}>{preset.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.bg, borderTopColor: colors.borderSubtle }]}>
        <Pressable
          style={[styles.applyButton, { backgroundColor: colors.accent }]}
          onPress={handleApply}
        >
          <Text style={[styles.applyText, { color: colors.accentOnAccent }]}>Apply Filters</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 60,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  headerAction: {
    fontSize: 16,
    fontWeight: '500',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 18,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  fieldInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  fieldInput: {
    fontSize: 18,
    fontWeight: '600',
    minWidth: 50,
    textAlign: 'right',
  },
  fieldUnit: {
    fontSize: 14,
    fontWeight: '500',
  },
  presetRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  presetLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  footer: {
    padding: 18,
    paddingBottom: 36,
    borderTopWidth: 1,
  },
  applyButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  applyText: {
    fontSize: 17,
    fontWeight: '700',
  },
});
