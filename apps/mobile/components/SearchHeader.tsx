import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
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

function PulsingDot({ color, delay = 0 }: { color: string; delay?: number }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 2000,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(600),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse, delay]);

  // Max 25% radius expansion: dot is 8px (r=4), ring goes to r=5 → scale 1.25
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1.0, 1.25] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 0.1, 0.4, 1], outputRange: [0, 0.5, 0.2, 0] });

  return (
    <View style={styles.dotContainer}>
      <Animated.View
        style={[
          styles.pulseRing,
          { backgroundColor: color, transform: [{ scale: ringScale }], opacity: ringOpacity },
        ]}
      />
      <View style={[styles.macroDot, { backgroundColor: color }]} />
    </View>
  );
}

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
                <PulsingDot color={color} delay={i * 250} />
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
  dotContainer: {
    width: 10,
    height: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
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
