import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';

interface EmptyStateProps {
  hasInputs: boolean;
}

export function EmptyState({ hasInputs }: EmptyStateProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.emptyState}>
      <View style={[styles.iconCircle, {
        backgroundColor: colors.bgCard,
        borderColor: colors.border,
        shadowColor: colors.glassShadowColor,
        shadowOpacity: colors.glassShadowOpacity * 0.5,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      }]}>
        <Text style={styles.icon}>{hasInputs ? '🔍' : '🥗'}</Text>
      </View>
      <Text style={[styles.headline, { color: colors.textPrimary }]}>
        {hasInputs ? 'No matches found' : 'Set your targets'}
      </Text>
      <Text style={[styles.subtext, { color: colors.textTertiary }]}>
        {hasInputs
          ? 'Try adjusting your macro targets to find nearby restaurants'
          : 'Enter your macro targets above to discover restaurants that fit your goals'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 56,
    gap: 12,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  icon: {
    fontSize: 28,
  },
  headline: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtext: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    fontWeight: '400',
  },
});
