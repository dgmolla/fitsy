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
    backgroundColor: '#FFFFFF',
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
    color: '#22C55E',
    letterSpacing: -0.8,
  },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 5,
  },
  locationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22C55E',
  },
  locationText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
  },
  row2: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  headline: {
    fontFamily: 'PlayfairDisplay-BoldItalic',
    fontSize: 28,
    color: '#111827',
  },
  reset: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
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
    borderColor: '#E5E7EB',
  },
  macroBoxHighlight: {
    borderColor: '#22C55E',
    backgroundColor: 'transparent',
  },
  macroValue: {
    fontFamily: 'Manrope-Bold',
    fontSize: 18,
    color: '#111827',
    letterSpacing: -0.3,
  },
  macroValueHighlight: {
    color: '#22C55E',
    fontWeight: '500',
  },
  macroLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 1.5,
    marginTop: 2,
  },
  macroLabelHighlight: {
    color: '#16A34A',
  },
});
