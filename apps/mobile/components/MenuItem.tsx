import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MenuItemResult } from '@fitsy/shared';
import { BookmarkButton } from './BookmarkButton';
import { ConfidenceBadge } from './ConfidenceBadge';
import { useTheme } from '@/lib/theme';

interface Props {
  item: MenuItemResult;
  isSaved?: boolean;
  onToggleSave?: (id: string) => void;
}

export function MenuItem({ item, isSaved, onToggleSave }: Props) {
  const { colors } = useTheme();
  const m = item.macros;

  return (
    <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.borderSubtle }]}>
      <View style={styles.topRow}>
        <View style={styles.nameBlock}>
          <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={2}>
            {item.name}
          </Text>
          {item.description ? (
            <Text style={[styles.description, { color: colors.textTertiary }]} numberOfLines={1}>
              {item.description}
            </Text>
          ) : null}
        </View>
        {onToggleSave !== undefined ? (
          <BookmarkButton isSaved={isSaved ?? false} onPress={() => onToggleSave(item.id)} />
        ) : null}
      </View>

      {m ? (
        <View style={styles.macroRow}>
          <Text style={[styles.calValue, { color: colors.textPrimary }]}>
            {m.calories}
            <Text style={[styles.calUnit, { color: colors.textTertiary }]}> cal</Text>
          </Text>
          <View style={[styles.macroDot, { backgroundColor: colors.borderSubtle }]} />
          <Text style={[styles.macroInline, { color: colors.accent }]}>
            {m.proteinG}g
            <Text style={[styles.macroSuffix, { color: colors.textTertiary }]}> PRO</Text>
          </Text>
          <View style={[styles.macroDot, { backgroundColor: colors.borderSubtle }]} />
          <Text style={[styles.macroInline, { color: colors.warning }]}>
            {m.carbsG}g
            <Text style={[styles.macroSuffix, { color: colors.textTertiary }]}> CARB</Text>
          </Text>
          <View style={[styles.macroDot, { backgroundColor: colors.borderSubtle }]} />
          <Text style={[styles.macroInline, { color: colors.error }]}>
            {m.fatG}g
            <Text style={[styles.macroSuffix, { color: colors.textTertiary }]}> FAT</Text>
          </Text>
          <ConfidenceBadge confidence={m.confidence} />
        </View>
      ) : (
        <View style={styles.noMacroRow}>
          <Ionicons name="alert-circle-outline" size={14} color={colors.textTertiary} />
          <Text style={[styles.noMacro, { color: colors.textTertiary }]}>No macro data</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  nameBlock: { flex: 1, marginRight: 8 },
  name: { fontSize: 16, fontWeight: '700', lineHeight: 21 },
  description: { fontSize: 13, marginTop: 2, lineHeight: 17 },
  macroRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  calValue: { fontSize: 14, fontWeight: '700' },
  calUnit: { fontSize: 12, fontWeight: '500' },
  macroDot: { width: 3, height: 3, borderRadius: 1.5 },
  macroInline: { fontSize: 13, fontWeight: '700' },
  macroSuffix: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
  noMacroRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  noMacro: { fontSize: 13, fontStyle: 'italic' },
});
