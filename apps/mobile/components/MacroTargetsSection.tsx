import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { MacroValues } from '@/lib/macroPresets';
import { useTheme } from '@/lib/theme';

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
  const { colors } = useTheme();
  const glassSection = {
    backgroundColor: colors.bgCard,
    borderColor: colors.border,
    shadowColor: colors.glassShadowColor,
    shadowOpacity: colors.glassShadowOpacity,
    shadowRadius: colors.glassShadowRadius,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  } as const;
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
      <View style={[styles.section, glassSection]}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Macro Targets</Text>
        {FIELDS.map(({ key, label }) => (
          <View key={key} style={styles.editRow}>
            <Text style={[styles.editLabel, { color: colors.textSecondary }]}>{label} (g)</Text>
            <TextInput
              style={[styles.editInput, { borderColor: colors.border, color: colors.textPrimary, backgroundColor: colors.bg }]}
              value={draft[key]}
              onChangeText={(text) => setDraft((prev) => ({ ...prev, [key]: text }))}
              keyboardType="numeric"
              returnKeyType="done"
              placeholder="--"
              placeholderTextColor={colors.inputPlaceholder}
              accessibilityLabel={`${label} target`}
              maxLength={5}
            />
          </View>
        ))}
        {saveError !== null && (
          <Text style={[styles.errorText, { color: colors.error }]} accessibilityLiveRegion="polite">{saveError}</Text>
        )}
        <View style={styles.editActions}>
          <Pressable
            style={[styles.saveButton, { backgroundColor: colors.accent }]}
            onPress={handleSave}
            accessibilityRole="button"
            accessibilityLabel="Save macro targets"
          >
            <Text style={[styles.saveButtonText, { color: colors.accentOnAccent }]}>Save</Text>
          </Pressable>
          <Pressable
            style={[styles.cancelButton, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
            onPress={handleCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel editing macro targets"
          >
            <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!targets || !FIELDS.some(({ key }) => targets[key] !== '')) {
    return (
      <View style={[styles.section, glassSection]}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Macro Targets</Text>
        <Text style={[styles.emptyText, { color: colors.textTertiary }]}>No macro targets set yet.</Text>
        <Pressable
          style={[styles.ctaButton, { backgroundColor: colors.accent }]}
          onPress={onSetupPress}
          accessibilityRole="button"
          accessibilityLabel="Set up macro targets"
        >
          <Text style={[styles.ctaButtonText, { color: colors.accentOnAccent }]}>Set up macro targets</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.section, glassSection]}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Macro Targets</Text>
        <Pressable
          onPress={handleEditPress}
          accessibilityRole="button"
          accessibilityLabel="Edit macro targets"
          hitSlop={8}
        >
          <Text style={[styles.editLink, { color: colors.accent }]}>Edit</Text>
        </Pressable>
      </View>
      <View style={styles.macroGrid}>
        {FIELDS.map(({ key, label }) => (
          <View key={key} style={[styles.macroCard, { backgroundColor: colors.bg, borderColor: colors.border }]}>
            <Text style={[styles.macroValue, { color: colors.accent }]}>{targets[key] || '--'}</Text>
            <Text style={[styles.macroLabel, { color: colors.textTertiary }]}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  macroGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  macroCard: {
    flex: 1,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
  },
  macroValue: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  macroLabel: {
    fontSize: 10,
    marginTop: 3,
    textAlign: 'center',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  editLink: {
    fontSize: 13,
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
    fontWeight: '500',
  },
  editInput: {
    width: 80,
    height: 42,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 16,
    fontWeight: '700',
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
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  cancelButton: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },
  emptyText: {
    fontSize: 14,
    marginBottom: 12,
  },
  ctaButton: {
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  errorText: {
    fontSize: 13,
    marginBottom: 8,
  },
});
