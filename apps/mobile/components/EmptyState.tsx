import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';

interface EmptyStateProps {
  hasInputs: boolean;
}

export function EmptyState({ hasInputs }: EmptyStateProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.emptyState}>
      <View style={[styles.iconOuter, {
        backgroundColor: colors.accentBg,
      }]}>
        <View style={[styles.iconInner, {
          backgroundColor: colors.bgCard,
          borderColor: colors.accentBorder,
          shadowColor: colors.glassShadowColor,
          shadowOpacity: colors.glassShadowOpacity,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }]}>
          <Ionicons
            name={hasInputs ? 'search-outline' : 'nutrition-outline'}
            size={28}
            color={colors.accent}
          />
        </View>
      </View>
      <Text style={[styles.headline, { color: colors.textPrimary }]}>
        {hasInputs ? 'No matches found' : 'Set your macro targets'}
      </Text>
      <Text style={[styles.subtext, { color: colors.textTertiary }]}>
        {hasInputs
          ? 'Try adjusting your macro targets\nto find nearby restaurants'
          : 'Tap the filter bar above to enter\nyour protein, carb, and fat goals'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 48,
    paddingTop: 48,
    gap: 14,
  },
  iconOuter: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  iconInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  subtext: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 23,
    fontWeight: '400',
  },
});
