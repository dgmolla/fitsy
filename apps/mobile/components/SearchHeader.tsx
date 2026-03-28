import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
    ? 'Locating...'
    : location.source === 'gps'
    ? 'Near you'
    : 'Silver Lake, LA';

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.topRow}>
        <Text style={[styles.logo, { color: colors.accent }]}>fitsy</Text>
        <View style={styles.locationRow}>
          <Ionicons name="location-sharp" size={12} color={colors.accent} />
          <Text style={[styles.location, { color: colors.textSecondary }]}>
            {locationLabel}
          </Text>
        </View>
      </View>

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
              {i > 0 && <Text style={[styles.dot, { color: colors.borderSubtle }]}> · </Text>}
              <Text style={[styles.macroLabel, { color: colors.textTertiary }]}>
                {label.toLowerCase()}{' '}
              </Text>
              <Text style={[
                styles.macroValue,
                { color: val ? colors.textPrimary : colors.textTertiary },
              ]}>
                {val || '—'}
              </Text>
            </React.Fragment>
          );
        })}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 16,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  logo: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -1,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  location: {
    fontSize: 13,
    fontWeight: '500',
  },
  macroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  macroLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  macroValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  dot: {
    fontSize: 13,
  },
});
