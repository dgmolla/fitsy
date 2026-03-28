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
import type { MacroValues } from '@/lib/macroPresets';
import { BlurFallback } from '@/lib/BlurFallback';

interface FilterPopupProps {
  visible: boolean;
  values: MacroValues;
  onApply: (values: MacroValues) => void;
  onClose: () => void;
}

const MACROS: { key: keyof MacroValues; label: string; unit: string; color: string }[] = [
  { key: 'protein', label: 'Protein', unit: 'g', color: '#3B82F6' },
  { key: 'carbs', label: 'Carbs', unit: 'g', color: '#F59E0B' },
  { key: 'fat', label: 'Fat', unit: 'g', color: '#EF4444' },
];

export function FilterPopup({ visible, values, onApply, onClose }: FilterPopupProps) {
  const { colors, mode } = useTheme();
  const [draft, setDraft] = useState<MacroValues>(values);

  React.useEffect(() => {
    if (visible) setDraft(values);
  }, [visible, values]);

  function handleApply() {
    onApply(draft);
  }

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <BlurFallback
          tint={mode === 'dark' ? 'dark' : 'light'}
          intensity={120}
          fallbackColor="rgba(0,0,0,0.75)"
          style={StyleSheet.absoluteFill as ViewStyle}
        />

        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={[styles.sheet, {
          backgroundColor: colors.bgCard,
          borderColor: colors.border,
          shadowColor: colors.glassShadowColor,
          shadowOpacity: colors.glassShadowOpacity,
          shadowRadius: colors.glassShadowRadius,
          shadowOffset: { width: 0, height: -8 },
          elevation: 24,
        }]}>
          <View style={styles.handle} />

          <Text style={[styles.title, { color: colors.textPrimary }]}>
            Macro Targets
          </Text>

          {/* Three macro inputs in a row */}
          <View style={styles.macroRow}>
            {MACROS.map(({ key, label, unit, color }) => (
              <View
                key={key}
                style={[styles.macroBox, {
                  backgroundColor: colors.inputBg,
                  borderColor: colors.inputBorder,
                }]}
              >
                <View style={[styles.macroColorBar, { backgroundColor: color }]} />
                <TextInput
                  style={[styles.macroInput, { color: colors.textPrimary }]}
                  value={draft[key]}
                  onChangeText={(t) => setDraft((p) => ({ ...p, [key]: t }))}
                  keyboardType="numeric"
                  placeholder="\u2014"
                  placeholderTextColor={colors.textTertiary}
                  maxLength={4}
                  textAlign="center"
                />
                <Text style={[styles.macroUnit, { color: colors.textTertiary }]}>
                  {label} ({unit})
                </Text>
              </View>
            ))}
          </View>

          {/* Calories row */}
          <View style={[styles.calRow, {
            backgroundColor: colors.inputBg,
            borderColor: colors.inputBorder,
          }]}>
            <Text style={[styles.calLabel, { color: colors.textSecondary }]}>Calories</Text>
            <View style={styles.calRight}>
              <TextInput
                style={[styles.calInput, { color: colors.textPrimary }]}
                value={draft.calories}
                onChangeText={(t) => setDraft((p) => ({ ...p, calories: t }))}
                keyboardType="numeric"
                placeholder="\u2014"
                placeholderTextColor={colors.textTertiary}
                maxLength={5}
              />
              <Text style={[styles.calUnit, { color: colors.textTertiary }]}>kcal</Text>
            </View>
          </View>

          {/* Apply */}
          <Pressable
            style={[styles.applyButton, { backgroundColor: colors.accent }]}
            onPress={handleApply}
          >
            <Text style={[styles.applyText, { color: colors.accentOnAccent }]}>
              Apply Filters
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
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 10,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.3)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.4,
    marginBottom: 20,
    textAlign: 'center',
  },
  macroRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  macroBox: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
  },
  macroColorBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  macroInput: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -1,
    minWidth: 60,
    textAlign: 'center',
    padding: 0,
  },
  macroUnit: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  calRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 20,
  },
  calLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  calRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  calInput: {
    fontSize: 20,
    fontWeight: '700',
    minWidth: 50,
    textAlign: 'right',
    padding: 0,
    letterSpacing: -0.5,
  },
  calUnit: {
    fontSize: 12,
    fontWeight: '500',
  },
  applyButton: {
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: '#2D7D46',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 8,
  },
  applyText: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
});
