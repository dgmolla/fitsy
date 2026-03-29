import React, { useCallback, useState } from 'react';
import {
  SafeAreaView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SavedItemResponse } from '@fitsy/shared';
import { getSavedItems, unsaveItem } from '@/lib/apiClient';
import { BookmarkButton, FitsyLoader, MenuItem } from '@/components';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useTheme } from '@/lib/theme';

type Section = {
  title: string;
  restaurantId: string;
  data: SavedItemResponse[];
};

function buildSections(items: SavedItemResponse[]): Section[] {
  const restaurantMap = new Map<string, { name: string; items: SavedItemResponse[] }>();

  for (const item of items) {
    const restaurantId = item.menuItem?.restaurant.id ?? 'unknown';
    const restaurantName = item.menuItem?.restaurant.name ?? 'Unknown Restaurant';
    const bucket = restaurantMap.get(restaurantId) ?? { name: restaurantName, items: [] };
    bucket.items.push(item);
    restaurantMap.set(restaurantId, bucket);
  }

  return Array.from(restaurantMap.entries()).map(([restaurantId, { name, items }]) => ({
    title: name,
    restaurantId,
    data: items,
  }));
}

export default function SavedScreen() {
  const { colors } = useTheme();
  const [savedItems, setSavedItems] = useState<SavedItemResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function load() {
        setLoading(true);
        const result = await getSavedItems();
        if (!cancelled) {
          setSavedItems(result?.data ?? []);
          setLoading(false);
        }
      }

      void load();

      return () => {
        cancelled = true;
      };
    }, [])
  );

  const handleUnsave = useCallback(async (savedItemId: string) => {
    const success = await unsaveItem(savedItemId);
    if (success) {
      setSavedItems((prev) => prev.filter((item) => item.id !== savedItemId));
    }
  }, []);

  const sections = buildSections(savedItems);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScreenHeader />

      {loading ? (
        <View style={styles.centered}>
          <FitsyLoader size="md" />
        </View>
      ) : savedItems.length === 0 ? (
        <View style={styles.centered}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No saved meals yet.{'\n'}Bookmark items from restaurant menus.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section }) => (
            <View style={[styles.sectionHeader, { backgroundColor: colors.bgElevated, borderBottomColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <SavedItemRow item={item} onUnsave={handleUnsave} />
          )}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled
        />
      )}
    </SafeAreaView>
  );
}

interface SavedItemRowProps {
  item: SavedItemResponse;
  onUnsave: (savedItemId: string) => void;
}

function SavedItemRow({ item, onUnsave }: SavedItemRowProps) {
  const menuItem = item.menuItem;
  if (!menuItem) return null;

  // Adapt SavedItemResponse's menuItem shape to MenuItemResult for MenuItem
  const menuItemResult: import('@fitsy/shared').MenuItemResult = {
    id: menuItem.id,
    name: menuItem.name,
    category: menuItem.category ?? undefined,
    price: menuItem.price ?? undefined,
    macros: menuItem.macros,
  };

  return (
    <MenuItem
      item={menuItemResult}
      isSaved
      onToggleSave={() => onUnsave(item.id)}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 32,
  },
});
