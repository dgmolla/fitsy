import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
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

function getTopItems(items: MenuItemResult[], targets: MacroValues | null, count: number): ScoredItem[] {
  return items
    .map((item) => ({ item, pct: computeMatchPct(item, targets) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, count);
}

/* ── Constants ───────────────────────────────────────────────────────────── */

const HERO_HEIGHT = 320;
const TOP_MATCHES_COUNT = 5;
const CONF_HIGH = '#2F8F5B';
const CONF_MED = '#F59E0B';

type Tab = 'forYou' | 'fullMenu';

/* ── Hero ─────────────────────────────────────────────────────────────────── */

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

/* ── Tab Bar (pill switcher) ──────────────────────────────────────────────── */

function TabBar({ activeTab, onTabChange }: { activeTab: Tab; onTabChange: (t: Tab) => void }) {
  return (
    <View style={tS.bar}>
      <Pressable
        onPress={() => onTabChange('forYou')}
        style={[tS.tab, activeTab === 'forYou' && tS.tabOn]}
      >
        <Text style={[tS.label, activeTab === 'forYou' && tS.labelOn]}>For You</Text>
      </Pressable>
      <Pressable
        onPress={() => onTabChange('fullMenu')}
        style={[tS.tab, activeTab === 'fullMenu' && tS.tabOn]}
      >
        <Text style={[tS.label, activeTab === 'fullMenu' && tS.labelOn]}>Full Menu</Text>
      </Pressable>
    </View>
  );
}

const tS = StyleSheet.create({
  bar: {
    flexDirection: 'row', gap: 4,
    marginHorizontal: 20, marginTop: 18, marginBottom: 18,
    backgroundColor: EDITORIAL.creamCard, borderRadius: 12, padding: 4,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
  tabOn: {
    backgroundColor: EDITORIAL.cream,
    shadowColor: EDITORIAL.green, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  label: { fontSize: 13, fontWeight: '700', color: EDITORIAL.textSoft, letterSpacing: 0.2 },
  labelOn: { color: EDITORIAL.green },
});

/* ── #1 Expanded Card ─────────────────────────────────────────────────────── */

function TopPickCard({ scored, isSaved, onToggleSave }: {
  scored: ScoredItem; isSaved: boolean; onToggleSave: (id: string) => void;
}) {
  const { item, pct } = scored;
  const m = item.macros;
  return (
    <View style={tpS.wrap}>
      <View style={tpS.card}>
        <View style={tpS.topRow}>
          <Text style={tpS.rankIdx}>01</Text>
          <Text style={tpS.pct}>{pct}% match</Text>
          <Text style={tpS.topLabel}>Top Pick</Text>
        </View>
        <Text style={tpS.name} numberOfLines={2}>{item.name}</Text>
        {item.description ? (
          <Text style={tpS.desc} numberOfLines={2}>{item.description}</Text>
        ) : null}
        {m ? (
          <View style={tpS.macros}>
            <MacroBlock label="cals" value={m.calories} color={EDITORIAL.text} />
            <MacroBlock label="protein" value={m.proteinG} unit="g" color={MACRO_COLORS.protein} />
            <MacroBlock label="carbs" value={m.carbsG} unit="g" color={MACRO_COLORS.carbs} />
            <MacroBlock label="fat" value={m.fatG} unit="g" color={MACRO_COLORS.fat} />
          </View>
        ) : null}
        <Pressable
          onPress={() => onToggleSave(item.id)}
          style={tpS.saveBtn}
          accessibilityRole="button"
          accessibilityLabel={isSaved ? 'Remove from saved' : 'Save to meals'}
        >
          <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={14} color={EDITORIAL.cream} />
          <Text style={tpS.saveText}>{isSaved ? 'Saved' : 'Save to Meals'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MacroBlock({ label, value, unit, color }: { label: string; value: number; unit?: string; color: string }) {
  return (
    <View style={tpS.mBlock}>
      <Text style={[tpS.mVal, { color }]}>{value}{unit ?? ''}</Text>
      <Text style={tpS.mLabel}>{label}</Text>
    </View>
  );
}

const tpS = StyleSheet.create({
  wrap: { paddingHorizontal: 16, marginBottom: 6 },
  card: { backgroundColor: EDITORIAL.creamCard, borderRadius: 18, padding: 18 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  rankIdx: {
    fontFamily: FONTS.newsreaderItalic, fontSize: 28, color: EDITORIAL.creamDeep,
    lineHeight: 30, letterSpacing: -1,
  },
  pct: { fontSize: 12, fontWeight: '800', color: CONF_HIGH },
  topLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase',
    color: EDITORIAL.textSoft, marginLeft: 'auto',
  },
  name: {
    fontFamily: FONTS.newsreaderBold, fontSize: 20, color: EDITORIAL.text,
    letterSpacing: -0.3, lineHeight: 24, marginBottom: 4,
  },
  desc: { fontSize: 12, fontWeight: '500', color: EDITORIAL.textSoft, lineHeight: 17, marginBottom: 16 },
  macros: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  mBlock: { flex: 1, backgroundColor: EDITORIAL.cream, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  mVal: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  mLabel: { fontSize: 8, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase', color: EDITORIAL.textSoft, marginTop: 1 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: EDITORIAL.green, borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 11, alignSelf: 'flex-start',
  },
  saveText: { fontSize: 13, fontWeight: '700', color: EDITORIAL.cream },
});

/* ── Compact ranked row (#2–5) ────────────────────────────────────────────── */

function RankedRow({ scored, rank, isSaved, onToggleSave }: {
  scored: ScoredItem; rank: number; isSaved: boolean; onToggleSave: (id: string) => void;
}) {
  const { item, pct } = scored;
  const m = item.macros;
  return (
    <View style={rS.card}>
      <Text style={rS.rankIdx}>{String(rank).padStart(2, '0')}</Text>
      <View style={rS.body}>
        <View style={rS.nameRow}>
          <Text style={rS.name} numberOfLines={1}>{item.name}</Text>
          <Text style={[rS.pct, { color: pct >= 80 ? CONF_HIGH : CONF_MED }]}>{pct}%</Text>
        </View>
        {m ? (
          <View style={rS.macros}>
            <InlineMacro value={m.calories} unit="cal" color={EDITORIAL.text} />
            <InlineMacro value={m.proteinG} unit="g pro" color={MACRO_COLORS.protein} />
            <InlineMacro value={m.carbsG} unit="g carb" color={MACRO_COLORS.carbs} />
            <InlineMacro value={m.fatG} unit="g fat" color={MACRO_COLORS.fat} />
          </View>
        ) : null}
      </View>
      <BookmarkButton isSaved={isSaved} onPress={() => onToggleSave(item.id)} />
    </View>
  );
}

function InlineMacro({ value, unit, color }: { value: number; unit: string; color: string }) {
  return (
    <View style={rS.macro}>
      <Text style={[rS.macroVal, { color }]}>{value}</Text>
      <Text style={rS.macroUnit}>{unit}</Text>
    </View>
  );
}

const rS = StyleSheet.create({
  card: {
    marginHorizontal: 16, marginBottom: 6,
    backgroundColor: EDITORIAL.creamCard, borderRadius: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  rankIdx: {
    fontFamily: FONTS.newsreaderItalic, fontSize: 24, color: EDITORIAL.creamDeep,
    lineHeight: 26, letterSpacing: -1, width: 28, flexShrink: 0,
  },
  body: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 3 },
  name: {
    fontFamily: FONTS.newsreaderRegular, fontSize: 16, color: EDITORIAL.text,
    letterSpacing: -0.15, flex: 1,
  },
  pct: { fontSize: 12, fontWeight: '800', flexShrink: 0 },
  macros: { flexDirection: 'row', gap: 10 },
  macro: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  macroVal: { fontSize: 13, fontWeight: '800' },
  macroUnit: { fontSize: 9, fontWeight: '600', color: EDITORIAL.textSoft },
});

/* ── Full Menu Item ───────────────────────────────────────────────────────── */

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
  const [activeTab, setActiveTab] = useState<Tab>('forYou');

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

  const topItems = useMemo(() => {
    if (!menu) return [];
    return getTopItems(menu.menuItems, targets, TOP_MATCHES_COUNT);
  }, [menu, targets]);

  const bestMatch = topItems.length > 0 ? topItems[0] : null;
  const forYouRest = topItems.slice(1);
  const restaurantName = menu?.restaurantName ?? 'Restaurant';

  const forYouHeader = (
    <View style={s.heroPanel}>
      <Hero
        name={restaurantName}
        distance={params.distance}
        cuisine={params.cuisine}
        itemCount={menu?.menuItems.length ?? 0}
        photoUrl={params.photoUrl}
        insetTop={insets.top}
      />
      <View style={s.panel}>
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
        {bestMatch && bestMatch.pct > 0 ? (
          <TopPickCard
            scored={bestMatch}
            isSaved={savedMap.has(bestMatch.item.id)}
            onToggleSave={handleToggleSave}
          />
        ) : null}
      </View>
    </View>
  );

  const fullMenuHeader = (
    <View style={s.heroPanel}>
      <Hero
        name={restaurantName}
        distance={params.distance}
        cuisine={params.cuisine}
        itemCount={menu?.menuItems.length ?? 0}
        photoUrl={params.photoUrl}
        insetTop={insets.top}
      />
      <View style={s.panel}>
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      </View>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.container}>
        {loading && <View style={s.centered}><FitsyLoader size="md" /></View>}
        {!loading && error !== null && (
          <View style={[s.errorBanner, { backgroundColor: colors.errorBg }]}>
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <Text style={[s.errorText, { color: colors.error }]}>{error}</Text>
          </View>
        )}
        {!loading && !error && menu && (
          menu.menuItems.length === 0 ? (
            <View style={s.centered}>
              <Text style={s.emptyText}>No menu items available</Text>
            </View>
          ) : activeTab === 'forYou' ? (
            <FlatList
              data={forYouRest}
              keyExtractor={(sc) => sc.item.id}
              renderItem={({ item: scored, index }) => (
                <RankedRow
                  scored={scored}
                  rank={index + 2}
                  isSaved={savedMap.has(scored.item.id)}
                  onToggleSave={handleToggleSave}
                />
              )}
              ListHeaderComponent={forYouHeader}
              contentContainerStyle={s.listContent}
              style={s.listBg}
              ListEmptyComponent={
                <View style={s.centeredPadded}>
                  <Text style={s.emptyText}>Set your macro targets to see personalized matches</Text>
                </View>
              }
            />
          ) : (
            <FlatList
              data={menu.menuItems}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <FullMenuItem item={item} isSaved={savedMap.has(item.id)} onToggleSave={handleToggleSave} />
              )}
              ListHeaderComponent={fullMenuHeader}
              contentContainerStyle={s.listContent}
              style={s.listBg}
            />
          )
        )}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: EDITORIAL.text },
  listBg: { backgroundColor: EDITORIAL.cream },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, backgroundColor: EDITORIAL.cream },
  centeredPadded: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 40 },
  emptyText: { fontSize: 14, color: EDITORIAL.textSoft, textAlign: 'center' },
  errorBanner: { margin: 16, borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorText: { fontSize: 14, flex: 1 },
  heroPanel: {},
  panel: { backgroundColor: EDITORIAL.cream },
  listContent: { flexGrow: 1, paddingBottom: 32, backgroundColor: EDITORIAL.cream },
});
