import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { BRAND } from '@/lib/brand';
import type { MacroValues } from '@/lib/macroPresets';
import type { LocationState } from '@/lib/useLocation';
import { MACRO_COLORS } from '@/lib/macroColors';

interface SearchHeaderProps {
  values: MacroValues;
  location: LocationState;
  onPress: () => void;
}

const PULSE_DURATION_MS = 1800;
const PULSE_STAGGER_MS = 300;

function PulsingDot({ color, delay = 0 }: { color: string; delay?: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.sequence([
            Animated.timing(scale, {
              toValue: 2,
              duration: PULSE_DURATION_MS * 0.6,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(scale, {
              toValue: 1,
              duration: PULSE_DURATION_MS * 0.4,
              easing: Easing.in(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(ringOpacity, {
              toValue: 0.4,
              duration: PULSE_DURATION_MS * 0.15,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(ringOpacity, {
              toValue: 0,
              duration: PULSE_DURATION_MS * 0.85,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [scale, ringOpacity, delay]);

  return (
    <View style={styles.dotContainer}>
      <Animated.View
        style={[
          styles.pulseRing,
          { backgroundColor: color, transform: [{ scale }], opacity: ringOpacity },
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

  const hasTargets = values.protein || values.carbs || values.fat;

  return (
    <View style={styles.container}>
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
        style={[styles.macroButton, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}
        accessibilityLabel="Edit macro filters"
        accessibilityRole="button"
      >
        {hasTargets ? (
          <>
            <View style={styles.macroItem}>
              <PulsingDot color={MACRO_COLORS.protein} delay={0} />
              <Text style={[styles.macroNum, { color: colors.textSecondary }]}>{values.protein ?? 0}</Text>
              <Text style={[styles.macroLetter, { color: colors.textTertiary }]}>p</Text>
            </View>
            <View style={styles.macroItem}>
              <PulsingDot color={MACRO_COLORS.carbs} delay={0} />
              <Text style={[styles.macroNum, { color: colors.textSecondary }]}>{values.carbs ?? 0}</Text>
              <Text style={[styles.macroLetter, { color: colors.textTertiary }]}>c</Text>
            </View>
            <View style={styles.macroItem}>
              <PulsingDot color={MACRO_COLORS.fat} delay={0} />
              <Text style={[styles.macroNum, { color: colors.textSecondary }]}>{values.fat ?? 0}</Text>
              <Text style={[styles.macroLetter, { color: colors.textTertiary }]}>f</Text>
            </View>
          </>
        ) : (
          <Text style={[styles.macroLetter, { color: colors.textTertiary }]}>Set targets</Text>
        )}
        <Ionicons name="pencil" size={12} color={colors.textTertiary} />
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
  macroButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
    borderWidth: 1,
  },
  macroItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
  macroNum: {
    fontSize: 14,
    fontWeight: '800',
  },
  macroLetter: {
    fontSize: 13,
    fontWeight: '400',
  },
});
