import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import type { MacroValues } from '@/lib/macroPresets';
import type { LocationState } from '@/lib/useLocation';

interface SearchHeaderProps {
  values: MacroValues;
  location: LocationState;
  onPress: () => void;
}

const FIELDS: { key: keyof MacroValues; label: string }[] = [
  { key: 'protein', label: 'P' },
  { key: 'fat', label: 'F' },
  { key: 'carbs', label: 'C' },
];

export function SearchHeader({ values, location, onPress }: SearchHeaderProps) {
  const { colors } = useTheme();

  const locationLabel = location.loading
    ? 'Locating…'
    : location.source === 'gps'
    ? 'Near you'
    : 'Silver Lake, LA';

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, borderBottomColor: colors.borderSubtle }]}>
      <View style={styles.left}>
        <Text style={styles.logo}>fitsy</Text>
        <Pressable
          onPress={onPress}
          style={styles.macroRow}
          accessibilityLabel="Edit macro filters"
          accessibilityRole="button"
        >
          {FIELDS.map(({ key, label }, i) => {
            const val = values[key];
            return (
              <React.Fragment key={key}>
                {i > 0 && <Text style={[styles.separator, { color: colors.borderSubtle }]}>·</Text>}
                <Text style={[styles.macroLabel, { color: colors.textTertiary }]}>{label} </Text>
                <Text style={[styles.macroValue, { color: val ? colors.textPrimary : colors.textTertiary }]}>
                  {val || '—'}
                </Text>
              </React.Fragment>
            );
          })}
        </Pressable>
      </View>

      <Text style={[styles.location, { color: colors.textTertiary }]}>{locationLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  left: {
    gap: 4,
  },
  logo: {
    fontSize: 26,
    fontWeight: '700',
    color: '#2D7D46',
    letterSpacing: -0.5,
  },
  macroRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  macroLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  macroValue: {
    fontSize: 12,
    fontWeight: '700',
  },
  separator: {
    fontSize: 12,
    marginHorizontal: 6,
  },
  location: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 6,
  },
});
