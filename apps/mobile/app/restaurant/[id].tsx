import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, SectionList, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MenuItemResult, MenuResponse } from '@fitsy/shared';
import { FitsyLoader, MenuItem } from '@/components';
import { fetchMenu, getSavedItems, saveItem, unsaveItem } from '@/lib/apiClient';
import { useTheme } from '@/lib/theme';
import { BRAND } from '@/lib/brand';

type Section = { title: string; data: MenuItemResult[] };

function buildSections(items: MenuItemResult[]): Section[] {
  const map = new Map<string, MenuItemResult[]>();
  for (const item of items) {
    const key = item.category ?? '';
    const bucket = map.get(key) ?? [];
    bucket.push(item);
    map.set(key, bucket);
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}

function hasCategories(items: MenuItemResult[]): boolean {
  return items.some((i) => Boolean(i.category));
}

function HeroHeader({ name, itemCount }: { name: string; itemCount: number }) {
  const { colors } = useTheme();
  const highCount = itemCount; // all items shown
  return (
    <View style={[styles.hero, { backgroundColor: colors.bg }]}>
      <Text style={[styles.heroName, { color: colors.textPrimary }]}>{name}</Text>
      <View style={styles.infoPills}>
        <View style={[styles.pill, { backgroundColor: colors.accentBg, borderColor: colors.accentBorder }]}>
          <Ionicons name="sparkles" size={12} color={colors.accent} />
          <Text style={[styles.pillText, { color: colors.accent }]}>Macro Fit</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: colors.bgElevated, borderColor: colors.borderSubtle }]}>
          <Ionicons name="restaurant-outline" size={12} color={colors.textSecondary} />
          <Text style={[styles.pillText, { color: colors.textSecondary }]}>{highCount} items</Text>
        </View>
      </View>
      <View style={styles.sectionLabel}>
        <Ionicons name="leaf" size={14} color={colors.accent} />
        <Text style={[styles.sectionLabelText, { color: colors.textPrimary }]}>AI Estimated Menu</Text>
        <View style={[styles.aiBadge, { backgroundColor: colors.accentBg }]}>
          <Text style={[styles.aiBadgeText, { color: colors.accent }]}>AI</Text>
        </View>
      </View>
    </View>
  );
}

export default function RestaurantDetailScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMap, setSavedMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!id) { setError('Invalid restaurant ID'); setLoading(false); return; }
      setLoading(true); setError(null);
      const [result, savedResult] = await Promise.all([fetchMenu(id), getSavedItems()]);
      if (cancelled) return;
      if (result === null) { setError('Could not load menu. Please try again.'); }
      else { setMenu(result); }
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
      if (ok) setSavedMap((p) => { const n = new Map(p); n.delete(menuItemId); return n; });
    } else {
      const saved = await saveItem(menuItemId);
      if (saved) setSavedMap((p) => new Map(p).set(menuItemId, saved.id));
    }
  }, [savedMap]);

  const restaurantName = menu?.restaurantName ?? 'Restaurant';
  const renderItem = useCallback(({ item }: { item: MenuItemResult }) => (
    <MenuItem item={item} isSaved={savedMap.has(item.id)} onToggleSave={handleToggleSave} />
  ), [savedMap, handleToggleSave]);

  return (
    <>
      <Stack.Screen options={{
        headerShown: true, title: restaurantName, headerBackTitle: 'Back',
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { fontWeight: '700', color: colors.textPrimary },
        headerTintColor: BRAND.color,
      }} />
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        {loading && (
          <View style={styles.centered}><FitsyLoader size="md" /></View>
        )}
        {!loading && error !== null && (
          <View style={[styles.errorBanner, { backgroundColor: colors.errorBg }]}>
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          </View>
        )}
        {!loading && error === null && menu !== null && (
          <>
            {menu.menuItems.length === 0 ? (
              <View style={styles.centered}>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No menu items available</Text>
              </View>
            ) : hasCategories(menu.menuItems) ? (
              <SectionList
                sections={buildSections(menu.menuItems)}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                renderSectionHeader={({ section }) => section.title ? (
                  <View style={[styles.sectionHeader, { backgroundColor: colors.bgElevated, borderBottomColor: colors.border }]}>
                    <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{section.title}</Text>
                  </View>
                ) : null}
                ListHeaderComponent={<HeroHeader name={restaurantName} itemCount={menu.menuItems.length} />}
                contentContainerStyle={styles.listContent}
                stickySectionHeadersEnabled
              />
            ) : (
              <FlatList
                data={menu.menuItems}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                ListHeaderComponent={<HeroHeader name={restaurantName} itemCount={menu.menuItems.length} />}
                contentContainerStyle={styles.listContent}
              />
            )}
          </>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  hero: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  heroName: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5, marginBottom: 10 },
  infoPills: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { fontSize: 12, fontWeight: '600' },
  sectionLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionLabelText: { fontSize: 15, fontWeight: '700' },
  aiBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  aiBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  emptyText: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  errorBanner: { margin: 16, borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorText: { fontSize: 14, flex: 1 },
  sectionHeader: { paddingHorizontal: 20, paddingVertical: 6, borderBottomWidth: 1 },
  sectionTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  listContent: { flexGrow: 1, paddingBottom: 32 },
});
