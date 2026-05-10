import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS } from '@/lib/brand';
import type { MacroValues } from '@/lib/macroPresets';
import type { LocationState } from '@/lib/useLocation';

interface SearchHeaderProps {
  values: MacroValues;
  location: LocationState;
  onPress: () => void;
}

function MacroBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={[h.macroBox, highlight && h.macroBoxHighlight]}>
      <Text style={[h.macroValue, highlight && h.macroValueHighlight]}>
        {value || '—'}
      </Text>
      <Text style={[h.macroLabel, highlight && h.macroLabelHighlight]}>
        {label}
      </Text>
    </View>
  );
}

export function SearchHeader({ values, location, onPress }: SearchHeaderProps) {
  const locationLabel = location.loading
    ? 'Locating...'
    : location.source === 'gps'
    ? 'Near you'
    : 'Silver Lake, LA';

  return (
    <View style={h.wrapper}>
      <Pressable onPress={onPress} style={h.inner}>
        {/* Row 1: logo + location */}
        <View style={h.row1}>
          <View style={h.logoLeft}>
            <Ionicons name="restaurant" size={18} color={COLORS.green} />
            <Text style={h.logo}>fitsy</Text>
          </View>
          <View style={h.locationPill}>
            <View style={h.locationDot} />
            <Text style={h.locationText}>{locationLabel}</Text>
          </View>
        </View>

        {/* Row 2: headline + reset */}
        <View style={h.row2}>
          <Text style={h.headline}>Crave something.</Text>
          <Text style={h.reset}>✕  RESET</Text>
        </View>

        {/* Row 3: macro boxes */}
        <View style={h.row3}>
          <MacroBox label="PROT" value={values.protein || '45'} />
          <MacroBox label="CARB" value={values.carbs || '60'} />
          <MacroBox label="FAT" value={values.fat || '12'} />
          <MacroBox label="KCAL" value={values.calories || '550'} highlight />
        </View>
      </Pressable>
    </View>
  );
}

const h = StyleSheet.create({
  wrapper: {
    backgroundColor: COLORS.white,
  },
  inner: {
    paddingHorizontal: 20,
    paddingBottom: 22,
    gap: 16,
  },
  row1: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  logoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logo: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.green,
    letterSpacing: -0.8,
  },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.borderLight,
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 5,
  },
  locationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.green,
  },
  locationText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  row2: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  headline: {
    fontFamily: FONTS.frauncesBold,
    fontSize: 28,
    color: COLORS.text,
  },
  reset: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textTertiary,
    letterSpacing: 1,
  },
  row3: {
    flexDirection: 'row',
    gap: 8,
  },
  macroBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderRadius: 14,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  macroBoxHighlight: {
    borderColor: COLORS.green,
    backgroundColor: 'transparent',
  },
  macroValue: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  macroValueHighlight: {
    color: COLORS.green,
    fontWeight: '500',
  },
  macroLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.textTertiary,
    letterSpacing: 1.5,
    marginTop: 2,
  },
  macroLabelHighlight: {
    color: COLORS.greenDark,
  },
});
