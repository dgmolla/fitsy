import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import type { LocationState } from '@/lib/useLocation';
import { useTheme } from '@/lib/theme';

interface LocationBarProps {
  location: LocationState;
}

export function LocationBar({ location }: LocationBarProps) {
  const { colors } = useTheme();
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const isFallback = !location.loading && location.source === 'fallback';
  const isGps = !location.loading && location.source === 'gps';

  useEffect(() => {
    if (isGps) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
    pulseAnim.setValue(1);
  }, [isGps, pulseAnim]);

  const label = location.loading
    ? 'Locating\u2026'
    : location.source === 'gps'
    ? 'Near your location'
    : 'Near Silver Lake, LA';

  const accessibilityLabel =
    location.source === 'gps'
      ? 'Searching near your current location'
      : 'Location unavailable — searching near Silver Lake, Los Angeles';

  const dotColor = location.loading ? colors.textTertiary : isFallback ? colors.warning : colors.accent;

  return (
    <View
      style={[styles.wrapper, { backgroundColor: colors.bg }]}
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
    >
      <View style={[
        styles.pill,
        {
          backgroundColor: colors.bgElevated,
          borderColor: colors.border,
          shadowColor: colors.glassShadowColor,
          shadowOpacity: colors.glassShadowOpacity * 0.4,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 2 },
          elevation: 4,
        },
        isFallback && { borderColor: colors.warningBorder, backgroundColor: colors.warningBg },
      ]}>
        {!location.loading && (
          <View style={styles.dotContainer}>
            <Animated.View style={[styles.dot, { backgroundColor: dotColor, opacity: pulseAnim }]} />
          </View>
        )}
        <Text style={[styles.text, { color: colors.textSecondary }, isFallback && { color: colors.warning }]}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  dotContainer: {
    width: 7,
    height: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
});
