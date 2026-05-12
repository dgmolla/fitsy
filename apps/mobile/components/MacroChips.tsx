import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { MACRO_COLORS } from '@/lib/macroColors';

interface MacroChipsProps {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

const CHIPS: { key: keyof MacroChipsProps; label: string; color: string; unit: string }[] = [
  { key: 'calories', label: 'CALS', color: EDITORIAL.text, unit: '' },
  { key: 'protein', label: 'PRO', color: MACRO_COLORS.protein, unit: 'g' },
  { key: 'carbs', label: 'CARB', color: MACRO_COLORS.carbs, unit: 'g' },
  { key: 'fat', label: 'FAT', color: MACRO_COLORS.fat, unit: 'g' },
];

export function MacroChips({ calories, protein, carbs, fat }: MacroChipsProps) {
  const values: MacroChipsProps = { calories, protein, carbs, fat };

  return (
    <View style={styles.row}>
      {CHIPS.map(({ key, label, color, unit }) => {
        const val = values[key];
        if (val === undefined) return null;
        return (
          <View key={key} style={styles.chip}>
            <Text style={styles.label}>{label}</Text>
            <Text style={[styles.value, { color }]}>
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
    gap: 8,
    flexWrap: 'wrap',
  },
  chip: {
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 2,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: EDITORIAL.border,
  },
  label: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: EDITORIAL.textSoft,
  },
  value: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
});
