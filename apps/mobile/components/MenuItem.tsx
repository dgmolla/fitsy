import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MenuItemResult } from '@fitsy/shared';
import { ConfidenceBadge } from './ConfidenceBadge';

interface Props {
  item: MenuItemResult;
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
            <ConfidenceBadge confidence={item.macros.confidence} />
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
});
