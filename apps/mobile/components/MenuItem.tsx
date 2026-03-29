import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MenuItemResult } from '@fitsy/shared';
import { ConfidenceBadge } from './ConfidenceBadge';
import { BookmarkButton } from './BookmarkButton';
import { useTheme } from '@/lib/theme';

interface Props {
  item: MenuItemResult;
  isSaved?: boolean;
  onToggleSave?: (id: string) => void;
}

export function MenuItem({ item, isSaved, onToggleSave }: Props) {
  const { colors } = useTheme();
  const priceLabel =
    item.price !== undefined && item.price !== null
      ? `$${item.price.toFixed(2)}`
      : null;

  return (
    <View style={[styles.row, { backgroundColor: colors.bgCard, borderBottomColor: colors.border }]}>
      <View style={styles.topRow}>
        <View style={styles.nameBlock}>
          <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={2}>
            {item.name}
          </Text>
          {item.category ? (
            <Text style={[styles.category, { color: colors.textSecondary }]}>{item.category}</Text>
          ) : null}
        </View>
        <View style={styles.rightBlock}>
          {priceLabel ? (
            <Text style={[styles.price, { color: colors.textPrimary }]}>{priceLabel}</Text>
          ) : null}
          {item.macros ? (
            <ConfidenceBadge confidence={item.macros.confidence} />
          ) : null}
          {onToggleSave !== undefined ? (
            <BookmarkButton
              isSaved={isSaved ?? false}
              onPress={() => onToggleSave(item.id)}
            />
          ) : null}
        </View>
      </View>

      {item.macros ? (
        <Text style={[styles.macros, { color: colors.textSecondary }]}>
          {`P: ${item.macros.proteinG}g  C: ${item.macros.carbsG}g  F: ${item.macros.fatG}g  Kcal: ${item.macros.calories}`}
        </Text>
      ) : (
        <Text style={[styles.noMacro, { color: colors.textSecondary }]}>No macro data</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
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
  },
  category: {
    fontSize: 12,
    marginTop: 2,
  },
  rightBlock: {
    alignItems: 'flex-end',
    gap: 4,
  },
  price: {
    fontSize: 14,
    fontWeight: '600',
  },
  macros: {
    fontSize: 13,
  },
  noMacro: {
    fontSize: 13,
    fontStyle: 'italic',
  },
});
