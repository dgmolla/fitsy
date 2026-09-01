import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { MenuItemResult } from '@fitsy/shared';
import { BookmarkButton } from './BookmarkButton';
import { BlurFallback } from '@/lib/BlurFallback';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { MACRO_COLORS } from '@/lib/macroColors';
import { deriveTags } from '@/lib/menuFilters';

const HIGH_MATCH_THRESHOLD = 80;

// Below this match %, the badge reads as neutral gray instead of green — a weak
// fit shouldn't wear the brand color at all.
const GRAY_MATCH_THRESHOLD = 40;
// Neutral the low-match badge fades to. Sits a touch warm so it reads on cream.
const MATCH_GRAY = 'rgb(155, 163, 156)'; // #9BA39C

// Match-% → badge color. From GRAY_MATCH_THRESHOLD up to 100 the hue stays green
// but deepens as the match strengthens: pale sage at the threshold, deep forest
// green at a perfect fit. Anything below the threshold collapses to neutral gray.
function matchColor(pct: number): string {
  if (pct < GRAY_MATCH_THRESHOLD) return MATCH_GRAY;
  const t = (pct - GRAY_MATCH_THRESHOLD) / (100 - GRAY_MATCH_THRESHOLD);
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
  // pale sage #8FA896 (low) → deep green #1B3A26 (high)
  const r = lerp(0x8F, 0x1B);
  const g = lerp(0xA8, 0x3A);
  const b = lerp(0x96, 0x26);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Dense menu item card used by the Filter First detail screen.
 * Layout: 48px circular match-% badge · title + italic price · description ·
 * macro/dietary badge row · BookmarkButton.
 *
 * Match-% badge color scales with pct: deeper green = stronger fit.
 */
export function MenuItemCard({
  item, pct, isTopPick, isSaved, onPress, onToggleSave, nameLocked,
}: {
  item: MenuItemResult;
  pct: number;
  isTopPick: boolean;
  isSaved: boolean;
  onPress: () => void;
  onToggleSave: () => void;
  /** True for the free-sample items on a locked (unentitled) menu — the name
   * itself is the thing being teased, so it renders blurred (real text
   * underneath, not blanked) with a "Subscribe to unlock" caption. */
  nameLocked?: boolean;
}) {
  const tags = deriveTags(item);
  const m = item.macros;
  const hasMatch = pct >= 0;
  const dim = hasMatch && pct < HIGH_MATCH_THRESHOLD;
  const badgeColor = hasMatch ? matchColor(pct) : undefined;

  return (
    <Pressable onPress={onPress} style={[s.card, dim && s.cardDim]} accessibilityRole="button">
      <View style={[s.pct, badgeColor ? { borderColor: badgeColor } : null]}>
        <Text style={[s.pctTxt, badgeColor ? { color: badgeColor } : null]}>
          {hasMatch ? `${pct}%` : '—'}
        </Text>
        {/* Only the top match spells out what the number is — labeling every
            row is noise. The tutorial card (detail screen) explains the rest. */}
        {isTopPick && hasMatch ? (
          <Text style={[s.pctMatch, badgeColor ? { color: badgeColor } : null]}>MATCH</Text>
        ) : null}
      </View>
      <View style={s.info}>
        <View style={s.topRow}>
          {nameLocked ? (
            <View style={s.nameLockedWrap}>
              <Text style={s.name} numberOfLines={3}>{item.name}</Text>
              <BlurFallback
                tint="light"
                intensity={40}
                fallbackColor="rgba(253,251,247,0.78)"
                style={StyleSheet.absoluteFillObject as ViewStyle}
              />
            </View>
          ) : (
            <Text style={s.name} numberOfLines={3}>{item.name}</Text>
          )}
          {item.price !== undefined ? (
            <Text style={s.price}>${item.price.toFixed(2)}</Text>
          ) : null}
        </View>
        {nameLocked ? (
          <View style={s.nameLockedTooltip}>
            <Ionicons name="lock-closed" size={10} color={EDITORIAL.greenAccent} />
            <Text style={s.nameLockedTooltipText}>Subscribe to unlock</Text>
          </View>
        ) : null}
        {item.description ? (
          <Text style={s.desc} numberOfLines={2}>{item.description}</Text>
        ) : null}
        <View style={s.badges}>
          {m ? (
            <View style={s.badge}>
              <Text style={s.badgeTxt}>
                {m.proteinG}<Text style={[s.badgeUnit, { color: MACRO_COLORS.protein }]}>p</Text>
              </Text>
            </View>
          ) : null}
          {m ? (
            <View style={s.badge}>
              <Text style={s.badgeTxt}>
                {m.carbsG}<Text style={[s.badgeUnit, { color: MACRO_COLORS.carbs }]}>c</Text>
              </Text>
            </View>
          ) : null}
          {m ? (
            <View style={s.badge}>
              <Text style={s.badgeTxt}>
                {m.fatG}<Text style={[s.badgeUnit, { color: MACRO_COLORS.fat }]}>f</Text>
              </Text>
            </View>
          ) : null}
          {m ? (
            <View style={s.badge}>
              <Text style={s.badgeTxt}>{m.calories}<Text style={s.badgeUnit}>cal</Text></Text>
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
  cardDim: { opacity: 0.85 },
  pct: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: EDITORIAL.creamCard,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: EDITORIAL.greenAccent,
  },
  pctTxt: {
    fontFamily: FONTS.frauncesDisplayBold, fontSize: 16, letterSpacing: -0.3,
    color: EDITORIAL.green,
  },
  pctMatch: {
    fontFamily: FONTS.nunitoSansSemiBold, fontSize: 7, fontWeight: '800',
    letterSpacing: 0.5, color: EDITORIAL.greenAccent, marginTop: -1,
  },
  info: { flex: 1, minWidth: 0 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  name: {
    fontFamily: FONTS.frauncesRegular, fontSize: 17,
    letterSpacing: -0.3, lineHeight: 21, color: EDITORIAL.text, flex: 1,
  },
  price: {
    fontFamily: FONTS.frauncesLightItalic,
    fontSize: 15, color: EDITORIAL.greenMid,
  },
  nameLockedWrap: { flex: 1, borderRadius: 6, overflow: 'hidden' },
  nameLockedTooltip: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  nameLockedTooltipText: {
    fontFamily: FONTS.nunitoSansSemiBold, fontSize: 10.5, fontWeight: '700',
    color: EDITORIAL.greenAccent, letterSpacing: 0.2,
  },
  desc: { fontFamily: FONTS.nunitoSans, fontSize: 11.5, lineHeight: 16, color: EDITORIAL.textSoft, marginTop: 3 },
  badges: { flexDirection: 'row', gap: 6, marginTop: 9, flexWrap: 'wrap' },
  badge: { backgroundColor: EDITORIAL.creamCard, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeMatch: { backgroundColor: EDITORIAL.greenAccentTint },
  badgeTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 11, fontWeight: '700', color: EDITORIAL.text },
  badgeUnit: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 10, fontWeight: '700', color: EDITORIAL.textSoft, letterSpacing: 0.3 },
  bookmarkSlot: { marginLeft: 4, marginTop: -2 },
});
