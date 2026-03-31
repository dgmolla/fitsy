import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
            <Ionicons name="restaurant" size={18} color="#4ADE80" />
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
    backgroundColor: '#0A0E14',
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
    color: '#4ADE80',
    letterSpacing: -0.8,
  },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(68,72,79,0.25)',
    gap: 5,
  },
  locationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4ADE80',
  },
  locationText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(241,243,252,0.6)',
  },
  row2: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  headline: {
    fontFamily: 'PlayfairDisplay-BoldItalic',
    fontSize: 28,
    color: '#F1F3FC',
  },
  reset: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(241,243,252,0.28)',
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
    borderColor: 'rgba(68,72,79,0.4)',
  },
  macroBoxHighlight: {
    borderColor: 'rgba(74,222,128,0.5)',
    backgroundColor: 'transparent',
  },
  macroValue: {
    fontFamily: 'Manrope-Bold',
    fontSize: 18,
    color: '#F1F3FC',
    letterSpacing: -0.3,
  },
  macroValueHighlight: {
    color: '#4ADE80',
    fontWeight: '500',
  },
  macroLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(168,171,179,0.4)',
    letterSpacing: 1.5,
    marginTop: 2,
  },
  macroLabelHighlight: {
    color: 'rgba(74,222,128,0.4)',
  },
});
