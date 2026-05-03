import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LocationState } from '@/lib/useLocation';
import { useTheme } from '@/lib/theme';

interface LocationBarProps {
  location: LocationState;
  /**
   * Optional tap handler — when provided, the pill becomes a button that
   * opens the manual-location override sheet (S-227). Without this prop the
   * bar stays a passive summary, preserving compatibility with any callers
   * that don't yet wire up the override flow.
   */
  onPress?: () => void;
}

export function LocationBar({ location, onPress }: LocationBarProps) {
  const { colors } = useTheme();
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const isGps = !location.loading && location.source === 'gps';
  const isManual = !location.loading && location.source === 'manual';
  const isFallback = !location.loading && !isGps && !isManual;

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

  let label: string;
  let accessibilityLabel: string;
  if (location.loading) {
    label = 'Locating…';
    accessibilityLabel = 'Resolving your location';
  } else {
    switch (location.source) {
      case 'gps':
        label = 'Near your location';
        accessibilityLabel = 'Searching near your current location';
        break;
      case 'manual':
        // The picked neighborhood name lives on LocationState — fall back to
        // a generic label only if `name` is somehow missing (shouldn't happen
        // with the current setManualLocation flow, but guards against
        // partially-restored state from older SecureStore payloads).
        label = location.name ?? 'Manual location';
        accessibilityLabel = `Searching near ${label} (manual override)`;
        break;
      case 'fallback-denied':
        label = 'Location off — showing Silver Lake';
        accessibilityLabel =
          'Location permission denied — searching near Silver Lake, Los Angeles';
        break;
      case 'fallback-timeout':
        label = 'GPS slow — showing Silver Lake';
        accessibilityLabel =
          'GPS timed out — searching near Silver Lake, Los Angeles';
        break;
      case 'fallback-error':
        label = 'Location unavailable — showing Silver Lake';
        accessibilityLabel =
          'Location unavailable — searching near Silver Lake, Los Angeles';
        break;
    }
  }

  const dotColor = location.loading
    ? colors.textTertiary
    : isFallback
    ? colors.warning
    : isManual
    ? colors.accent
    : colors.accent;

  // Hint that the pill is tappable — only present when onPress is wired.
  const a11yHint = onPress ? 'Double-tap to change location' : undefined;

  const pillContents = (
    <>
      {!location.loading && (
        <View style={styles.dotContainer}>
          <Animated.View style={[styles.dot, { backgroundColor: dotColor, opacity: pulseAnim }]} />
        </View>
      )}
      <Text
        style={[
          styles.text,
          { color: colors.textSecondary },
          isFallback && { color: colors.warning },
        ]}
      >
        {label}
      </Text>
      {onPress && (
        <Ionicons
          name="chevron-down"
          size={12}
          color={isFallback ? colors.warning : colors.textSecondary}
          style={styles.chevron}
        />
      )}
    </>
  );

  const pillStyle = [
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
  ];

  return (
    <View
      style={[styles.wrapper, { backgroundColor: colors.bg }]}
      accessibilityLiveRegion="polite"
    >
      {onPress ? (
        <Pressable
          style={pillStyle}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={a11yHint}
        >
          {pillContents}
        </Pressable>
      ) : (
        <View
          style={pillStyle}
          accessibilityRole="summary"
          accessibilityLabel={accessibilityLabel}
        >
          {pillContents}
        </View>
      )}
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
  chevron: {
    marginLeft: 1,
  },
});
