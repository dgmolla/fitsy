import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@/lib/theme';
import { PRESETS, type MacroValues } from '@/lib/macroPresets';
import { BlurFallback } from '@/lib/BlurFallback';

interface FilterPopupProps {
  visible: boolean;
  values: MacroValues;
  onApply: (values: MacroValues) => void;
  onClose: () => void;
}

const FIELDS: { key: keyof MacroValues; label: string }[] = [
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'fat', label: 'Fat' },
  { key: 'calories', label: 'Calories' },
];

export function FilterPopup({ visible, values, onApply, onClose }: FilterPopupProps) {
  const { colors, mode } = useTheme();
  const [draft, setDraft] = useState<MacroValues>(values);

  // Sync draft when popup opens with new values
  React.useEffect(() => {
    if (visible) setDraft(values);
  }, [visible, values]);

  function handleApply() {
    onApply(draft);
  }

  function handleClear() {
    setDraft({ protein: '', carbs: '', fat: '', calories: '' });
  }

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <BlurFallback
          tint={mode === 'dark' ? 'dark' : 'light'}
          intensity={60}
          fallbackColor="rgba(0,0,0,0.5)"
          style={StyleSheet.absoluteFill as ViewStyle}
        />

        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={[styles.headerAction, { color: colors.textSecondary }]}>Cancel</Text>
            </Pressable>
            <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Filters</Text>
            <Pressable onPress={handleClear} hitSlop={12}>
              <Text style={[styles.headerAction, { color: colors.textSecondary }]}>Clear</Text>
            </Pressable>
          </View>

          {FIELDS.map(({ key, label }) => (
            <View key={key} style={[styles.fieldRow, { borderBottomColor: colors.borderSubtle }]}>
              <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>{label}</Text>
              <TextInput
                style={[styles.fieldInput, { color: colors.textPrimary }]}
                value={draft[key]}
                onChangeText={(text) => setDraft((prev) => ({ ...prev, [key]: text }))}
                keyboardType="numeric"
                placeholder="—"
                placeholderTextColor={colors.textTertiary}
                maxLength={5}
              />
            </View>
          ))}

          <View style={styles.presets}>
            {PRESETS.map((preset) => (
              <Pressable
                key={preset.label}
                style={[styles.presetChip, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}
                onPress={() => setDraft(preset.values)}
              >
                <Text style={[styles.presetText, { color: colors.textSecondary }]}>{preset.label}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            style={[styles.applyButton, { backgroundColor: colors.accent }]}
            onPress={handleApply}
          >
            <Text style={[styles.applyText, { color: colors.accentOnAccent }]}>Apply</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    width: '85%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.2,
    shadowRadius: 32,
    elevation: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  headerAction: {
    fontSize: 15,
    fontWeight: '500',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  fieldLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  fieldInput: {
    fontSize: 17,
    fontWeight: '600',
    minWidth: 60,
    textAlign: 'right',
  },
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
    marginBottom: 16,
  },
  presetChip: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  presetText: {
    fontSize: 12,
    fontWeight: '500',
  },
  applyButton: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  applyText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
