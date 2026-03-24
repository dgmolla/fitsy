import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ConfidenceLevel, RestaurantResult } from '@fitsy/shared';

interface Props {
  item: RestaurantResult;
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

function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: CONFIDENCE_BG[level] },
      ]}
    >
      <Text style={[styles.badgeText, { color: CONFIDENCE_COLORS[level] }]}>
        {level}
      </Text>
    </View>
  );
}

export function RestaurantCard({ item }: Props) {
  const distanceLabel = `${item.distanceMiles.toFixed(1)} mi`;

  return (
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
            <ConfidenceBadge level={item.bestMatch.confidence} />
          </View>
          <Text style={styles.macros}>
            {`${item.bestMatch.proteinG}g P · ${item.bestMatch.carbsG}g C · ${item.bestMatch.fatG}g F · ${item.bestMatch.calories} kcal`}
          </Text>
        </View>
      ) : (
        <Text style={styles.noMacro}>No macro data</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
