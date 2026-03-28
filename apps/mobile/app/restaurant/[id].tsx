import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MenuItemResult, MenuResponse, SavedItemResponse } from '@fitsy/shared';
import { FitsyLoader, MenuItem } from '@/components';
import { fetchMenu, getSavedItems, saveItem, unsaveItem } from '@/lib/apiClient';

type Section = {
  title: string;
  data: MenuItemResult[];
};

function buildSections(items: MenuItemResult[]): Section[] {
  const categoryMap = new Map<string, MenuItemResult[]>();

  for (const item of items) {
    const key = item.category ?? '';
    const bucket = categoryMap.get(key) ?? [];
    bucket.push(item);
    categoryMap.set(key, bucket);
  }

  return Array.from(categoryMap.entries()).map(([title, data]) => ({
    title,
    data,
  }));
}

function hasCategories(items: MenuItemResult[]): boolean {
  return items.some((item) => Boolean(item.category));
}

export default function RestaurantDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Map from menuItemId -> savedItemId (present when saved)
  const [savedMap, setSavedMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!id) {
        setError('Invalid restaurant ID');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const [result, savedResult] = await Promise.all([
        fetchMenu(id),
        getSavedItems(),
      ]);

      if (cancelled) return;

      if (result === null) {
        setError('Could not load menu. Please try again.');
      } else {
        setMenu(result);
      }

      if (savedResult) {
        const map = new Map<string, string>();
        for (const saved of savedResult.data) {
          if (saved.menuItemId) {
            map.set(saved.menuItemId, saved.id);
          }
        }
        setSavedMap(map);
      }

      setLoading(false);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleToggleSave = useCallback(async (menuItemId: string) => {
    const existingSavedId = savedMap.get(menuItemId);
    if (existingSavedId) {
      const success = await unsaveItem(existingSavedId);
      if (success) {
        setSavedMap((prev) => {
          const next = new Map(prev);
          next.delete(menuItemId);
          return next;
        });
      }
    } else {
      const saved = await saveItem(menuItemId);
      if (saved) {
        setSavedMap((prev) => new Map(prev).set(menuItemId, saved.id));
      }
    }
  }, [savedMap]);

  const restaurantName = menu?.restaurantName ?? 'Restaurant';

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: restaurantName,
          headerBackTitle: 'Back',
          headerStyle: { backgroundColor: '#FFFFFF' },
          headerTitleStyle: { fontWeight: '700', color: '#111827' },
          headerTintColor: '#2D7D46',
        }}
      />
      <View style={styles.container}>
        {loading && (
          <View style={styles.centered}>
            <FitsyLoader size="md" />
          </View>
        )}

        {!loading && error !== null && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!loading && error === null && menu !== null && (
          <>
            {menu.menuItems.length === 0 ? (
              <View style={styles.centered}>
                <Text style={styles.emptyText}>No menu items available</Text>
              </View>
            ) : hasCategories(menu.menuItems) ? (
              <SectionList
                sections={buildSections(menu.menuItems)}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <MenuItem
                    item={item}
                    isSaved={savedMap.has(item.id)}
                    onToggleSave={handleToggleSave}
                  />
                )}
                renderSectionHeader={({ section }) =>
                  section.title ? (
                    <View style={styles.sectionHeader}>
                      <Text style={styles.sectionTitle}>{section.title}</Text>
                    </View>
                  ) : null
                }
                contentContainerStyle={styles.listContent}
                stickySectionHeadersEnabled
              />
            ) : (
              <FlatList
                data={menu.menuItems}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <MenuItem
                    item={item}
                    isSaved={savedMap.has(item.id)}
                    onToggleSave={handleToggleSave}
                  />
                )}
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
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
  },
  errorBanner: {
    margin: 16,
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    padding: 12,
  },
  errorText: {
    fontSize: 14,
    color: '#DC2626',
    textAlign: 'center',
  },
  sectionHeader: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 32,
  },
});
