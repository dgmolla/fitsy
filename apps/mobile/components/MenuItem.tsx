import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ConfidenceLevel, MenuItemResult } from '@fitsy/shared';

interface Props {
  item: MenuItemResult;
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
    <View style={[styles.badge, { backgroundColor: CONFIDENCE_BG[level] }]}>
      <Text style={[styles.badgeText, { color: CONFIDENCE_COLORS[level] }]}>
        {level}
      </Text>
    </View>
  );
}

export function MenuItem({ item }: Props) {
  const priceLabel =
    item.price !== undefined && item.price !== null
      ? `$${item.price.toFixed(2)}`
      : null;

  return (
    <View style={styles.row}>
      <View style={styles.topRow}>
        <View style={styles.nameBlock}>
          <Text style={styles.name} numberOfLines={2}>
            {item.name}
          </Text>
          {item.category ? (
            <Text style={styles.category}>{item.category}</Text>
          ) : null}
        </View>
        <View style={styles.rightBlock}>
          {priceLabel ? (
            <Text style={styles.price}>{priceLabel}</Text>
          ) : null}
          {item.macros ? (
            <ConfidenceBadge level={item.macros.confidence} />
          ) : null}
        </View>
      </View>

      {item.macros ? (
        <Text style={styles.macros}>
          {`P: ${item.macros.proteinG}g  C: ${item.macros.carbsG}g  F: ${item.macros.fatG}g  Kcal: ${item.macros.calories}`}
        </Text>
      ) : (
        <Text style={styles.noMacro}>No macro data</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  nameBlock: {
    flex: 1,
    marginRight: 8,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  category: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  rightBlock: {
    alignItems: 'flex-end',
    gap: 4,
  },
  price: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  macros: {
    fontSize: 13,
    color: '#6B7280',
  },
  noMacro: {
    fontSize: 13,
    color: '#6B7280',
    fontStyle: 'italic',
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
