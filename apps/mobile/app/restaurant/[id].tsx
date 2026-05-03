import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { MenuItemResult, MenuResponse } from '@fitsy/shared';
import { BookmarkButton, FitsyLoader } from '@/components';
import { fetchMenu, getSavedItems, saveItem, unsaveItem } from '@/lib/apiClient';
import { getMacroTargets } from '@/lib/macroStorage';
import type { MacroValues } from '@/lib/macroPresets';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { MACRO_COLORS } from '@/lib/macroColors';
import { useTheme } from '@/lib/theme';
import { trackItemSaved } from '@/lib/analytics';

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function formatTag(tag: string): string {
  return tag.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── Scoring ─────────────────────────────────────────────────────────────── */

type ScoredItem = { item: MenuItemResult; pct: number };

function computeMatchPct(item: MenuItemResult, targets: MacroValues | null): number {
  if (!targets || !item.macros) return -1;
  const t = {
    calories: targets.calories ? Number(targets.calories) : 0,
    protein: targets.protein ? Number(targets.protein) : 0,
    carbs: targets.carbs ? Number(targets.carbs) : 0,
    fat: targets.fat ? Number(targets.fat) : 0,
  };
  const dims: { target: number; actual: number }[] = [];
  if (t.calories > 0) dims.push({ target: t.calories, actual: item.macros.calories });
  if (t.protein > 0) dims.push({ target: t.protein, actual: item.macros.proteinG });
  if (t.carbs > 0) dims.push({ target: t.carbs, actual: item.macros.carbsG });
  if (t.fat > 0) dims.push({ target: t.fat, actual: item.macros.fatG });
  if (dims.length === 0) return -1;
  const avgError = dims.reduce((sum, d) => sum + Math.abs(d.actual - d.target) / d.target, 0) / dims.length;
  return Math.max(0, Math.round((1 - avgError) * 100));
}

function getRankedItems(items: MenuItemResult[], targets: MacroValues | null): ScoredItem[] {
  return items
    .map((item) => ({ item, pct: computeMatchPct(item, targets) }))
    .sort((a, b) => b.pct - a.pct);
}

/* ── Constants ───────────────────────────────────────────────────────────── */

const HERO_HEIGHT = 320;
const HIGH_MATCH_THRESHOLD = 80;
// Macro accents tuned to read on the green Top Pick gradient.
const PICK_PROTEIN = '#A8C5B3';
const PICK_CARBS = '#CBB494';
const PICK_FAT = '#BCADC7';

type ViewMode = 'forYou' | 'fullMenu';

/* ── Hero (unchanged) ─────────────────────────────────────────────────────── */

function Hero({ name, distance, cuisine, itemCount, photoUrl, insetTop }: {
  name: string; distance?: string; cuisine?: string; itemCount: number; photoUrl?: string; insetTop: number;
}) {
  return (
    <View style={hS.wrap}>
      <Image
        source={{ uri: photoUrl || 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=80' }}
        style={hS.image}
      />
      <LinearGradient
        colors={['rgba(0,0,0,0.2)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.7)']}
        locations={[0, 0.3, 0.75, 1]}
        style={StyleSheet.absoluteFill}
      />
      <Pressable
        onPress={() => router.back()}
        style={[hS.back, { top: insetTop + 8 }]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={18} color="#fff" />
      </Pressable>
      <View style={hS.bottom}>
        <Text style={hS.name} numberOfLines={2}>{name}</Text>
        <Text style={hS.meta}>
          {distance ? `${distance} mi` : ''}
          {distance && cuisine ? ' · ' : ''}
          {cuisine ? formatTag(cuisine) : ''}
          {(distance || cuisine) ? ' · ' : ''}
          {itemCount} items
        </Text>
      </View>
    </View>
  );
}

const hS = StyleSheet.create({
  wrap: { height: HERO_HEIGHT, overflow: 'hidden' },
  image: { width: '100%', height: '100%', backgroundColor: '#E5E7EB' },
  back: {
    position: 'absolute', left: 18, width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    zIndex: 10,
  },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 22, paddingBottom: 20 },
  name: {
    fontFamily: FONTS.newsreaderBold, fontSize: 28, color: '#fff',
    letterSpacing: -0.5, lineHeight: 30, marginBottom: 5,
  },
  meta: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
});

/* ── Top Pick Tile ───────────────────────────────────────────────────────── */

function TopPickTile({ scored, isSaved, onToggleSave, onShowFullMenu }: {
  scored: ScoredItem; isSaved: boolean;
  onToggleSave: (id: string) => void;
  onShowFullMenu: () => void;
}) {
  const { item, pct } = scored;
  const m = item.macros;
  return (
    <LinearGradient
      colors={[EDITORIAL.green, EDITORIAL.greenMid]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={tpS.card}
    >
      <View style={tpS.topRow}>
        <View style={tpS.badge}>
          <Text style={tpS.badgeTxt}>TOP PICK · BEST MEAL FOR YOU</Text>
        </View>
        <Text style={tpS.pct}>{pct}<Text style={tpS.pctSmall}>%</Text></Text>
      </View>
      <Text style={tpS.name} numberOfLines={2}>{item.name}</Text>
      {item.description ? (
        <Text style={tpS.desc} numberOfLines={2}>{item.description}</Text>
      ) : null}
      {m ? (
        <View style={tpS.macros}>
          <MacroChip value={String(m.calories)} label="cal" color={EDITORIAL.cream} />
          <MacroChip value={`${m.proteinG}g`} label="pro" color={PICK_PROTEIN} />
          <MacroChip value={`${m.carbsG}g`} label="carb" color={PICK_CARBS} />
          <MacroChip value={`${m.fatG}g`} label="fat" color={PICK_FAT} />
        </View>
      ) : null}
      <View style={tpS.actionRow}>
        <Pressable
          onPress={() => onToggleSave(item.id)}
          style={tpS.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={isSaved ? 'Remove from saved' : 'Save to meals'}
          hitSlop={8}
        >
          <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={18} color={EDITORIAL.cream} />
        </Pressable>
        <Pressable
          onPress={onShowFullMenu}
          style={tpS.fullMenuLink}
          accessibilityRole="button"
          accessibilityLabel="See full menu"
          hitSlop={8}
        >
          <Text style={tpS.fullMenuTxt}>Full menu</Text>
          <Ionicons name="arrow-forward" size={14} color={EDITORIAL.cream} />
        </Pressable>
      </View>
    </LinearGradient>
  );
}

function MacroChip({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <View style={tpS.chip}>
      <Text style={[tpS.chipVal, { color }]}>{value}</Text>
      <Text style={tpS.chipLab}>{label}</Text>
    </View>
  );
}

const tpS = StyleSheet.create({
  card: { borderRadius: 20, padding: 18, gap: 10 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  badgeTxt: { color: EDITORIAL.cream, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.6 },
  pct: { fontFamily: FONTS.newsreaderBold, fontSize: 36, color: EDITORIAL.cream, letterSpacing: -1, lineHeight: 36 },
  pctSmall: { fontSize: 14, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  name: { fontFamily: FONTS.newsreaderBold, fontSize: 23, color: EDITORIAL.cream, letterSpacing: -0.4, lineHeight: 25 },
  desc: { fontSize: 11.5, lineHeight: 16, color: 'rgba(255,255,255,0.78)' },
  macros: { flexDirection: 'row', gap: 5, marginTop: 4 },
  chip: { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center' },
  chipVal: { fontSize: 14, fontWeight: '800', letterSpacing: -0.3 },
  chipLab: { fontSize: 8, fontWeight: '700', letterSpacing: 1.1, color: 'rgba(255,255,255,0.65)', marginTop: 2, textTransform: 'uppercase' },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 6, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.18)',
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  fullMenuLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 4 },
  fullMenuTxt: { fontSize: 13, fontWeight: '700', color: EDITORIAL.cream, letterSpacing: 0.4 },
});

/* ── Stat Tile ───────────────────────────────────────────────────────────── */

function StatTile({ icon, label, value, valueSuffix, subtext, variant = 'light' }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string | number;
  valueSuffix?: string;
  subtext: string;
  variant?: 'light' | 'dark';
}) {
  const isDark = variant === 'dark';
  const bg = isDark ? EDITORIAL.text : EDITORIAL.creamCard;
  const fg = isDark ? EDITORIAL.cream : EDITORIAL.text;
  const labelColor = isDark ? 'rgba(255,255,255,0.55)' : EDITORIAL.textSoft;
  const subColor = isDark ? 'rgba(255,255,255,0.65)' : EDITORIAL.textSoft;
  const suffixColor = isDark ? 'rgba(255,255,255,0.5)' : EDITORIAL.textSoft;
  return (
    <View style={[stS.tile, { backgroundColor: bg }]}>
      <View style={stS.labelRow}>
        <Ionicons name={icon} size={11} color={labelColor} />
        <Text style={[stS.label, { color: labelColor }]}>{label}</Text>
      </View>
      <View>
        <Text style={[stS.value, { color: fg }]}>
          {value}
          {valueSuffix ? <Text style={[stS.valueSuffix, { color: suffixColor }]}>{valueSuffix}</Text> : null}
        </Text>
        <Text style={[stS.sub, { color: subColor }]} numberOfLines={1}>{subtext}</Text>
      </View>
    </View>
  );
}

const stS = StyleSheet.create({
  tile: {
    flex: 1, borderRadius: 18, padding: 14,
    minHeight: 104, justifyContent: 'space-between',
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  label: { fontSize: 9.5, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase' },
  value: { fontFamily: FONTS.newsreaderBold, fontSize: 30, letterSpacing: -1, lineHeight: 32 },
  valueSuffix: { fontSize: 14, fontFamily: undefined, fontWeight: '500', letterSpacing: 0 },
  sub: { fontSize: 11, fontWeight: '500', marginTop: 4 },
});

/* ── Match Ring Tile ─────────────────────────────────────────────────────── */
// Decorative ring (no progress arc — we don't have react-native-svg).
// The percent text inside carries the data.

function MatchRingTile({ percent }: { percent: number | null }) {
  return (
    <View style={[stS.tile, { backgroundColor: EDITORIAL.creamDeep, alignItems: 'center', justifyContent: 'center', gap: 8 }]}>
      <View style={ringS.ring}>
        <View style={ringS.inner}>
          <Text style={ringS.pct}>{percent !== null ? `${percent}%` : '—'}</Text>
        </View>
      </View>
      <Text style={[stS.label, { color: EDITORIAL.textSoft }]}>AVG MATCH</Text>
    </View>
  );
}

const ringS = StyleSheet.create({
  ring: {
    width: 56, height: 56, borderRadius: 28,
    borderWidth: 5, borderColor: EDITORIAL.greenAccent,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: EDITORIAL.creamCard,
  },
  inner: { alignItems: 'center', justifyContent: 'center' },
  pct: { fontFamily: FONTS.newsreaderBold, fontSize: 15, color: EDITORIAL.text, letterSpacing: -0.4 },
});

/* ── Saved Tile ──────────────────────────────────────────────────────────── */
// TODO(social): wire `count` and avatar colors to real follow-graph data.
// For now this is a static placeholder — same shape as the 05a mockup.

function SavedTile({ count }: { count: number }) {
  return (
    <View style={savS.tile}>
      <View style={savS.left}>
        <Text style={savS.label}>★ SAVED BY</Text>
        <Text style={savS.big}>{count}</Text>
        <Text style={savS.sub}>people you follow</Text>
      </View>
      <View style={savS.avatars}>
        <View style={[savS.av, { backgroundColor: '#C84B31' }]} />
        <View style={[savS.av, { backgroundColor: '#CBB494', marginLeft: -6 }]} />
        <View style={[savS.av, { backgroundColor: '#A8C5B3', marginLeft: -6 }]} />
        <View style={[savS.av, savS.avMore, { marginLeft: -6 }]}>
          <Text style={savS.avMoreTxt}>+{Math.max(0, count - 3)}</Text>
        </View>
      </View>
    </View>
  );
}

const savS = StyleSheet.create({
  tile: {
    backgroundColor: EDITORIAL.green, borderRadius: 18, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  left: { flex: 1 },
  label: { fontSize: 9.5, fontWeight: '700', letterSpacing: 1.6, color: 'rgba(255,255,255,0.55)' },
  big: { fontFamily: FONTS.newsreaderBold, fontSize: 30, color: EDITORIAL.cream, letterSpacing: -1, lineHeight: 32, marginTop: 4 },
  sub: { fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: '500', marginTop: 4 },
  avatars: { flexDirection: 'row' },
  av: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: EDITORIAL.green },
  avMore: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  avMoreTxt: { fontSize: 10, fontWeight: '700', color: EDITORIAL.cream },
});

/* ── Full Menu Item (unchanged behavior) ─────────────────────────────────── */

function FullMenuItem({ item, isSaved, onToggleSave }: {
  item: MenuItemResult; isSaved: boolean; onToggleSave: (id: string) => void;
}) {
  const m = item.macros;
  return (
    <View style={fS.card}>
      <View style={fS.topRow}>
        <View style={fS.nameBlock}>
          <Text style={fS.name} numberOfLines={2}>{item.name}</Text>
          {item.description ? <Text style={fS.desc} numberOfLines={1}>{item.description}</Text> : null}
        </View>
        <BookmarkButton isSaved={isSaved} onPress={() => onToggleSave(item.id)} />
      </View>
      {m ? (
        <View style={fS.macros}>
          {([
            { label: 'CALS', value: m.calories, color: EDITORIAL.text, unit: '' },
            { label: 'PRO', value: m.proteinG, color: MACRO_COLORS.protein, unit: 'g' },
            { label: 'CARB', value: m.carbsG, color: MACRO_COLORS.carbs, unit: 'g' },
            { label: 'FAT', value: m.fatG, color: MACRO_COLORS.fat, unit: 'g' },
          ] as const).map(({ label, value, color, unit }) => (
            <View key={label} style={fS.chip}>
              <Text style={fS.chipLabel}>{label}</Text>
              <Text style={[fS.chipValue, { color }]}>{value}{unit}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={fS.noMacroRow}>
          <Ionicons name="alert-circle-outline" size={14} color={EDITORIAL.textSoft} />
          <Text style={fS.noMacro}>No macro data</Text>
        </View>
      )}
    </View>
  );
}

const fS = StyleSheet.create({
  card: {
    marginHorizontal: 16, marginBottom: 6, borderRadius: 14,
    backgroundColor: EDITORIAL.creamCard, paddingHorizontal: 16, paddingVertical: 14,
  },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  nameBlock: { flex: 1, marginRight: 8 },
  name: { fontFamily: FONTS.newsreaderRegular, fontSize: 16, color: EDITORIAL.text, lineHeight: 21 },
  desc: { fontSize: 13, marginTop: 2, lineHeight: 17, color: EDITORIAL.textSoft },
  macros: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { alignItems: 'center', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, gap: 2, backgroundColor: EDITORIAL.cream },
  chipLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, color: EDITORIAL.textSoft },
  chipValue: { fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },
  noMacroRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  noMacro: { fontSize: 13, fontStyle: 'italic', color: EDITORIAL.textSoft },
});

/* ── Main Screen ─────────────────────────────────────────────────────────── */

export default function RestaurantDetailScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; address?: string; distance?: string; photoUrl?: string; cuisine?: string }>();
  const id = params.id;
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [targets, setTargets] = useState<MacroValues | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMap, setSavedMap] = useState<Map<string, string>>(new Map());
  const [view, setView] = useState<ViewMode>('forYou');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!id) { setError('Invalid restaurant ID'); setLoading(false); return; }
      setLoading(true); setError(null);
      const [result, savedResult, macroTargets] = await Promise.all([
        fetchMenu(id),
        getSavedItems(),
        getMacroTargets(),
      ]);
      if (cancelled) return;
      if (result === null) { setError('Could not load menu.'); }
      else { setMenu(result); }
      setTargets(macroTargets);
      if (savedResult) {
        const m = new Map<string, string>();
        for (const saved of savedResult.data) { if (saved.menuItemId) m.set(saved.menuItemId, saved.id); }
        setSavedMap(m);
      }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [id]);

  const handleToggleSave = useCallback(async (menuItemId: string) => {
    const existingId = savedMap.get(menuItemId);
    if (existingId) {
      const ok = await unsaveItem(existingId);
      if (ok) {
        setSavedMap((p) => { const n = new Map(p); n.delete(menuItemId); return n; });
        trackItemSaved({ menu_item_id: menuItemId, restaurant_id: id ?? '', action: 'unsave', entry_point: 'restaurant_detail' });
      }
    } else {
      const saved = await saveItem(menuItemId);
      if (saved) {
        setSavedMap((p) => new Map(p).set(menuItemId, saved.id));
        trackItemSaved({ menu_item_id: menuItemId, restaurant_id: id ?? '', action: 'save', entry_point: 'restaurant_detail' });
      }
    }
  }, [savedMap, id]);

  const ranked = useMemo(
    () => (menu ? getRankedItems(menu.menuItems, targets) : []),
    [menu, targets],
  );
  const bestMatch = ranked.length > 0 && ranked[0].pct > 0 ? ranked[0] : null;
  const overEightyCount = ranked.filter((r) => r.pct >= HIGH_MATCH_THRESHOLD).length;

  const avgMatch = useMemo(() => {
    const valid = ranked.filter((r) => r.pct >= 0).map((r) => r.pct);
    if (valid.length === 0) return null;
    return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
  }, [ranked]);

  const avgCal = useMemo(() => {
    const cals = (menu?.menuItems ?? []).filter((i) => i.macros).map((i) => i.macros!.calories);
    if (cals.length === 0) return null;
    return Math.round(cals.reduce((a, b) => a + b, 0) / cals.length);
  }, [menu]);

  const avgProtein = useMemo(() => {
    const pros = (menu?.menuItems ?? []).filter((i) => i.macros).map((i) => i.macros!.proteinG);
    if (pros.length === 0) return null;
    return Math.round(pros.reduce((a, b) => a + b, 0) / pros.length);
  }, [menu]);

  const restaurantName = menu?.restaurantName ?? 'Restaurant';
  const itemCount = menu?.menuItems.length ?? 0;

  const heroEl = (
    <Hero
      name={restaurantName}
      distance={params.distance}
      cuisine={params.cuisine}
      itemCount={itemCount}
      photoUrl={params.photoUrl}
      insetTop={insets.top}
    />
  );

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[s.container, s.centered]}><FitsyLoader size="md" /></View>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.container}>
          <View style={[s.errorBanner, { backgroundColor: colors.errorBg }]}>
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <Text style={[s.errorText, { color: colors.error }]}>{error}</Text>
          </View>
        </View>
      </>
    );
  }

  if (!menu || menu.menuItems.length === 0) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.container}>
          {heroEl}
          <View style={s.centered}><Text style={s.emptyText}>No menu items available</Text></View>
        </View>
      </>
    );
  }

  if (view === 'forYou') {
    const ratingValue = menu.rating !== undefined ? menu.rating.toFixed(1) : '—';
    const ratingSubtext = menu.userRatingCount !== undefined
      ? `${menu.userRatingCount.toLocaleString()} reviews`
      : 'No ratings yet';
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.container}>
          <ScrollView style={s.listBg} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
            {heroEl}
            <View style={s.bento}>
              {bestMatch ? (
                <TopPickTile
                  scored={bestMatch}
                  isSaved={savedMap.has(bestMatch.item.id)}
                  onToggleSave={handleToggleSave}
                  onShowFullMenu={() => setView('fullMenu')}
                />
              ) : (
                <View style={s.emptyBanner}>
                  <Text style={s.emptyText}>Set your macro targets to see personalized matches</Text>
                </View>
              )}

              <View style={s.row}>
                <StatTile
                  icon="star"
                  label="RATING"
                  value={ratingValue}
                  subtext={ratingSubtext}
                />
                <StatTile
                  icon="flash-outline"
                  label="AVG MEAL"
                  value={avgCal ?? '—'}
                  valueSuffix=" kcal"
                  subtext={avgProtein !== null ? `${avgProtein}g protein` : 'No macro data'}
                  variant="dark"
                />
              </View>

              <View style={s.row}>
                <StatTile
                  icon="restaurant-outline"
                  label="ITEMS"
                  value={itemCount}
                  subtext={`${overEightyCount} over 80% match`}
                />
                <MatchRingTile percent={avgMatch} />
              </View>

              <SavedTile count={12} />
            </View>
          </ScrollView>
        </View>
      </>
    );
  }

  // Full menu view
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.container}>
        <FlatList
          data={menu.menuItems}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <FullMenuItem item={item} isSaved={savedMap.has(item.id)} onToggleSave={handleToggleSave} />
          )}
          ListHeaderComponent={
            <View>
              {heroEl}
              <Pressable onPress={() => setView('forYou')} style={s.backRow} accessibilityRole="button">
                <Ionicons name="arrow-back" size={14} color={EDITORIAL.greenMid} />
                <Text style={s.backTxt}>Back to picks</Text>
              </Pressable>
            </View>
          }
          contentContainerStyle={s.listContent}
          style={s.listBg}
        />
      </View>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: EDITORIAL.text },
  listBg: { backgroundColor: EDITORIAL.cream },
  scrollContent: { paddingBottom: 36, backgroundColor: EDITORIAL.cream },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, backgroundColor: EDITORIAL.cream },
  emptyText: { fontSize: 14, color: EDITORIAL.textSoft, textAlign: 'center' },
  emptyBanner: { backgroundColor: EDITORIAL.creamCard, borderRadius: 18, padding: 22, alignItems: 'center' },
  errorBanner: { margin: 16, borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorText: { fontSize: 14, flex: 1 },
  bento: { paddingHorizontal: 14, paddingTop: 14, gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  backRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 22, paddingTop: 16, paddingBottom: 8,
    backgroundColor: EDITORIAL.cream,
  },
  backTxt: { fontSize: 12, fontWeight: '700', color: EDITORIAL.greenMid, letterSpacing: 0.4 },
  listContent: { flexGrow: 1, paddingBottom: 32, backgroundColor: EDITORIAL.cream },
});
