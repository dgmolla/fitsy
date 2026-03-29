import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { MACRO_COLORS } from '@/lib/macroColors';

/**
 * Centralized macro display component.
 * Label above number, colored by macro type.
 * Used in RestaurantCard, MenuItem, and anywhere macros are shown.
 */

interface MacroChipsProps {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

const CHIPS: { key: keyof MacroChipsProps; label: string; color: string; unit: string }[] = [
  { key: 'calories', label: 'CALS', color: '', unit: '' },
  { key: 'protein', label: 'PRO', color: MACRO_COLORS.protein, unit: 'g' },
  { key: 'carbs', label: 'CARB', color: MACRO_COLORS.carbs, unit: 'g' },
  { key: 'fat', label: 'FAT', color: MACRO_COLORS.fat, unit: 'g' },
];

export function MacroChips({ calories, protein, carbs, fat }: MacroChipsProps) {
  const { colors } = useTheme();
  const values: MacroChipsProps = { calories, protein, carbs, fat };

  return (
    <View style={styles.row}>
      {CHIPS.map(({ key, label, color, unit }) => {
        const val = values[key];
        if (val === undefined) return null;
        const chipColor = color || colors.textPrimary;
        return (
          <View key={key} style={[styles.chip, { backgroundColor: colors.bgElevated }]}>
            <Text style={[styles.label, { color: colors.textTertiary }]}>{label}</Text>
            <Text style={[styles.value, { color: chipColor }]}>
              {val}{unit}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  chip: {
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 1,
  },
  label: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
});
