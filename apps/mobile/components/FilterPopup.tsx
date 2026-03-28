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

const FIELDS: { key: keyof MacroValues; label: string; unit: string }[] = [
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
  { key: 'calories', label: 'Calories', unit: 'kcal' },
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

        <View style={[styles.card, {
          backgroundColor: colors.bgCard,
          borderColor: colors.border,
        }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={[styles.headerAction, { color: colors.textTertiary }]}>Cancel</Text>
            </Pressable>
            <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Macro Targets</Text>
            <Pressable onPress={handleClear} hitSlop={12}>
              <Text style={[styles.headerAction, { color: colors.accent }]}>Clear</Text>
            </Pressable>
          </View>

          <View style={[styles.fieldsContainer, {
            backgroundColor: colors.inputBg,
            borderColor: colors.inputBorder,
          }]}>
            {FIELDS.map(({ key, label, unit }, i) => (
              <View key={key} style={[
                styles.fieldRow,
                i < FIELDS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
              ]}>
                <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>{label}</Text>
                <View style={styles.fieldRight}>
                  <TextInput
                    style={[styles.fieldInput, {
                      color: draft[key] ? colors.textPrimary : colors.textTertiary,
                    }]}
                    value={draft[key]}
                    onChangeText={(text) => setDraft((prev) => ({ ...prev, [key]: text }))}
                    keyboardType="numeric"
                    placeholder="--"
                    placeholderTextColor={colors.textTertiary}
                    maxLength={5}
                  />
                  <Text style={[styles.fieldUnit, { color: colors.textTertiary }]}>{unit}</Text>
                </View>
              </View>
            ))}
          </View>

          <Text style={[styles.presetLabel, { color: colors.textTertiary }]}>Quick presets</Text>
          <View style={styles.presets}>
            {PRESETS.map((preset) => (
              <Pressable
                key={preset.label}
                style={[styles.presetChip, {
                  backgroundColor: colors.accentBg,
                  borderColor: colors.accentBorder,
                }]}
                onPress={() => setDraft(preset.values)}
              >
                <Text style={[styles.presetText, { color: colors.accent }]}>
                  {preset.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            style={[styles.applyButton, { backgroundColor: colors.accent }]}
            onPress={handleApply}
          >
            <Text style={[styles.applyText, { color: colors.accentOnAccent }]}>
              Apply Targets
            </Text>
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
    width: '88%',
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingBottom: 22,
    paddingTop: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.18,
    shadowRadius: 40,
    elevation: 24,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.12)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  headerAction: {
    fontSize: 15,
    fontWeight: '500',
  },
  fieldsContainer: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 20,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  fieldLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  fieldRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  fieldInput: {
    fontSize: 18,
    fontWeight: '700',
    minWidth: 52,
    textAlign: 'right',
    letterSpacing: -0.3,
  },
  fieldUnit: {
    fontSize: 12,
    fontWeight: '500',
  },
  presetLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 22,
  },
  presetChip: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  presetText: {
    fontSize: 13,
    fontWeight: '600',
  },
  applyButton: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#2D7D46',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  applyText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
