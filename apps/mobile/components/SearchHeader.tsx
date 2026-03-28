import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import type { MacroValues } from '@/lib/macroPresets';

interface SearchHeaderProps {
  values: MacroValues;
  onPress: () => void;
}

const FIELDS: { key: keyof MacroValues; label: string }[] = [
  { key: 'protein', label: 'P' },
  { key: 'fat', label: 'F' },
  { key: 'carbs', label: 'C' },
];

export function SearchHeader({ values, onPress }: SearchHeaderProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, borderBottomColor: colors.borderSubtle }]}>
      <Text style={styles.logo}>fitsy</Text>

      <Pressable
        onPress={onPress}
        style={[styles.macroPills, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}
        accessibilityLabel="Edit macro filters"
        accessibilityRole="button"
      >
        {FIELDS.map(({ key, label }) => {
          const val = values[key];
          return (
            <View key={key} style={styles.pill}>
              <Text style={[styles.pillLabel, { color: colors.textTertiary }]}>{label}</Text>
              <Text style={[styles.pillValue, { color: val ? colors.textPrimary : colors.textTertiary }]}>
                {val || '—'}
              </Text>
            </View>
          );
        })}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  logo: {
    fontSize: 26,
    fontWeight: '700',
    color: '#2D7D46',
    letterSpacing: -0.5,
  },
  macroPills: {
    flexDirection: 'row',
    gap: 16,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  pill: {
    alignItems: 'center',
    gap: 1,
  },
  pillLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  pillValue: {
    fontSize: 16,
    fontWeight: '600',
    minWidth: 28,
    textAlign: 'center',
  },
});
