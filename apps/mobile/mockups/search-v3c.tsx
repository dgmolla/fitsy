/**
 * Mockup V3-C: Magazine Layout
 *
 * S-87: Full editorial treatment. Large hero image for top restaurant,
 * "The Midday Selection" Newsreader headline, dish carousel below each
 * restaurant section header. Closest to Stitch magazine design but with
 * fitsy branding + cuisine filters.
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

// ─── Palette ──────────────────────────────────────────────────────────────────

const C = {
  cream:       '#fcf9f8',
  creamCard:   '#f5f0ed',
  creamDeep:   '#ede6e0',
  green:       '#012d1d',
  greenMid:    '#1a4d36',
  greenAccent: '#2f6b49',
  text:        '#0d1a12',
  textMid:     '#3a4f41',
  textSoft:    '#7a8c7e',
  white:       '#ffffff',
} as const;

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_IMAGES = [
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&q=70',
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=70',
  'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=800&q=70',
  'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=70',
  'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=70',
  'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=800&q=70',
];

function getMockImage(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return MOCK_IMAGES[h % MOCK_IMAGES.length]!;
}

const MOCK_RESULTS = [
  { id: '1', name: 'Evergreen Kitchen', address: '1424 Sunset Blvd', distanceMiles: 0.4, cuisineTags: ['healthy'], dishes: [
    { name: 'Seared Ahi Bowl', calories: 482, proteinG: 42, carbsG: 38, fatG: 14 },
    { name: 'Green Goddess Wrap', calories: 390, proteinG: 28, carbsG: 44, fatG: 12 },
    { name: 'Lemon Herb Chicken', calories: 440, proteinG: 46, carbsG: 12, fatG: 18 },
  ]},
  { id: '2', name: 'The Iron Grill', address: '3302 Glendale Blvd', distanceMiles: 1.2, cuisineTags: ['american'], dishes: [
    { name: 'Double Smash Burger', calories: 620, proteinG: 48, carbsG: 32, fatG: 28 },
    { name: 'Bacon Ranch Bowl', calories: 540, proteinG: 42, carbsG: 20, fatG: 26 },
  ]},
  { id: '3', name: 'Mesa Verde', address: '2100 Echo Park Ave', distanceMiles: 1.8, cuisineTags: ['mexican'], dishes: [
    { name: 'Chicken Burrito Bowl', calories: 610, proteinG: 45, carbsG: 52, fatG: 18 },
    { name: 'Steak Tacos', calories: 520, proteinG: 38, carbsG: 40, fatG: 20 },
  ]},
];

const CUISINE_FILTERS = [
  { id: 'all', label: 'All', icon: 'grid-outline' as const },
  { id: 'asian', label: 'Asian', icon: 'restaurant-outline' as const },
  { id: 'mexican', label: 'Mexican', icon: 'flame-outline' as const },
  { id: 'healthy', label: 'Healthy', icon: 'leaf-outline' as const },
  { id: 'fast_food', label: 'Fast Food', icon: 'fast-food-outline' as const },
  { id: 'vegan', label: 'Vegan', icon: 'nutrition-outline' as const },
];

// ─── Dimensions ───────────────────────────────────────────────────────────────

const { width: SCREEN_W } = Dimensions.get('window');
const HERO_H = 320;
const DISH_CARD_W = SCREEN_W * 0.42;
const DISH_CARD_H = 130;

// ─── Sub-components ───────────────────────────────────────────────────────────

function MastHead() {
  return (
    <View style={s.masthead}>
      <View style={s.mastheadTop}>
        <View style={s.logoRow}>
          <View style={s.logoDot} />
          <Text style={s.logo}>fitsy</Text>
        </View>
        <View style={s.locationChip}>
          <Ionicons name="location" size={11} color={C.greenAccent} />
          <Text style={s.locationText}>Silver Lake, LA</Text>
        </View>
      </View>
      {/* Magazine-style issue label */}
      <Text style={s.issueLabel}>THE MIDDAY SELECTION</Text>
    </View>
  );
}

