import React, { useCallback, useState } from 'react';
import {
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ScreenBackground } from '@/components/ScreenBackground';
import { SavedItemResponse } from '@fitsy/shared';
import { getSavedItems, unsaveItem } from '@/lib/apiClient';
import { BookmarkButton, FitsyLoader } from '@/components';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useTheme } from '@/lib/theme';
import { trackItemSaved, trackRestaurantTapped, trackSaveFailed } from '@/lib/analytics';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { Ionicons } from '@expo/vector-icons';

type Section = {
  title: string;
  restaurantId: string;
  itemCount: number;
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
    itemCount: items.length,
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
      return () => { cancelled = true; };
    }, [])
  );

  const handleUnsave = useCallback(async (savedItemId: string) => {
    const target = savedItems.find((item) => item.id === savedItemId);
    const success = await unsaveItem(savedItemId);
    if (success) {
      setSavedItems((prev) => prev.filter((item) => item.id !== savedItemId));
      if (target?.menuItemId) {
        trackItemSaved({
          menu_item_id: target.menuItemId,
          restaurant_id: target.menuItem?.restaurant.id ?? '',
          action: 'unsave',
          entry_point: 'saved_screen',
        });
      }
    } else if (target?.menuItemId) {
      // Pairs with `item_saved` — when the API request fails the success
      // event never fires, so `save_failed` is the only signal we get.
      trackSaveFailed({
        menu_item_id: target.menuItemId,
        restaurant_id: target.menuItem?.restaurant.id ?? '',
        action: 'unsave',
        entry_point: 'saved_screen',
      });
    }
  }, [savedItems]);

  const handleRestaurantTap = useCallback((section: Section, position: number) => {
    trackRestaurantTapped({
      restaurant_id: section.restaurantId,
      restaurant_name: section.title,
      position,
      entry_point: 'saved_screen',
    });
    router.push({ pathname: `/restaurant/${section.restaurantId}` });
  }, []);

  const sections = buildSections(savedItems);

  return (
    <ScreenBackground>
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
          ListHeaderComponent={
            <View style={styles.heroCard}>
              <View style={styles.heroTop}>
                <Text style={styles.heroNumber}>{savedItems.length}</Text>
                <Text style={styles.heroLabel}>saved{'\n'}meals</Text>
              </View>
              <View style={styles.heroDivider} />
              <Text style={styles.heroRestaurants}>
                from {sections.length} restaurant{sections.length !== 1 ? 's' : ''} near you
              </Text>
            </View>
          }
          renderSectionHeader={({ section }) => {
            const sectionIndex = sections.findIndex((s) => s.restaurantId === section.restaurantId);
            return (
              <Pressable
                style={styles.sectionHeader}
                onPress={() => handleRestaurantTap(section, sectionIndex)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${section.title}`}
              >
                <Ionicons name="restaurant-outline" size={14} color={EDITORIAL.greenAccent} />
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <View style={styles.sectionPill}>
                  <Text style={styles.sectionPillText}>{section.itemCount} meal{section.itemCount !== 1 ? 's' : ''}</Text>
                </View>
              </Pressable>
            );
          }}
          renderItem={({ item }) => (
            <SavedItemCompact item={item} onUnsave={handleUnsave} />
          )}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled
        />
      )}
    </ScreenBackground>
  );
}

function SavedItemCompact({ item, onUnsave }: { item: SavedItemResponse; onUnsave: (id: string) => void }) {
  const menuItem = item.menuItem;
  if (!menuItem) return null;
  const m = menuItem.macros;

  return (
    <View style={styles.itemRow}>
      <View style={styles.itemLeft}>
        <Text style={styles.itemName} numberOfLines={1}>{menuItem.name}</Text>
        {m && (
          <View style={styles.itemMacroRow}>
            <Text style={styles.itemCal}>{m.calories} kcal</Text>
            <Text style={styles.itemMacroDot}>·</Text>
            <Text style={[styles.itemMacro, { color: '#5B7C6B' }]}>P {m.proteinG}g</Text>
            <Text style={styles.itemMacroDot}>·</Text>
            <Text style={[styles.itemMacro, { color: '#8B7355' }]}>C {m.carbsG}g</Text>
            <Text style={styles.itemMacroDot}>·</Text>
            <Text style={[styles.itemMacro, { color: '#7B6B8A' }]}>F {m.fatG}g</Text>
          </View>
        )}
      </View>
      <BookmarkButton isSaved onPress={() => onUnsave(item.id)} />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  heroCard: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 16,
    backgroundColor: EDITORIAL.green,
    borderRadius: 20,
    padding: 24,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  heroNumber: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 56,
    fontWeight: '800',
    color: '#FDFBF7',
    letterSpacing: -2,
    lineHeight: 56,
  },
  heroLabel: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(253,251,247,0.6)',
    letterSpacing: -0.2,
    lineHeight: 18,
  },
  heroDivider: {
    height: 1,
    backgroundColor: 'rgba(253,251,247,0.15)',
    marginVertical: 16,
  },
  heroRestaurants: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(253,251,247,0.5)',
    letterSpacing: -0.1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: EDITORIAL.cream,
    borderBottomWidth: 1,
    borderBottomColor: EDITORIAL.border,
  },
  sectionTitle: {
    flex: 1,
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 16,
    color: EDITORIAL.text,
    letterSpacing: -0.3,
  },
  sectionPill: {
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  sectionPillText: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 10,
    fontWeight: '600',
    color: EDITORIAL.textSoft,
    letterSpacing: -0.1,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: EDITORIAL.border,
  },
  itemLeft: {
    flex: 1,
    marginRight: 12,
  },
  itemName: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 15,
    fontWeight: '700',
    color: EDITORIAL.text,
    letterSpacing: -0.2,
  },
  itemMacroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  itemCal: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 11,
    fontWeight: '700',
    color: EDITORIAL.text,
    letterSpacing: -0.2,
  },
  itemMacroDot: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 11,
    color: EDITORIAL.creamDeep,
  },
  itemMacro: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 32,
  },
});
