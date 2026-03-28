import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RestaurantResult } from '@fitsy/shared';
import { ConfidenceBadge } from './ConfidenceBadge';
import { useTheme } from '@/lib/theme';

interface Props {
  item: RestaurantResult;
  onPress?: () => void;
}

export function RestaurantCard({ item, onPress }: Props) {
  const { colors } = useTheme();
  const distanceLabel = `${item.distanceMiles.toFixed(1)} mi`;
  const isHighConfidence = item.bestMatch?.confidence === 'HIGH';

  return (
    <TouchableOpacity
      style={styles.cardWrapper}
      onPress={onPress}
      activeOpacity={onPress ? 0.8 : 1}
      accessibilityRole="button"
      accessibilityLabel={`View menu for ${item.name}`}
    >
      <View style={[styles.card, {
        backgroundColor: colors.bgCard,
        borderColor: colors.border,
        shadowColor: colors.glassShadowColor,
        shadowOpacity: colors.glassShadowOpacity,
        shadowRadius: colors.glassShadowRadius,
        shadowOffset: { width: 0, height: 4 },
        elevation: 8,
      }]}>
        {isHighConfidence && <View style={[styles.accentStrip, { backgroundColor: colors.accent }]} />}

        <View style={styles.cardBody}>
          <View style={styles.header}>
            <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1}>
              {item.name}
            </Text>
            <View style={[styles.distancePill, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
              <Text style={[styles.distance, { color: colors.textSecondary }]}>{distanceLabel}</Text>
            </View>
          </View>

          <Text style={[styles.address, { color: colors.textTertiary }]} numberOfLines={1}>
            {item.address}
          </Text>

          {item.bestMatch ? (
            <View style={[styles.bestMatch, { borderTopColor: colors.borderSubtle }]}>
              <View style={styles.bestMatchRow}>
                <Text style={[styles.bestMatchName, { color: colors.textSecondary }]} numberOfLines={1}>
                  {item.bestMatch.name}
                </Text>
                <ConfidenceBadge confidence={item.bestMatch.confidence} />
              </View>
              <View style={styles.macroRow}>
                <View style={[styles.macroChip, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
                  <Text style={[styles.macroChipUnit, { color: colors.textTertiary }]}>P</Text>
                  <Text style={[styles.macroChipValue, { color: colors.textPrimary }]}>{item.bestMatch.proteinG}g</Text>
                </View>
                <View style={[styles.macroChip, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
                  <Text style={[styles.macroChipUnit, { color: colors.textTertiary }]}>C</Text>
                  <Text style={[styles.macroChipValue, { color: colors.textPrimary }]}>{item.bestMatch.carbsG}g</Text>
                </View>
                <View style={[styles.macroChip, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
                  <Text style={[styles.macroChipUnit, { color: colors.textTertiary }]}>F</Text>
                  <Text style={[styles.macroChipValue, { color: colors.textPrimary }]}>{item.bestMatch.fatG}g</Text>
                </View>
                <View style={[styles.macroChip, styles.kcalChip, { borderColor: colors.accentBorder, backgroundColor: colors.accentBg }]}>
                  <Text style={[styles.kcalValue, { color: colors.accent }]}>{item.bestMatch.calories}</Text>
                  <Text style={styles.kcalUnit}> kcal</Text>
                </View>
              </View>
            </View>
          ) : (
            <Text style={[styles.noMacro, { color: colors.textTertiary, borderTopColor: colors.borderSubtle }]}>No macro data</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  cardWrapper: {
    marginHorizontal: 14,
    marginVertical: 5,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  accentStrip: {
    width: 3,
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
  },
  cardBody: {
    flex: 1,
    padding: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  name: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    marginRight: 10,
    letterSpacing: -0.3,
  },
  distancePill: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    flexShrink: 0,
  },
  distance: {
    fontSize: 11,
    fontWeight: '600',
  },
  address: {
    fontSize: 12,
    marginBottom: 11,
    fontWeight: '400',
  },
  bestMatch: {
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 8,
  },
  bestMatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bestMatchName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    marginRight: 8,
  },
  macroRow: {
    flexDirection: 'row',
    gap: 5,
    flexWrap: 'wrap',
  },
  macroChip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
  },
  macroChipUnit: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  macroChipValue: {
    fontSize: 12,
    fontWeight: '700',
  },
  kcalChip: {},
  kcalValue: {
    fontSize: 12,
    fontWeight: '700',
  },
  kcalUnit: {
    fontSize: 10,
    fontWeight: '600',
    opacity: 0.6,
  },
  noMacro: {
    fontSize: 12,
    fontStyle: 'italic',
    borderTopWidth: 1,
    paddingTop: 10,
  },
});
