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

function MacroBox({ label, value, highlight, colors, mode }: {
  label: string; value: string; highlight?: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
  mode: string;
}) {
  const borderDefault = mode === 'dark' ? 'rgba(68,72,79,0.4)' : colors.border;
  const borderHL = 'rgba(34,197,94,0.3)';
  const bgHL = mode === 'dark' ? 'transparent' : 'rgba(34,197,94,0.05)';

  return (
    <View style={[h.macroBox, {
      borderColor: highlight ? borderHL : borderDefault,
      backgroundColor: highlight ? bgHL : 'transparent',
    }]}>
      <Text style={[h.macroValue, { color: highlight ? colors.accent : colors.textPrimary }]}>
        {value || '—'}
      </Text>
      <Text style={[h.macroLabel, { color: highlight ? 'rgba(34,197,94,0.5)' : colors.textTertiary }]}>
        {label}
      </Text>
    </View>
  );
}

export function SearchHeader({ values, location, onPress }: SearchHeaderProps) {
  const { colors, mode } = useTheme();

  const locationLabel = location.loading
    ? 'Locating...'
    : location.source === 'gps'
    ? 'Near you'
    : 'Silver Lake, LA';

  return (
    <View style={[h.wrapper, { backgroundColor: colors.bg }]}>
      <Pressable onPress={onPress} style={h.inner}>
        {/* Row 1: logo + location */}
        <View style={h.row1}>
          <View style={h.logoLeft}>
            <Ionicons name="restaurant" size={18} color={colors.accent} />
            <Text style={[h.logo, { color: colors.accent }]}>fitsy</Text>
          </View>
          <View style={[h.locationPill, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}>
            <View style={[h.locationDot, { backgroundColor: colors.accent }]} />
            <Text style={[h.locationText, { color: colors.textSecondary }]}>{locationLabel}</Text>
          </View>
        </View>

        {/* Divider */}
        <View style={[h.divider, { backgroundColor: colors.borderSubtle }]} />

        {/* Row 2: headline + reset */}
        <View style={h.row2}>
          <Text style={[h.headline, { color: colors.textPrimary }]}>Crave something.</Text>
          <Text style={[h.reset, { color: colors.textTertiary }]}>✕  RESET</Text>
        </View>

        {/* Row 3: macro boxes */}
        <View style={h.row3}>
          <MacroBox label="PROT" value={values.protein || '45'} colors={colors} mode={mode} />
          <MacroBox label="CARB" value={values.carbs || '60'} colors={colors} mode={mode} />
          <MacroBox label="FAT" value={values.fat || '12'} colors={colors} mode={mode} />
          <MacroBox label="KCAL" value={values.calories || '550'} highlight colors={colors} mode={mode} />
        </View>
      </Pressable>
    </View>
  );
}

const h = StyleSheet.create({
  wrapper: {},
  inner: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  row1: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 16,
  },
  logoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logo: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderWidth: 1,
    gap: 5,
  },
  locationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  locationText: {
    fontSize: 11,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    marginBottom: 18,
  },
  row2: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  headline: {
    fontFamily: 'PlayfairDisplay-BoldItalic',
    fontSize: 28,
  },
  reset: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
  },
  row3: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    marginBottom: 4,
  },
  macroBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 12,
    borderWidth: 1.5,
  },
  macroValue: {
    fontFamily: 'Manrope-Bold',
    fontSize: 18,
    letterSpacing: -0.3,
  },
  macroLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 2,
  },
});
