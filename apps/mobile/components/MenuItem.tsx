import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MenuItemResult } from '@fitsy/shared';
import { BookmarkButton } from './BookmarkButton';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { MacroChips } from './MacroChips';

interface Props {
  item: MenuItemResult;
  isSaved?: boolean;
  onToggleSave?: (id: string) => void;
}

export function MenuItem({ item, isSaved, onToggleSave }: Props) {
  const m = item.macros;

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.nameBlock}>
          <Text style={styles.name} numberOfLines={2}>
            {item.name}
          </Text>
          {item.description ? (
            <Text style={styles.description} numberOfLines={1}>
              {item.description}
            </Text>
          ) : null}
        </View>
        {onToggleSave !== undefined ? (
          <BookmarkButton isSaved={isSaved ?? false} onPress={() => onToggleSave(item.id)} />
        ) : null}
      </View>

      {m ? (
        <MacroChips
          calories={m.calories}
          protein={m.proteinG}
          carbs={m.carbsG}
          fat={m.fatG}
        />
      ) : (
        <View style={styles.noMacroRow}>
          <Ionicons name="alert-circle-outline" size={14} color={EDITORIAL.textSoft} />
          <Text style={styles.noMacro}>No macro data</Text>
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
    borderColor: EDITORIAL.border,
    backgroundColor: EDITORIAL.creamCard,
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
  name: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 16,
    color: EDITORIAL.text,
    lineHeight: 21,
  },
  description: { fontSize: 13, marginTop: 2, lineHeight: 17, color: EDITORIAL.textSoft },
  noMacroRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  noMacro: { fontSize: 13, fontStyle: 'italic', color: EDITORIAL.textSoft },
});
