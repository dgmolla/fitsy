import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { MacroValues } from '@/lib/macroPresets';

const FIELDS: { key: keyof MacroValues; label: string }[] = [
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'fat', label: 'Fat' },
  { key: 'calories', label: 'Calories' },
];

export interface MacroTargetsEditFormProps {
  draft: MacroValues;
  saveError: string | null;
  onChangeField: (key: keyof MacroValues, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function MacroTargetsEditForm({
  draft,
  saveError,
  onChangeField,
  onSave,
  onCancel,
}: MacroTargetsEditFormProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Macro Targets</Text>
      {FIELDS.map(({ key, label }) => (
        <View key={key} style={styles.editRow}>
          <Text style={styles.editLabel}>{label} (g)</Text>
          <TextInput
            style={styles.editInput}
            value={draft[key]}
            onChangeText={(text) => onChangeField(key, text)}
            keyboardType="numeric"
            returnKeyType="done"
            placeholder="—"
            placeholderTextColor="#9CA3AF"
            accessibilityLabel={`${label} target`}
            maxLength={5}
          />
        </View>
      ))}
      {saveError !== null && (
        <Text style={styles.errorText} accessibilityLiveRegion="polite">{saveError}</Text>
      )}
      <View style={styles.editActions}>
        <Pressable
          style={styles.saveButton}
          onPress={onSave}
          accessibilityRole="button"
          accessibilityLabel="Save macro targets"
        >
          <Text style={styles.saveButtonText}>Save</Text>
        </Pressable>
        <Pressable
          style={styles.cancelButton}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel editing macro targets"
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 12,
  },
  editLabel: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  editInput: {
    width: 80,
    height: 40,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#F9FAFB',
    textAlign: 'center',
  },
  editActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  saveButton: {
    flex: 1,
    height: 44,
    backgroundColor: '#2D7D46',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  cancelButton: {
    flex: 1,
    height: 44,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#374151',
  },
  errorText: {
    fontSize: 13,
    color: '#DC2626',
    marginBottom: 8,
  },
});
