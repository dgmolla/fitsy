import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
      activeOpacity={onPress ? 0.75 : 1}
      accessibilityRole="button"
      accessibilityLabel={`View menu for ${item.name}`}
    >
      <View style={[styles.card, {
        backgroundColor: colors.bgCard,
        borderColor: colors.border,
        shadowColor: colors.glassShadowColor,
        shadowOpacity: colors.glassShadowOpacity,
        shadowRadius: colors.glassShadowRadius,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
      }]}>
        {isHighConfidence && (
          <View style={[styles.accentStrip, { backgroundColor: colors.accent }]} />
        )}

        <View style={styles.cardBody}>
          <View style={styles.header}>
            <View style={styles.nameBlock}>
              <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={styles.metaRow}>
                <Ionicons name="navigate-outline" size={11} color={colors.textTertiary} />
                <Text style={[styles.distance, { color: colors.textTertiary }]}>
                  {distanceLabel}
                </Text>
              </View>
            </View>
          </View>

          <Text style={[styles.address, { color: colors.textTertiary }]} numberOfLines={1}>
            {item.address}
          </Text>

          {item.bestMatch ? (
            <View style={styles.bestMatch}>
              <View style={styles.bestMatchRow}>
                <Text
                  style={[styles.bestMatchName, { color: colors.textPrimary }]}
                  numberOfLines={1}
                >
                  {item.bestMatch.name}
                </Text>
                <ConfidenceBadge confidence={item.bestMatch.confidence} />
              </View>
              <View style={styles.macroRow}>
                <View style={[styles.macroChipInline, { backgroundColor: colors.bgElevated }]}>
                  <Text style={[styles.macroChipLabel, { color: colors.textTertiary }]}>
                    CALS
                  </Text>
                  <Text style={[styles.macroChipVal, { color: colors.textPrimary }]}>
                    {item.bestMatch.calories}
                  </Text>
                </View>
                <View style={[styles.macroChipInline, { backgroundColor: colors.bgElevated }]}>
                  <Text style={[styles.macroChipLabel, { color: colors.textTertiary }]}>
                    PRO
                  </Text>
                  <Text style={[styles.macroChipVal, { color: colors.textPrimary }]}>
                    {item.bestMatch.proteinG}g
                  </Text>
                </View>
                <View style={[styles.macroChipInline, { backgroundColor: colors.bgElevated }]}>
                  <Text style={[styles.macroChipLabel, { color: colors.textTertiary }]}>
                    CARBS
                  </Text>
                  <Text style={[styles.macroChipVal, { color: colors.textPrimary }]}>
                    {item.bestMatch.carbsG}g
                  </Text>
                </View>
                <View style={[styles.macroChipInline, { backgroundColor: colors.bgElevated }]}>
                  <Text style={[styles.macroChipLabel, { color: colors.textTertiary }]}>
                    FAT
                  </Text>
                  <Text style={[styles.macroChipVal, { color: colors.textPrimary }]}>
                    {item.bestMatch.fatG}g
                  </Text>
                </View>
                {isHighConfidence && (
                  <View style={[styles.matchBadge, {
                    backgroundColor: colors.accentBg,
                    borderColor: colors.accentBorder,
                  }]}>
                    <Text style={[styles.matchBadgeText, { color: colors.accent }]}>
                      Match
                    </Text>
                  </View>
                )}
              </View>
            </View>
          ) : (
            <Text style={[styles.noMacro, { color: colors.textTertiary }]}>
              No macro data available
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  cardWrapper: {
    marginHorizontal: 16,
    marginVertical: 6,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  accentStrip: {
    width: 3.5,
    borderTopLeftRadius: 20,
    borderBottomLeftRadius: 20,
  },
  cardBody: {
    flex: 1,
    padding: 16,
    gap: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  nameBlock: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexShrink: 0,
  },
  distance: {
    fontSize: 12,
    fontWeight: '500',
  },
  address: {
    fontSize: 12,
    fontWeight: '400',
    marginBottom: 10,
    marginTop: 2,
  },
  bestMatch: {
    gap: 10,
  },
  bestMatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bestMatchName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,
    letterSpacing: -0.2,
  },
  macroRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  macroChipInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  macroChipLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  macroChipVal: {
    fontSize: 13,
    fontWeight: '700',
  },
  matchBadge: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  matchBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  noMacro: {
    fontSize: 13,
    fontStyle: 'italic',
    paddingTop: 10,
  },
});
