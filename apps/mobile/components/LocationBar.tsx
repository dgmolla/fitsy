import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { LocationState } from '@/lib/useLocation';

interface LocationBarProps {
  location: LocationState;
}

/**
 * Displays the current location source as a thin status bar below the macro
 * input. Shows a loading indicator while GPS is resolving, GPS label when a
 * fix is acquired, and a fallback label (with amber styling) when GPS is
 * unavailable.
 */
export function LocationBar({ location }: LocationBarProps) {
  const label =
    location.source === 'gps'
      ? 'Searching near your location'
      : 'Searching near Silver Lake, LA';

  const accessibilityLabel =
    location.source === 'gps'
      ? 'Searching near your current location'
      : 'Location unavailable — searching near Silver Lake, Los Angeles';

  return (
    <View
      style={[
        styles.locationBar,
        location.source === 'fallback' && styles.locationBarFallback,
      ]}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="text"
    >
      <Text
        style={[
          styles.locationText,
          location.source === 'fallback' && styles.locationTextFallback,
        ]}
      >
        {location.loading ? 'Locating\u2026' : label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  locationBar: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#D1D5DB',
  },
  locationBarFallback: {
    backgroundColor: '#FFFBEB',
    borderBottomColor: '#FCD34D',
  },
  locationText: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
  },
  locationTextFallback: {
    color: '#92400E',
  },
});
