import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { MenuItemResult, MenuResponse } from '@fitsy/shared';
import { BookmarkButton, FitsyLoader, MenuItemCard } from '@/components';
import { fetchMenu, getSavedItems, saveItem, unsaveItem } from '@/lib/apiClient';
import { getMacroTargets } from '@/lib/macroStorage';
import type { MacroValues } from '@/lib/macroPresets';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { useTheme } from '@/lib/theme';
import {
  trackItemSaved,
  trackMenuFilterChipToggled,
  trackMenuItemTapped,
  trackMenuSearchTyped,
  trackMenuSortChanged,
  trackRestaurantDetailViewed,
} from '@/lib/analytics';
import {
  CHIP_DEFS,
  ChipId,
  SORT_DEFS,
  SortId,
  chipMatches,
  compareBySort,
  deriveTags,
  textMatches,
} from '@/lib/menuFilters';

/* ── Match scoring (unchanged from prior implementation) ────────────────── */

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

/* ── Main Screen ───────────────────────────────────────────────────────── */

export default function RestaurantDetailScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; distance?: string }>();
  const id = params.id;

  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [targets, setTargets] = useState<MacroValues | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMap, setSavedMap] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState('');
  const [activeChips, setActiveChips] = useState<Set<ChipId>>(new Set());
  const [sort, setSort] = useState<SortId>('match');
  const [sortOpen, setSortOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!id) { setError('Invalid restaurant ID'); setLoading(false); return; }
      setLoading(true); setError(null);
      const [result, savedResult, macroTargets] = await Promise.all([
        fetchMenu(id), getSavedItems(), getMacroTargets(),
      ]);
      if (cancelled) return;
      if (result === null) { setError('Could not load menu.'); }
      else {
        setMenu(result);
        trackRestaurantDetailViewed({ restaurant_id: id, item_count: result.menuItems.length });
      }
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

  const scored = useMemo(() => {
    if (!menu) return [];
    return menu.menuItems.map((item) => ({ item, pct: computeMatchPct(item, targets) }));
  }, [menu, targets]);

  const topPickId = useMemo(() => {
    const sortedByMatch = [...scored].sort((a, b) => b.pct - a.pct);
    return sortedByMatch.length > 0 && sortedByMatch[0]!.pct >= 0 ? sortedByMatch[0]!.item.id : null;
  }, [scored]);

  const filtered = useMemo(() => {
    return scored
      .filter(({ item }) => textMatches(item, query))
      .filter(({ item }) => {
        if (activeChips.size === 0) return true;
        const tags = deriveTags(item);
        for (const chip of activeChips) {
          if (!chipMatches(chip, item, tags, targets)) return false;
        }
        return true;
      })
      .sort((a, b) => compareBySort(a, b, sort));
  }, [scored, query, activeChips, sort, targets]);

  const totalCount = menu?.menuItems.length ?? 0;
  const matchCount = filtered.length;
  const restaurantName = menu?.restaurantName ?? 'Restaurant';
  const distanceLabel = params.distance ? `${params.distance} mi` : null;
  const ratingLabel = menu?.rating !== undefined ? menu.rating.toFixed(1) : null;

  const toggleChip = useCallback((chip: ChipId) => {
    setActiveChips((prev) => {
      const next = new Set(prev);
      const isOn = !next.has(chip);
      if (isOn) next.add(chip); else next.delete(chip);
      trackMenuFilterChipToggled({ chip, on: isOn });
      return next;
    });
  }, []);

  const onChangeQuery = useCallback((q: string) => {
    setQuery(q);
    if (q.length === 1 || q.length === 0 || q.length % 5 === 0) {
      // Throttle: emit at the start, on clear, and every 5 chars to avoid event spam.
      trackMenuSearchTyped({ query_length: q.length });
    }
  }, []);

  const onSelectSort = useCallback((s: SortId) => {
    setSort(s); setSortOpen(false);
    trackMenuSortChanged({ sort: s });
  }, []);

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[s.container, s.centered]}><FitsyLoader size="md" /></View>
      </>
    );
  }
  if (error || !menu) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.container}>
          <View style={[s.errorBanner, { backgroundColor: colors.errorBg }]}>
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <Text style={[s.errorText, { color: colors.error }]}>{error ?? 'Could not load menu.'}</Text>
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[s.container, { paddingTop: insets.top }]}>
        {/* Compact top nav: back · name · heart (saves top match) */}
        <View style={s.nav}>
          <Pressable onPress={() => router.back()} style={s.navBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={18} color={EDITORIAL.text} />
          </Pressable>
          <Text style={s.navTitle} numberOfLines={1}>{restaurantName}</Text>
          <View style={s.navBtn}>
            {topPickId ? (
              <BookmarkButton
                isSaved={savedMap.has(topPickId)}
                onPress={() => handleToggleSave(topPickId)}
                accessibilityLabel="Save best matching item"
              />
            ) : (
              <Ionicons name="heart-outline" size={20} color={EDITORIAL.textSoft} />
            )}
          </View>
        </View>

        <FlatList
          data={filtered}
          keyExtractor={({ item }) => item.id}
          renderItem={({ item: scoredItem, index }) => (
            <MenuItemCard
              item={scoredItem.item}
              pct={scoredItem.pct}
              isTopPick={scoredItem.item.id === topPickId}
              isSaved={savedMap.has(scoredItem.item.id)}
              onPress={() => {
                trackMenuItemTapped({
                  menu_item_id: scoredItem.item.id,
                  restaurant_id: id ?? '',
                  position: index,
                });
              }}
              onToggleSave={() => handleToggleSave(scoredItem.item.id)}
            />
          )}
          ListHeaderComponent={
            <View>
              {/* Editorial header */}
              <View style={s.head}>
                <Text style={s.headLine}>
                  What can I eat <Text style={s.headLineEm}>here</Text>?
                </Text>
                <View style={s.metaRow}>
                  <Text style={s.metaB}>{totalCount} items</Text>
                  <Text style={s.metaDot}>·</Text>
                  {distanceLabel ? (
                    <>
                      <Text style={s.metaB}>{distanceLabel}</Text>
                      <Text style={s.metaDot}>·</Text>
                    </>
                  ) : null}
                  <Text style={s.metaB}>Open</Text>
                  {ratingLabel ? (
                    <>
                      <Text style={s.metaDot}>·</Text>
                      <Text style={s.metaSoft}>★ {ratingLabel}</Text>
                    </>
                  ) : null}
                </View>
              </View>

              {/* Search input pill */}
              <View style={s.search}>
                <Text style={s.searchIco}>⌕</Text>
                <TextInput
                  value={query}
                  onChangeText={onChangeQuery}
                  placeholder="Search the menu…"
                  placeholderTextColor={EDITORIAL.textSoft}
                  style={s.searchInput}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                {query.length > 0 ? (
                  <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
                    <Text style={s.searchClear}>×</Text>
                  </Pressable>
                ) : null}
              </View>

              {/* Filter chip row */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.chipRow}
              >
                {CHIP_DEFS.map((def) => {
                  const on = activeChips.has(def.id);
                  return (
                    <Pressable
                      key={def.id}
                      onPress={() => toggleChip(def.id)}
                      style={[s.chip, on && s.chipOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[s.chipTxt, on && s.chipTxtOn]}>{def.label}</Text>
                      {on ? <Text style={s.chipX}>×</Text> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>

              {/* Dark sort bar */}
              <View style={s.sortBar}>
                <View style={{ flex: 1 }}>
                  <Text style={s.sortBarTitle}>{matchCount} dishes match</Text>
                  <Text style={s.sortBarSub}>
                    filtered from {totalCount} · sorted by {SORT_DEFS.find((d) => d.id === sort)?.label.toLowerCase()}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setSortOpen((o) => !o)}
                  style={s.sortBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Change sort"
                >
                  <Text style={s.sortBtnTxt}>Sort ↓</Text>
                </Pressable>
              </View>
              {sortOpen ? (
                <View style={s.sortMenu}>
                  {SORT_DEFS.map((def) => (
                    <Pressable
                      key={def.id}
                      onPress={() => onSelectSort(def.id)}
                      style={[s.sortOpt, sort === def.id && s.sortOptOn]}
                    >
                      <Text style={[s.sortOptTxt, sort === def.id && s.sortOptTxtOn]}>{def.label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <Text style={s.empty}>No dishes match these filters.</Text>
          }
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: EDITORIAL.cream },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  errorBanner: { margin: 16, borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorText: { fontSize: 14, flex: 1 },

  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 10 },
  navBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: EDITORIAL.creamCard, alignItems: 'center', justifyContent: 'center' },
  navTitle: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '600', color: EDITORIAL.text, paddingHorizontal: 8 },

  head: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 14 },
  headLine: { fontFamily: FONTS.newsreaderBold, fontSize: 28, letterSpacing: -0.6, lineHeight: 30, color: EDITORIAL.text },
  headLineEm: { fontFamily: FONTS.newsreaderItalic, fontStyle: 'italic', fontWeight: '500', color: EDITORIAL.greenMid },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  metaB: { fontSize: 11.5, fontWeight: '700', color: EDITORIAL.text },
  metaDot: { color: EDITORIAL.border, fontSize: 11.5 },
  metaSoft: { fontSize: 11.5, color: EDITORIAL.textSoft },

  search: { marginHorizontal: 18, marginTop: 6, backgroundColor: EDITORIAL.creamCard, borderWidth: 1, borderColor: EDITORIAL.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchIco: { fontSize: 16, color: EDITORIAL.textSoft },
  searchInput: { flex: 1, fontSize: 13.5, color: EDITORIAL.text, padding: 0 },
  searchClear: { fontSize: 18, color: EDITORIAL.textSoft, paddingHorizontal: 4 },

  chipRow: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 6, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, backgroundColor: EDITORIAL.cream, borderWidth: 1.5, borderColor: EDITORIAL.border, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipOn: { backgroundColor: EDITORIAL.green, borderColor: EDITORIAL.green },
  chipTxt: { fontSize: 12, fontWeight: '600', color: EDITORIAL.textMid },
  chipTxtOn: { color: EDITORIAL.cream },
  chipX: { fontSize: 12, color: EDITORIAL.cream, opacity: 0.8 },

  sortBar: { marginHorizontal: 18, marginTop: 14, marginBottom: 8, backgroundColor: EDITORIAL.text, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sortBarTitle: { fontFamily: FONTS.newsreaderBold, fontSize: 18, color: EDITORIAL.cream },
  sortBarSub: { fontSize: 11, color: EDITORIAL.cream, opacity: 0.6, letterSpacing: 0.4, marginTop: 2 },
  sortBtn: { backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  sortBtnTxt: { fontSize: 12, fontWeight: '600', color: EDITORIAL.cream },

  sortMenu: { marginHorizontal: 18, marginBottom: 8, backgroundColor: EDITORIAL.creamCard, borderRadius: 12, padding: 4, gap: 2, borderWidth: 1, borderColor: EDITORIAL.border },
  sortOpt: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  sortOptOn: { backgroundColor: EDITORIAL.green },
  sortOptTxt: { fontSize: 13, color: EDITORIAL.text, fontWeight: '500' },
  sortOptTxtOn: { color: EDITORIAL.cream, fontWeight: '600' },

  listContent: { paddingBottom: 36 },
  empty: { paddingHorizontal: 18, paddingVertical: 28, fontSize: 12, fontStyle: 'italic', color: EDITORIAL.textSoft, textAlign: 'center', fontFamily: FONTS.newsreaderRegular },
});
