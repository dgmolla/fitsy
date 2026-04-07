/**
 * Search Flow Mockup — V2: Category Filters + Horizontal Card Rows
 *
 * Layout:
 *   - Header: logo, location, P/C/F macro summary (no text input)
 *   - Cuisine filter bubbles (horizontal scroll)
 *   - Restaurant cards grouped by category ("Near You", "High Protein", etc.)
 *     each category is a horizontal swipeable row
 *
 * To preview: export { default } from '../../mockups/search-v2-categories';
 */

import React, { useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = SCREEN_W * 0.6;
const CARD_H = 200;

// ─── Brand ───────────────────────────────────────────────────────────────────

const C = {
  green: '#2F8F5B',
  greenDark: '#246E47',
  greenLight: '#EFF6F1',
  white: '#FFFFFF',
  bg: '#FFFFFF',
  text: '#111827',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',
  border: '#E5E7EB',
  borderLight: '#F3F4F6',
  cardBg: '#FFFFFF',
} as const;

// ─── Mock Data ───────────────────────────────────────────────────────────────

const CUISINE_FILTERS = [
  { id: 'all', label: 'All', icon: 'grid-outline' },
  { id: 'asian', label: 'Asian', icon: 'restaurant-outline' },
  { id: 'mexican', label: 'Mexican', icon: 'flame-outline' },
  { id: 'healthy', label: 'Healthy', icon: 'leaf-outline' },
  { id: 'fast_food', label: 'Fast Food', icon: 'fast-food-outline' },
  { id: 'vegan', label: 'Vegan', icon: 'nutrition-outline' },
  { id: 'italian', label: 'Italian', icon: 'pizza-outline' },
  { id: 'sushi', label: 'Sushi', icon: 'fish-outline' },
] as const;

interface MockItem {
  id: string;
  name: string;
  restaurant: string;
  distance: number;
  photoUrl: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  matchPct: number;
  cuisines: string[];
}

const ALL_ITEMS: MockItem[] = [
  // Near You
  { id: '1', name: 'Seared Ahi Bowl', restaurant: 'Evergreen Kitchen', distance: 0.4, photoUrl: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&q=70', calories: 482, proteinG: 42, carbsG: 38, fatG: 14, matchPct: 98, cuisines: ['healthy', 'asian'] },
  { id: '2', name: 'Grilled Chicken Wrap', restaurant: 'Fresh & Co', distance: 0.6, photoUrl: 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=600&q=70', calories: 410, proteinG: 35, carbsG: 42, fatG: 12, matchPct: 92, cuisines: ['healthy'] },
  { id: '3', name: 'Poke Bowl', restaurant: 'Aloha Poke', distance: 0.8, photoUrl: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&q=70', calories: 520, proteinG: 38, carbsG: 55, fatG: 16, matchPct: 85, cuisines: ['asian', 'healthy'] },

  // High Protein
  { id: '4', name: 'Double Smash Burger', restaurant: 'The Iron Grill', distance: 1.2, photoUrl: 'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=600&q=70', calories: 620, proteinG: 48, carbsG: 32, fatG: 28, matchPct: 88, cuisines: ['fast_food'] },
  { id: '5', name: 'Grilled Salmon Plate', restaurant: 'Ocean Blue', distance: 1.5, photoUrl: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=600&q=70', calories: 510, proteinG: 44, carbsG: 28, fatG: 22, matchPct: 94, cuisines: ['healthy'] },
  { id: '6', name: 'Chicken Teriyaki Bowl', restaurant: 'Sakura', distance: 2.0, photoUrl: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600&q=70', calories: 580, proteinG: 40, carbsG: 65, fatG: 14, matchPct: 82, cuisines: ['asian'] },

  // Quick & Light
  { id: '7', name: 'Power Greens Salad', restaurant: 'Harvest Market', distance: 0.9, photoUrl: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&q=70', calories: 320, proteinG: 28, carbsG: 18, fatG: 16, matchPct: 90, cuisines: ['healthy', 'vegan'] },
  { id: '8', name: 'Veggie Buddha Bowl', restaurant: 'Green Temple', distance: 1.3, photoUrl: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=600&q=70', calories: 380, proteinG: 18, carbsG: 52, fatG: 14, matchPct: 78, cuisines: ['vegan'] },
  { id: '9', name: 'Acai Bowl', restaurant: 'Juice Press', distance: 1.1, photoUrl: 'https://images.unsplash.com/photo-1590301157890-4810ed352733?w=600&q=70', calories: 350, proteinG: 12, carbsG: 58, fatG: 10, matchPct: 72, cuisines: ['healthy', 'vegan'] },

  // Mexican
  { id: '10', name: 'Chicken Burrito Bowl', restaurant: 'Mesa Verde', distance: 1.8, photoUrl: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&q=70', calories: 610, proteinG: 45, carbsG: 52, fatG: 18, matchPct: 86, cuisines: ['mexican'] },
  { id: '11', name: 'Fish Tacos (3)', restaurant: 'Baja Fresh', distance: 2.2, photoUrl: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?w=600&q=70', calories: 480, proteinG: 32, carbsG: 42, fatG: 18, matchPct: 80, cuisines: ['mexican'] },
  { id: '12', name: 'Carne Asada Plate', restaurant: 'El Pollo Loco', distance: 2.5, photoUrl: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&q=70', calories: 550, proteinG: 42, carbsG: 35, fatG: 24, matchPct: 84, cuisines: ['mexican'] },
];

interface Category {
  title: string;
  items: MockItem[];
}

function getCategories(filter: string): Category[] {
  const filtered = filter === 'all'
    ? ALL_ITEMS
    : ALL_ITEMS.filter((i) => i.cuisines.includes(filter));

  if (filtered.length === 0) return [];

  if (filter !== 'all') {
    return [{ title: CUISINE_FILTERS.find((f) => f.id === filter)?.label ?? filter, items: filtered }];
  }

  return [
    { title: 'Near You', items: filtered.filter((i) => i.distance <= 1.0) },
    { title: 'High Protein', items: filtered.filter((i) => i.proteinG >= 38) },
    { title: 'Quick & Light', items: filtered.filter((i) => i.calories <= 400) },
    { title: 'Mexican Favorites', items: filtered.filter((i) => i.cuisines.includes('mexican')) },
  ].filter((c) => c.items.length > 0);
}

// ─── Components ──────────────────────────────────────────────────────────────

function Header({ macros }: { macros: { p: number; c: number; f: number; cal: number } }) {
  return (
    <View style={s.header}>
      <View style={s.headerTop}>
        <View style={s.logoRow}>
          <Ionicons name="restaurant" size={18} color={C.green} />
          <Text style={s.logo}>fitsy</Text>
        </View>
        <View style={s.locationPill}>
          <View style={s.locationDot} />
          <Text style={s.locationText}>Silver Lake, LA</Text>
        </View>
      </View>

      <Text style={s.greeting}>Food that fits.</Text>

      <View style={s.macroSummary}>
        <MacroPill label="P" value={`${macros.p}g`} />
        <MacroPill label="C" value={`${macros.c}g`} />
        <MacroPill label="F" value={`${macros.f}g`} />
        <MacroPill label="" value={`${macros.cal}`} unit="kcal" highlight />
      </View>
    </View>
  );
}

function MacroPill({ label, value, unit, highlight }: { label: string; value: string; unit?: string; highlight?: boolean }) {
  return (
    <View style={[s.macroPill, highlight && s.macroPillHighlight]}>
      {label ? <Text style={[s.macroPillLabel, highlight && s.macroPillLabelH]}>{label}</Text> : null}
      <Text style={[s.macroPillValue, highlight && s.macroPillValueH]}>{value}</Text>
      {unit ? <Text style={[s.macroPillUnit, highlight && s.macroPillUnitH]}>{unit}</Text> : null}
    </View>
  );
}

function CuisineFilters({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.filterRow}
    >
      {CUISINE_FILTERS.map((f) => {
        const active = f.id === selected;
        return (
          <TouchableOpacity
            key={f.id}
            style={[s.filterBubble, active && s.filterBubbleActive]}
            onPress={() => onSelect(f.id)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={f.icon as any}
              size={18}
              color={active ? C.white : C.textSecondary}
            />
            <Text style={[s.filterLabel, active && s.filterLabelActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function MealCard({ item }: { item: MockItem }) {
  return (
    <TouchableOpacity activeOpacity={0.9} style={card.container}>
      <Image source={{ uri: item.photoUrl }} style={card.image} resizeMode="cover" />
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.75)']} style={card.gradient} />

      <View style={card.info}>
        <Text style={card.dishName} numberOfLines={1}>{item.name}</Text>
        <Text style={card.restName} numberOfLines={1}>
          {item.restaurant} {'\u2022'} {item.distance.toFixed(1)} mi
        </Text>
        <View style={card.macroRow}>
          <Text style={card.macroPill}>P {item.proteinG}g</Text>
          <Text style={card.macroPill}>C {item.carbsG}g</Text>
          <Text style={card.macroPill}>F {item.fatG}g</Text>
          <Text style={card.calPill}>{item.calories} kcal</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function CategoryRow({ category }: { category: Category }) {
  return (
    <View style={s.categorySection}>
      <View style={s.categoryHeader}>
        <Text style={s.categoryTitle}>{category.title}</Text>
      </View>
      <FlatList
        data={category.items}
        keyExtractor={(i) => i.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.cardRow}
        renderItem={({ item }) => <MealCard item={item} />}
      />
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function SearchV2Mockup() {
  const [selectedFilter, setSelectedFilter] = useState('all');
  const categories = getCategories(selectedFilter);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        <Header macros={{ p: 45, c: 60, f: 12, cal: 550 }} />
        <CuisineFilters selected={selectedFilter} onSelect={setSelectedFilter} />
        {categories.map((cat) => (
          <CategoryRow key={cat.title} category={cat} />
        ))}
        {categories.length === 0 && (
          <View style={s.emptyState}>
            <Ionicons name="search-outline" size={48} color={C.textTertiary} />
            <Text style={s.emptyText}>No matches for this cuisine</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // Header
  header: { backgroundColor: C.white, paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  logo: { fontSize: 22, fontWeight: '800', color: C.green, letterSpacing: -0.8 },
  locationPill: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.borderLight,
    borderRadius: 14, paddingHorizontal: 11, paddingVertical: 5, borderWidth: 1, borderColor: C.border, gap: 5,
  },
  locationDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
  locationText: { fontSize: 11, fontWeight: '600', color: C.textSecondary },
  greeting: { fontFamily: 'PlayfairDisplay-BoldItalic', fontSize: 26, color: C.text, letterSpacing: -0.5, marginBottom: 12 },

  // Macro summary
  macroSummary: { flexDirection: 'row', gap: 8 },
  macroPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.borderLight, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: C.border,
  },
  macroPillHighlight: { backgroundColor: C.greenLight, borderColor: C.green },
  macroPillLabel: { fontSize: 11, fontWeight: '800', color: C.textTertiary },
  macroPillLabelH: { color: C.greenDark },
  macroPillValue: { fontSize: 14, fontWeight: '700', color: C.text },
  macroPillValueH: { color: C.green },
  macroPillUnit: { fontSize: 10, fontWeight: '600', color: C.textTertiary, marginLeft: -2 },
  macroPillUnitH: { color: C.greenDark },

  // Cuisine filters
  filterRow: { paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  filterBubble: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.white, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: C.border,
  },
  filterBubbleActive: { backgroundColor: C.green, borderColor: C.green },
  filterLabel: { fontSize: 13, fontWeight: '600', color: C.textSecondary },
  filterLabelActive: { color: C.white },

  // Category sections
  categorySection: { marginTop: 8 },
  categoryHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, marginBottom: 12,
  },
  categoryTitle: { fontSize: 20, fontWeight: '700', color: C.text, letterSpacing: -0.3 },
  seeAll: { fontSize: 13, fontWeight: '600', color: C.green },
  cardRow: { paddingHorizontal: 16, gap: 12, paddingBottom: 16 },

  // Empty
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 16, fontWeight: '500', color: C.textTertiary },
});

const card = StyleSheet.create({
  container: {
    width: CARD_W, height: CARD_H, borderRadius: 18, overflow: 'hidden',
    backgroundColor: C.cardBg, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
  },
  image: { width: '100%', height: '100%' },
  gradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: CARD_H * 0.7 },
  matchBadge: {
    position: 'absolute', top: 10, right: 10,
    backgroundColor: C.green, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
  },
  matchText: { fontSize: 11, fontWeight: '800', color: C.white },
  info: { position: 'absolute', bottom: 12, left: 12, right: 12 },
  dishName: { fontSize: 16, fontWeight: '700', color: '#F1F3FC', letterSpacing: -0.2 },
  restName: { fontSize: 11, fontWeight: '500', color: 'rgba(241,243,252,0.6)', marginTop: 2 },
  macroRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  macroPill: { fontSize: 9, fontWeight: '600', color: 'rgba(241,243,252,0.5)', letterSpacing: 0.3 },
  calPill: { fontSize: 9, fontWeight: '700', color: 'rgba(74,222,128,0.8)' },
});
