import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MenuItemResult } from '@fitsy/shared';
import { BookmarkButton } from './BookmarkButton';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { MACRO_COLORS, MACRO_TINTS } from '@/lib/macroColors';
import { deriveTags } from '@/lib/menuFilters';

const HIGH_MATCH_THRESHOLD = 80;

/**
 * Dense menu item card used by the Filter First detail screen.
 * Layout: 48px circular match-% badge · title + italic price · description ·
 * macro/dietary badge row · BookmarkButton.
 *
 * Items below HIGH_MATCH_THRESHOLD render with a dimmed badge border and
 * 0.55 card opacity per mockup 08.
 */
export function MenuItemCard({
  item, pct, isTopPick, isSaved, onPress, onToggleSave,
}: {
  item: MenuItemResult;
  pct: number;
  isTopPick: boolean;
  isSaved: boolean;
  onPress: () => void;
  onToggleSave: () => void;
}) {
  const tags = deriveTags(item);
  const m = item.macros;
  const hasMatch = pct >= 0;
  const isHigh = pct >= HIGH_MATCH_THRESHOLD;
  const dim = hasMatch && !isHigh;

  return (
    <Pressable onPress={onPress} style={[s.card, dim && s.cardDim]} accessibilityRole="button">
      <View style={[s.pct, !isHigh && hasMatch && { borderColor: EDITORIAL.textSoft }]}>
        <Text style={[s.pctTxt, !isHigh && hasMatch && { color: EDITORIAL.textSoft }]}>
          {hasMatch ? `${pct}%` : '—'}
        </Text>
      </View>
      <View style={s.info}>
        <View style={s.topRow}>
          <Text style={s.name} numberOfLines={2}>{item.name}</Text>
          {item.price !== undefined ? (
            <Text style={s.price}>${item.price.toFixed(2)}</Text>
          ) : null}
        </View>
        {item.description ? (
          <Text style={s.desc} numberOfLines={2}>{item.description}</Text>
        ) : null}
        <View style={s.badges}>
          {m ? (
            <View style={[s.badge, s.badgePro]}>
              <Text style={[s.badgeTxt, { color: MACRO_COLORS.protein }]}>
                {m.proteinG}G PROTEIN
              </Text>
            </View>
          ) : null}
          {m ? (
            <View style={s.badge}>
              <Text style={s.badgeTxt}>{m.calories} CAL</Text>
            </View>
          ) : null}
          {isTopPick ? (
            <View style={[s.badge, s.badgeMatch]}>
              <Text style={[s.badgeTxt, { color: EDITORIAL.greenAccent }]}>TOP PICK</Text>
            </View>
          ) : null}
          {tags.vegan ? (
            <View style={[s.badge, s.badgeMatch]}>
              <Text style={[s.badgeTxt, { color: EDITORIAL.greenAccent }]}>VEGAN</Text>
            </View>
          ) : null}
          {tags.spicy ? (
            <View style={s.badge}><Text style={s.badgeTxt}>SPICY</Text></View>
          ) : null}
          {tags.glutenFree ? (
            <View style={s.badge}><Text style={s.badgeTxt}>GLUTEN FREE</Text></View>
          ) : null}
        </View>
      </View>
      <View style={s.bookmarkSlot}>
        <BookmarkButton isSaved={isSaved} onPress={onToggleSave} />
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    marginHorizontal: 18, marginTop: 8,
    backgroundColor: EDITORIAL.cream, borderWidth: 1, borderColor: EDITORIAL.border,
    borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14,
    flexDirection: 'row', gap: 14, alignItems: 'flex-start',
  },
  cardDim: { opacity: 0.55 },
  pct: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: EDITORIAL.creamCard,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: EDITORIAL.greenAccent,
  },
  pctTxt: {
    fontFamily: FONTS.newsreaderBold, fontSize: 14, letterSpacing: -0.3,
    color: EDITORIAL.greenAccent,
  },
  info: { flex: 1, minWidth: 0 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  name: {
    fontFamily: FONTS.newsreaderRegular, fontWeight: '600', fontSize: 17,
    letterSpacing: -0.2, lineHeight: 20, color: EDITORIAL.text, flex: 1,
  },
  price: {
    fontFamily: FONTS.newsreaderItalic, fontStyle: 'italic', fontWeight: '600',
    fontSize: 14, color: EDITORIAL.greenMid,
  },
  desc: { fontSize: 11.5, lineHeight: 16, color: EDITORIAL.textSoft, marginTop: 3 },
  badges: { flexDirection: 'row', gap: 6, marginTop: 9, flexWrap: 'wrap' },
  badge: { backgroundColor: EDITORIAL.creamCard, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  badgePro: { backgroundColor: MACRO_TINTS.proteinTint },
  badgeMatch: { backgroundColor: EDITORIAL.greenAccentTint },
  badgeTxt: { fontSize: 9.5, letterSpacing: 0.8, fontWeight: '700', color: EDITORIAL.textMid },
  bookmarkSlot: { marginLeft: 4, marginTop: -2 },
});
