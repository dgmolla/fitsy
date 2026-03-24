import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { PRESETS, type MacroValues, type Preset } from '@/lib/macroPresets';

export type { MacroValues, Preset };
export { PRESETS };

export interface MacroInputBarProps {
  values: MacroValues;
  onChange: (field: keyof MacroValues, text: string) => void;
  onChangeAll?: (values: MacroValues) => void;
}

const FIELDS: { key: keyof MacroValues; label: string }[] = [
  { key: 'protein', label: 'Protein (g)' },
  { key: 'carbs', label: 'Carbs (g)' },
  { key: 'fat', label: 'Fat (g)' },
  { key: 'calories', label: 'Cals' },
];

const EMPTY_VALUES: MacroValues = { protein: '', carbs: '', fat: '', calories: '' };

export function MacroInputBar({ values, onChange, onChangeAll }: MacroInputBarProps) {
  function handleClear() {
    if (onChangeAll) {
      onChangeAll(EMPTY_VALUES);
    } else {
      (Object.keys(EMPTY_VALUES) as (keyof MacroValues)[]).forEach((field) => {
        onChange(field, '');
      });
    }
  }

  function handlePreset(preset: Preset) {
    if (onChangeAll) {
      onChangeAll(preset.values);
    } else {
      (Object.keys(preset.values) as (keyof MacroValues)[]).forEach((field) => {
        onChange(field, preset.values[field]);
      });
    }
  }

  return (
    <View style={styles.wrapper}>
      {/* Input row */}
      <View style={styles.inputRow}>
        {FIELDS.map(({ key, label }) => (
          <View key={key} style={styles.macroField}>
            <Text style={styles.macroLabel}>{label}</Text>
            <TextInput
              style={styles.macroInput}
              value={values[key]}
              onChangeText={(text) => onChange(key, text)}
              keyboardType="numeric"
              placeholder="—"
              placeholderTextColor="#9CA3AF"
              returnKeyType="done"
              accessibilityLabel={`${label} target`}
              maxLength={5}
            />
          </View>
        ))}

        <TouchableOpacity
          style={styles.clearButton}
          onPress={handleClear}
          accessibilityLabel="Clear macro targets"
        >
          <Text style={styles.clearButtonText}>Clear</Text>
        </TouchableOpacity>
      </View>

      {/* Preset pill row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.presetRow}
        keyboardShouldPersistTaps="handled"
      >
        {PRESETS.map((preset) => (
          <TouchableOpacity
            key={preset.label}
            style={styles.presetPill}
            onPress={() => handlePreset(preset)}
            accessibilityLabel={`Apply ${preset.label} preset`}
          >
            <Text style={styles.presetPillText}>{preset.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#D1D5DB',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 8,
  },
  macroField: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  macroLabel: {
    fontSize: 10,
    color: '#6B7280',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  macroInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 6,
    fontSize: 14,
    color: '#111827',
    textAlign: 'center',
    backgroundColor: '#F9FAFB',
  },
  clearButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    alignSelf: 'flex-end',
    marginBottom: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  clearButtonText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  presetRow: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 8,
    flexDirection: 'row',
  },
  presetPill: {
    backgroundColor: '#F3F4F6',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  presetPillText: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '500',
  },
});
