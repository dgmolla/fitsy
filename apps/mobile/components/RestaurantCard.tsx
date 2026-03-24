import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RestaurantResult } from '@fitsy/shared';
import { ConfidenceBadge } from './ConfidenceBadge';

interface Props {
  item: RestaurantResult;
  onPress?: () => void;
}

export function RestaurantCard({ item, onPress }: Props) {
  const distanceLabel = `${item.distanceMiles.toFixed(1)} mi`;

  return (
    <TouchableOpacity
      style={styles.cardWrapper}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      accessibilityRole="button"
      accessibilityLabel={`View menu for ${item.name}`}
    >
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.distance}>{distanceLabel}</Text>
      </View>

      <Text style={styles.address} numberOfLines={1}>
        {item.address}
      </Text>

      {item.bestMatch ? (
        <View style={styles.bestMatch}>
          <View style={styles.bestMatchRow}>
            <Text style={styles.bestMatchName} numberOfLines={1}>
              {item.bestMatch.name}
            </Text>
            <ConfidenceBadge confidence={item.bestMatch.confidence} />
          </View>
          <Text style={styles.macros}>
            {`${item.bestMatch.proteinG}g P · ${item.bestMatch.carbsG}g C · ${item.bestMatch.fatG}g F · ${item.bestMatch.calories} kcal`}
          </Text>
        </View>
      ) : (
        <Text style={styles.noMacro}>No macro data</Text>
      )}
    </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  cardWrapper: {
    // no extra styling needed; card handles its own margins
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  name: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginRight: 8,
  },
  distance: {
    fontSize: 13,
    color: '#6B7280',
    flexShrink: 0,
  },
  address: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 8,
  },
  bestMatch: {
    borderTopWidth: 1,
    borderTopColor: '#D1D5DB',
    paddingTop: 8,
    gap: 4,
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
    color: '#111827',
    marginRight: 8,
  },
  macros: {
    fontSize: 13,
    color: '#6B7280',
  },
  noMacro: {
    fontSize: 13,
    color: '#6B7280',
    fontStyle: 'italic',
    borderTopWidth: 1,
    borderTopColor: '#D1D5DB',
    paddingTop: 8,
  },
});