function MacroBar({ onEdit }: { onEdit: () => void }) {
  return (
    <View style={s.macroStrip}>
      <View style={s.macroItem}>
        <Text style={s.macroVal}>45g</Text>
        <Text style={s.macroLbl}>protein</Text>
      </View>
      <View style={s.macroDivider} />
      <View style={s.macroItem}>
        <Text style={s.macroVal}>60g</Text>
        <Text style={s.macroLbl}>carbs</Text>
      </View>
      <View style={s.macroDivider} />
      <View style={s.macroItem}>
        <Text style={s.macroVal}>12g</Text>
        <Text style={s.macroLbl}>fat</Text>
      </View>
      <View style={s.macroDivider} />
      <View style={s.macroItem}>
        <Text style={s.macroVal}>550</Text>
        <Text style={s.macroLbl}>kcal</Text>
      </View>
      <TouchableOpacity style={s.editBtn} onPress={onEdit} activeOpacity={0.7}>
        <Text style={s.editBtnText}>Edit</Text>
      </TouchableOpacity>
    </View>
  );
}

function CuisineRow({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
      {CUISINE_FILTERS.map((f) => {
        const active = f.id === selected;
        return (
          <TouchableOpacity
            key={f.id}
            style={[s.filterBubble, active && s.filterBubbleActive]}
            onPress={() => onSelect(f.id)}
            activeOpacity={0.7}
          >
            <Ionicons name={f.icon} size={16} color={active ? C.cream : C.textSoft} />
            <Text style={[s.filterLabel, active && s.filterLabelActive]}>{f.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

type MockResult = typeof MOCK_RESULTS[number];
type Dish = MockResult['dishes'][number];

function HeroRestaurant({ result }: { result: MockResult }) {
  const topDish = result.dishes[0]!;
  return (
    <View style={hero.container}>
      <Image source={{ uri: getMockImage(result.name) }} style={hero.image} resizeMode="cover" />
      <LinearGradient
        colors={['transparent', 'rgba(1,45,29,0.92)']}
        style={hero.gradient}
      />
      <View style={hero.overlay}>
        <View style={hero.tagRow}>
          {result.cuisineTags.map((t) => (
            <View key={t} style={hero.tag}>
              <Text style={hero.tagText}>{t.toUpperCase()}</Text>
            </View>
          ))}
          <Text style={hero.dist}>{result.distanceMiles.toFixed(1)} mi</Text>
        </View>
        <Text style={hero.restName}>{result.name}</Text>
        <Text style={hero.dishName}>{topDish.name}</Text>
        <View style={hero.macroRow}>
          <Text style={hero.macroText}>P {topDish.proteinG}g</Text>
          <Text style={hero.dot}>·</Text>
          <Text style={hero.macroText}>C {topDish.carbsG}g</Text>
          <Text style={hero.dot}>·</Text>
          <Text style={hero.macroText}>F {topDish.fatG}g</Text>
          <Text style={hero.dot}>·</Text>
          <Text style={hero.calText}>{topDish.calories} kcal</Text>
        </View>
      </View>
    </View>
  );
}

function DishCard({ dish }: { dish: Dish }) {
  return (
    <View style={dc.container}>
      <Image source={{ uri: getMockImage(dish.name) }} style={dc.image} resizeMode="cover" />
      <LinearGradient colors={['transparent', 'rgba(1,45,29,0.8)']} style={dc.gradient} />
      <View style={dc.info}>
        <Text style={dc.name} numberOfLines={2}>{dish.name}</Text>
        <Text style={dc.cal}>{dish.calories} kcal · P {dish.proteinG}g</Text>
      </View>
    </View>
  );
}

function RestaurantSection({ result, index }: { result: MockResult; index: number }) {
  return (
    <View style={s.restSection}>
      {/* Section header — italic serif "editorial" style */}
      <View style={s.sectionHeader}>
        <Text style={s.sectionIndex}>0{index + 1}</Text>
        <View style={s.sectionTitleBlock}>
          <Text style={s.sectionRestName}>{result.name}</Text>
          <Text style={s.sectionSub}>{result.distanceMiles.toFixed(1)} mi · {result.cuisineTags.join(', ')}</Text>
        </View>
      </View>
      <FlatList
        data={result.dishes}
        keyExtractor={(d) => d.name}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.dishRow}
        renderItem={({ item }) => <DishCard dish={item} />}
      />
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function MockupV3C() {
  const [cuisineFilter, setCuisineFilter] = useState('all');
  const [heroResult, ...restResults] = MOCK_RESULTS;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.cream }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        <MastHead />
        <MacroBar onEdit={() => {}} />
        <CuisineRow selected={cuisineFilter} onSelect={setCuisineFilter} />

        {/* Feature hero — top restaurant */}
        {heroResult && <HeroRestaurant result={heroResult} />}

        {/* Remaining restaurants with dish carousels */}
        {restResults.map((r, i) => (
          <RestaurantSection key={r.id} result={r} index={i + 1} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  masthead: {
    backgroundColor: C.cream,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 10,
  },
  mastheadTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  logoDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.green },
  logo: { fontSize: 20, fontFamily: 'Newsreader-Bold', color: C.green, letterSpacing: -0.5 },
  locationChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.creamCard, borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  locationText: { fontSize: 11, fontWeight: '600', color: C.textSoft },
  issueLabel: {
    fontSize: 10, fontWeight: '700', color: C.textSoft,
    letterSpacing: 2.5, textTransform: 'uppercase',
  },

  macroStrip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.creamCard, borderRadius: 14,
    marginHorizontal: 20, marginBottom: 4,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  macroItem: { flex: 1, alignItems: 'center', gap: 2 },
  macroVal: { fontSize: 14, fontWeight: '700', color: C.text },
  macroLbl: { fontSize: 9, fontWeight: '600', color: C.textSoft, letterSpacing: 0.3 },
  macroDivider: { width: 1, height: 28, backgroundColor: C.creamDeep },
  editBtn: {
    backgroundColor: C.green, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8, marginLeft: 10,
  },
  editBtnText: { fontSize: 12, fontWeight: '700', color: C.cream, letterSpacing: 0.2 },

  filterRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  filterBubble: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.creamCard, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  filterBubbleActive: { backgroundColor: C.green },
  filterLabel: { fontSize: 13, fontWeight: '600', color: C.textSoft },
  filterLabelActive: { color: C.cream },

  restSection: { marginTop: 24 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 20, marginBottom: 12,
  },
  sectionIndex: {
    fontFamily: 'Newsreader-Italic', fontSize: 32, color: C.creamDeep,
    lineHeight: 34, letterSpacing: -1,
  },
  sectionTitleBlock: { flex: 1, paddingTop: 4 },
  sectionRestName: {
    fontFamily: 'Newsreader-Bold', fontSize: 20, color: C.text, letterSpacing: -0.5,
  },
  sectionSub: { fontSize: 11, fontWeight: '500', color: C.textSoft, marginTop: 1 },
  dishRow: { paddingHorizontal: 16, gap: 10, paddingBottom: 4 },
});

const hero = StyleSheet.create({
  container: {
    height: HERO_H, marginHorizontal: 16, borderRadius: 24, overflow: 'hidden',
    backgroundColor: C.creamDeep, marginTop: 4,
  },
  image: { width: '100%', height: '100%' },
  gradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: HERO_H * 0.65 },
  overlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, gap: 4 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  tag: {
    backgroundColor: 'rgba(252,249,248,0.18)', borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  tagText: { fontSize: 9, fontWeight: '700', color: 'rgba(252,249,248,0.9)', letterSpacing: 1 },
  dist: { fontSize: 11, fontWeight: '600', color: 'rgba(252,249,248,0.65)', marginLeft: 2 },
  restName: {
    fontFamily: 'Newsreader-Bold', fontSize: 28, color: C.cream, letterSpacing: -0.8, lineHeight: 30,
  },
  dishName: {
    fontFamily: 'Newsreader-Italic', fontSize: 18, color: 'rgba(252,249,248,0.85)', letterSpacing: -0.3,
  },
  macroRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  macroText: { fontSize: 11, fontWeight: '600', color: 'rgba(252,249,248,0.6)' },
  dot: { fontSize: 11, color: 'rgba(252,249,248,0.3)' },
  calText: { fontSize: 11, fontWeight: '700', color: 'rgba(252,249,248,0.85)' },
});

const dc = StyleSheet.create({
  container: {
    width: DISH_CARD_W, height: DISH_CARD_H, borderRadius: 16, overflow: 'hidden',
    backgroundColor: C.creamDeep,
  },
  image: { width: '100%', height: '100%' },
  gradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: DISH_CARD_H * 0.7 },
  info: { position: 'absolute', bottom: 10, left: 10, right: 10 },
  name: { fontSize: 13, fontFamily: 'Newsreader-Bold', color: C.cream, letterSpacing: -0.2, lineHeight: 16 },
  cal: { fontSize: 9, fontWeight: '600', color: 'rgba(252,249,248,0.65)', marginTop: 2 },
});
