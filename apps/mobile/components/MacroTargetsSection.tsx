import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { MacroValues } from '@/lib/macroPresets';

export interface MacroTargetsSectionProps {
  targets: MacroValues | null;
  onSave: (values: MacroValues) => Promise<void>;
  onSetupPress: () => void;
}

const FIELDS: { key: keyof MacroValues; label: string }[] = [
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'fat', label: 'Fat' },
  { key: 'calories', label: 'Calories' },
];

export function MacroTargetsSection({ targets, onSave, onSetupPress }: MacroTargetsSectionProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<MacroValues>({ protein: '', carbs: '', fat: '', calories: '' });
  const [saveError, setSaveError] = useState<string | null>(null);

  function handleEditPress() {
    if (targets) {
      setDraft({ ...targets });
    }
    setSaveError(null);
    setEditing(true);
  }

  function handleCancel() {
    setEditing(false);
    setSaveError(null);
  }

  async function handleSave() {
    try {
      await onSave(draft);
      setEditing(false);
      setSaveError(null);
    } catch {
      setSaveError('Failed to save. Please try again.');
    }
  }

  if (editing) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Macro Targets</Text>
        {FIELDS.map(({ key, label }) => (
          <View key={key} style={styles.editRow}>
            <Text style={styles.editLabel}>{label} (g)</Text>
            <TextInput
              style={styles.editInput}
              value={draft[key]}
              onChangeText={(text) => setDraft((prev) => ({ ...prev, [key]: text }))}
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
            onPress={handleSave}
            accessibilityRole="button"
            accessibilityLabel="Save macro targets"
          >
            <Text style={styles.saveButtonText}>Save</Text>
          </Pressable>
          <Pressable
            style={styles.cancelButton}
            onPress={handleCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel editing macro targets"
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!targets || !FIELDS.some(({ key }) => targets[key] !== '')) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Macro Targets</Text>
        <Text style={styles.emptyText}>No macro targets set yet.</Text>
        <Pressable
          style={styles.ctaButton}
          onPress={onSetupPress}
          accessibilityRole="button"
          accessibilityLabel="Set up macro targets"
        >
          <Text style={styles.ctaButtonText}>Set up macro targets</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Macro Targets</Text>
        <Pressable
          onPress={handleEditPress}
          accessibilityRole="button"
          accessibilityLabel="Edit macro targets"
          hitSlop={8}
        >
          <Text style={styles.editLink}>Edit</Text>
        </Pressable>
      </View>
      <View style={styles.macroGrid}>
        {FIELDS.map(({ key, label }) => (
          <View key={key} style={styles.macroCard}>
            <Text style={styles.macroValue}>{targets[key] || '—'}</Text>
            <Text style={styles.macroLabel}>{label}</Text>
          </View>
        ))}
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
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  macroGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  macroCard: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  macroValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2D7D46',
  },
  macroLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
    textAlign: 'center',
  },
  editLink: {
    fontSize: 14,
    color: '#2D7D46',
    fontWeight: '600',
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
  emptyText: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 12,
  },
  ctaButton: {
    height: 44,
    backgroundColor: '#2D7D46',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  errorText: {
    fontSize: 13,
    color: '#DC2626',
    marginBottom: 8,
  },
});
