import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ConfidenceLevel } from '@fitsy/shared';

interface Props {
  confidence: ConfidenceLevel;
}

const CONFIDENCE_COLORS: Record<ConfidenceLevel, string> = {
  HIGH: '#2D7D46',
  MEDIUM: '#D97706',
  LOW: '#6B7280',
};

const CONFIDENCE_BG: Record<ConfidenceLevel, string> = {
  HIGH: '#DCFCE7',
  MEDIUM: '#FEF3C7',
  LOW: '#F3F4F6',
};

export function ConfidenceBadge({ confidence }: Props) {
  return (
    <View style={[styles.badge, { backgroundColor: CONFIDENCE_BG[confidence] }]}>
      <Text style={[styles.badgeText, { color: CONFIDENCE_COLORS[confidence] }]}>
        {confidence}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
