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
        style={[styles.macroBar, {
          backgroundColor: colors.bgCard,
          borderColor: colors.border,
          shadowColor: colors.glassShadowColor,
          shadowOpacity: colors.glassShadowOpacity * 0.5,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          elevation: 3,
        }]}
        accessibilityLabel="Edit macro filters"
        accessibilityRole="button"
      >
        {FIELDS.map(({ key, label }, i) => {
          const val = values[key];
          return (
            <React.Fragment key={key}>
              {i > 0 && (
                <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />
              )}
              <View style={styles.macroItem}>
                <Text style={[styles.macroLabel, { color: colors.textTertiary }]}>
                  {label}
                </Text>
                <Text style={[
                  styles.macroValue,
                  { color: val ? colors.textPrimary : colors.textTertiary },
                ]}>
                  {val || '--'}
                </Text>
              </View>
            </React.Fragment>
          );
        })}
        <View style={[styles.editHint, { backgroundColor: colors.accentBg }]}>
          <Ionicons name="options-outline" size={14} color={colors.accent} />
        </View>
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
  macroBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  macroItem: {
    flex: 1,
    alignItems: 'center',
    gap: 1,
  },
  macroLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  macroValue: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  divider: {
    width: 1,
    height: 24,
    borderRadius: 0.5,
  },
  editHint: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
});
