import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { MenuItemResult, MenuResponse } from '@fitsy/shared';
import { FitsyLoader, MenuItem } from '@/components';
import { fetchMenu, getSavedItems, saveItem, unsaveItem } from '@/lib/apiClient';
import { useTheme } from '@/lib/theme';

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

const HERO_IMAGE_HEIGHT = 220;
const HERO_OVERLAP = 44;

// Mock image — will be replaced with real restaurant photos later
const MOCK_RESTAURANT_IMAGE = 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=80';

function HeroSection({ name, address, distance, itemCount }: {
  name: string; address?: string; distance?: string; itemCount: number;
}) {
  const { colors } = useTheme();

  return (
    <View style={styles.heroWrap}>
      <Image source={{ uri: MOCK_RESTAURANT_IMAGE }} style={styles.heroImage} />

      <View style={[styles.heroCard, {
        backgroundColor: colors.bg,
      }]}>
        <View style={styles.heroTop}>
          <Text style={[styles.heroName, { color: colors.textPrimary }]} numberOfLines={2}>
            {name}
          </Text>
        </View>

        <View style={styles.infoRow}>
          {distance ? (
            <View style={styles.infoItem}>
              <Ionicons name="navigate-outline" size={13} color={colors.textSecondary} />
              <Text style={[styles.infoValue, { color: colors.textSecondary }]}>{distance} mi</Text>
            </View>
          ) : null}
          <View style={styles.infoItem}>
            <Ionicons name="restaurant-outline" size={13} color={colors.textSecondary} />
            <Text style={[styles.infoValue, { color: colors.textSecondary }]}>{itemCount} items</Text>
          </View>
        </View>

        {address ? (
          <View style={styles.addressRow}>
            <Ionicons name="location-outline" size={13} color={colors.textTertiary} />
            <Text style={[styles.addressText, { color: colors.textTertiary }]} numberOfLines={1}>
              {address}
            </Text>
          </View>
        ) : null}

        <View style={[styles.menuLabel, { borderTopColor: colors.borderSubtle }]}>
          <Ionicons name="leaf" size={14} color={colors.accent} />
          <Text style={[styles.menuLabelText, { color: colors.textPrimary }]}>AI Estimated Menu</Text>
          <View style={[styles.aiBadge, { backgroundColor: colors.accentBg }]}>
            <Text style={[styles.aiBadgeText, { color: colors.accent }]}>AI</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

export default function RestaurantDetailScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; address?: string; distance?: string }>();
  const id = params.id;
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
      if (result === null) { setError('Could not load menu.'); }
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

  const header = (
    <HeroSection
      name={restaurantName}
      address={params.address}
      distance={params.distance}
      itemCount={menu?.menuItems.length ?? 0}
    />
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        {/* Floating back button */}
        <Pressable
          onPress={() => router.back()}
          style={[styles.backButton, { top: insets.top + 8, backgroundColor: colors.bg }]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        {loading && <View style={styles.centered}><FitsyLoader size="md" /></View>}
        {!loading && error !== null && (
          <View style={[styles.errorBanner, { backgroundColor: colors.errorBg }]}>
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          </View>
        )}
        {!loading && !error && menu && (
          menu.menuItems.length === 0 ? (
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
              ListHeaderComponent={header}
              contentContainerStyle={styles.listContent}
              stickySectionHeadersEnabled
            />
          ) : (
            <FlatList
              data={menu.menuItems}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              ListHeaderComponent={header}
              contentContainerStyle={styles.listContent}
            />
          )
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  backButton: {
    position: 'absolute',
    left: 16,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  heroWrap: { marginBottom: 8 },
  heroImage: {
    width: '100%',
    height: HERO_IMAGE_HEIGHT,
    backgroundColor: '#E5E7EB',
  },
  heroCard: {
    marginTop: -HERO_OVERLAP,
    marginHorizontal: 16,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
  },
  heroTop: {
    marginBottom: 14,
  },
  heroName: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  infoRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  infoItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 14,
  },
  addressText: {
    fontSize: 12,
    flex: 1,
  },
  menuLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  menuLabelText: { fontSize: 15, fontWeight: '700' },
  aiBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  aiBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  emptyText: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  errorBanner: { margin: 16, borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorText: { fontSize: 14, flex: 1 },
  sectionHeader: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, borderBottomWidth: 1 },
  sectionTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  listContent: { flexGrow: 1, paddingBottom: 32 },
});
