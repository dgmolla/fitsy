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
import { BookmarkButton, FitsyLoader } from '@/components';

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
    <SafeAreaView style={styles.container}>
      <Text style={styles.screenTitle}>Saved</Text>

      {loading ? (
        <View style={styles.centered}>
          <FitsyLoader size="md" />
        </View>
      ) : savedItems.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            No saved meals yet.{'\n'}Bookmark items from restaurant menus.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
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

  const priceLabel =
    menuItem.price !== undefined && menuItem.price !== null
      ? `$${menuItem.price.toFixed(2)}`
      : null;

  return (
    <View style={styles.row}>
      <View style={styles.topRow}>
        <View style={styles.nameBlock}>
          <Text style={styles.itemName} numberOfLines={2}>
            {menuItem.name}
          </Text>
          {menuItem.category ? (
            <Text style={styles.category}>{menuItem.category}</Text>
          ) : null}
        </View>
        <View style={styles.rightBlock}>
          {priceLabel ? <Text style={styles.price}>{priceLabel}</Text> : null}
          <BookmarkButton
            isSaved
            onPress={() => onUnsave(item.id)}
            accessibilityLabel={`Remove ${menuItem.name} from saved`}
          />
        </View>
      </View>

      {menuItem.macros ? (
        <Text style={styles.macros}>
          {`P: ${menuItem.macros.proteinG}g  C: ${menuItem.macros.carbsG}g  F: ${menuItem.macros.fatG}g  Kcal: ${menuItem.macros.calories}`}
        </Text>
      ) : (
        <Text style={styles.noMacro}>No macro data</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
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
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  nameBlock: {
    flex: 1,
    marginRight: 8,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  category: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  rightBlock: {
    alignItems: 'flex-end',
    gap: 4,
  },
  price: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  macros: {
    fontSize: 13,
    color: '#6B7280',
  },
  noMacro: {
    fontSize: 13,
    color: '#6B7280',
    fontStyle: 'italic',
  },
});
