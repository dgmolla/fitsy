import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { BRAND } from '@/lib/brand';
import type { MacroValues } from '@/lib/macroPresets';
import type { LocationState } from '@/lib/useLocation';

interface SearchHeaderProps {
  values: MacroValues;
  location: LocationState;
  onPress: () => void;
}

const MACRO_COLORS = {
  protein: '#3B82F6',
  carbs: '#F59E0B',
  fat: '#EF4444',
} as const;

const FIELDS: { key: keyof MacroValues; label: string; color: string }[] = [
  { key: 'protein', label: 'P', color: MACRO_COLORS.protein },
  { key: 'carbs', label: 'C', color: MACRO_COLORS.carbs },
  { key: 'fat', label: 'F', color: MACRO_COLORS.fat },
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
        <Text style={[styles.logo, { color: BRAND.color }]}>{BRAND.name}</Text>
        <View style={styles.locationRow}>
          <Ionicons name="location-sharp" size={12} color={colors.textTertiary} />
          <Text style={[styles.location, { color: colors.textTertiary }]}>
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
        {FIELDS.map(({ key, label, color }, i) => {
          const val = values[key];
          return (
            <React.Fragment key={key}>
              {i > 0 && <View style={styles.chipSpacer} />}
              <View style={[styles.macroChip, { backgroundColor: colors.bgElevated }]}>
                <View style={[styles.macroDot, { backgroundColor: color }]} />
                <Text style={[styles.macroText, { color: colors.textSecondary }]}>
                  {val ? `${val}g` : '\u2014'}{' '}
                </Text>
                <Text style={[styles.macroLabel, { color: colors.textTertiary }]}>
                  {label}
                </Text>
              </View>
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
    fontWeight: BRAND.fontWeight,
    letterSpacing: BRAND.letterSpacing,
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
  chipSpacer: {
    width: 8,
  },
  macroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  macroDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  macroText: {
    fontSize: 13,
    fontWeight: '700',
  },
  macroLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
});
