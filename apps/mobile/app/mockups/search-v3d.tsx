/**
 * Mockup V3-D: Hybrid Minimal
 *
 * S-88: Cream bg + compact horizontal cards (current V2 size) with
 * glassmorphic info overlay, macro strip, tonal layering only (no
 * borders/shadows). Lightest editorial touch.
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
import { BlurView } from 'expo-blur';
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
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&q=70',
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&q=70',
  'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=600&q=70',
  'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600&q=70',
  'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&q=70',
  'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=600&q=70',
];

function getMockImage(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return MOCK_IMAGES[h % MOCK_IMAGES.length]!;
}

const MOCK_RESULTS = [
  { id: '1', name: 'Evergreen Kitchen', address: '1424 Sunset Blvd', distanceMiles: 0.4, cuisineTags: ['healthy'], bestMatch: { name: 'Seared Ahi Bowl', calories: 482, proteinG: 42, carbsG: 38, fatG: 14 } },
  { id: '2', name: 'The Iron Grill', address: '3302 Glendale Blvd', distanceMiles: 1.2, cuisineTags: ['american'], bestMatch: { name: 'Double Smash Burger', calories: 620, proteinG: 48, carbsG: 32, fatG: 28 } },
  { id: '3', name: 'Mesa Verde', address: '2100 Echo Park Ave', distanceMiles: 1.8, cuisineTags: ['mexican'], bestMatch: { name: 'Chicken Burrito Bowl', calories: 610, proteinG: 45, carbsG: 52, fatG: 18 } },
  { id: '4', name: 'Harvest Market', address: '890 Hyperion Ave', distanceMiles: 0.9, cuisineTags: ['healthy', 'vegan'], bestMatch: { name: 'Power Greens Salad', calories: 320, proteinG: 28, carbsG: 18, fatG: 16 } },
  { id: '5', name: 'Sakura Ramen', address: '4501 Melrose Ave', distanceMiles: 2.0, cuisineTags: ['asian'], bestMatch: { name: 'Chicken Teriyaki Bowl', calories: 580, proteinG: 40, carbsG: 65, fatG: 14 } },
  { id: '6', name: 'Ocean Blue', address: '1200 Pacific Ave', distanceMiles: 1.5, cuisineTags: ['healthy'], bestMatch: { name: 'Grilled Salmon Plate', calories: 510, proteinG: 44, carbsG: 28, fatG: 22 } },
];

const CUISINE_FILTERS = [
  { id: 'all', label: 'All', icon: 'grid-outline' as const },
  { id: 'asian', label: 'Asian', icon: 'restaurant-outline' as const },
  { id: 'mexican', label: 'Mexican', icon: 'flame-outline' as const },
  { id: 'healthy', label: 'Healthy', icon: 'leaf-outline' as const },
  { id: 'fast_food', label: 'Fast Food', icon: 'fast-food-outline' as const },
  { id: 'vegan', label: 'Vegan', icon: 'nutrition-outline' as const },
];

const CATEGORIES = [
  { title: 'Near You', ids: ['1', '4', '2'] },
  { title: 'High Protein', ids: ['2', '3', '6'] },
  { title: 'Quick & Light', ids: ['4', '1', '6'] },
];

// ─── Dimensions ───────────────────────────────────────────────────────────────

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = SCREEN_W * 0.52;
const CARD_H = 180;

// ─── Sub-components ───────────────────────────────────────────────────────────

function Header({ onEditPress }: { onEditPress: () => void }) {
  return (
    <View style={s.header}>
      <View style={s.headerTop}>
        <View style={s.logoRow}>
          <View style={s.logoDot} />
          <Text style={s.logo}>fitsy</Text>
        </View>
        <View style={s.locationChip}>
          <Ionicons name="location" size={11} color={C.greenAccent} />
          <Text style={s.locationText}>Silver Lake, LA</Text>
        </View>
      </View>
      {/* Minimal headline — single line */}
      <Text style={s.headline}>Find your fit.</Text>
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
        <TouchableOpacity style={s.editBtn} onPress={onEditPress} activeOpacity={0.7}>
          <Text style={s.editBtnText}>Edit</Text>
        </TouchableOpacity>
      </View>
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

/**
 * Compact card with glassmorphic info strip at bottom.
 * Tonal layering only — no explicit borders or drop shadows.
 */
function MinimalCard({ result }: { result: MockResult }) {
  const bm = result.bestMatch;
  return (
    <View style={card.container}>
      <Image source={{ uri: getMockImage(result.name) }} style={card.image} resizeMode="cover" />
      {/* Full-card tonal gradient — no hard border */}
      <LinearGradient
        colors={['transparent', 'rgba(1,45,29,0.7)']}
        style={card.gradient}
      />
      {/* Glassmorphic info overlay */}
      <BlurView intensity={28} tint="dark" style={card.glassOverlay}>
        <View style={card.glassInner}>
          <Text style={card.dishName} numberOfLines={1}>{bm.name}</Text>
          <Text style={card.restName} numberOfLines={1}>
            {result.name} · {result.distanceMiles.toFixed(1)} mi
          </Text>
          <View style={card.macroRow}>
            <Text style={card.macroText}>P {bm.proteinG}g</Text>
            <Text style={card.macroText}>C {bm.carbsG}g</Text>
            <Text style={card.macroText}>F {bm.fatG}g</Text>
            <Text style={card.calText}>{bm.calories}</Text>
          </View>
        </View>
      </BlurView>
    </View>
  );
}

function CategorySection({ title, results }: { title: string; results: MockResult[] }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <FlatList
        data={results}
        keyExtractor={(r) => r.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.cardRow}
        renderItem={({ item }) => <MinimalCard result={item} />}
      />
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function MockupV3D() {
  const [cuisineFilter, setCuisineFilter] = useState('all');

  const categories = CATEGORIES.map((cat) => ({
    title: cat.title,
    results: cat.ids.map((id) => MOCK_RESULTS.find((r) => r.id === id)!).filter(Boolean),
  }));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.cream }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        <Header onEditPress={() => {}} />
        <CuisineRow selected={cuisineFilter} onSelect={setCuisineFilter} />
        {categories.map((cat) => (
          <CategorySection key={cat.title} title={cat.title} results={cat.results} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: {
    backgroundColor: C.cream,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
    gap: 14,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  logoDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.green },
  logo: { fontSize: 20, fontFamily: 'Newsreader-Bold', color: C.green, letterSpacing: -0.5 },
  locationChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.creamCard, borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  locationText: { fontSize: 11, fontWeight: '600', color: C.textSoft },
  headline: {
    fontFamily: 'Newsreader-Bold', fontSize: 36, color: C.green,
    letterSpacing: -1.2,
  },
  macroStrip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.creamCard, borderRadius: 14,
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

  section: { marginTop: 4 },
  sectionTitle: {
    fontFamily: 'Newsreader-Bold', fontSize: 22, color: C.text,
    paddingHorizontal: 20, marginBottom: 12, letterSpacing: -0.5,
  },
  cardRow: { paddingHorizontal: 16, gap: 12, paddingBottom: 16 },
});

const card = StyleSheet.create({
  container: {
    width: CARD_W, height: CARD_H, borderRadius: 18, overflow: 'hidden',
    backgroundColor: C.creamDeep,
  },
  image: { width: '100%', height: '100%' },
  gradient: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  glassOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
  },
  glassInner: {
    paddingHorizontal: 12, paddingVertical: 10, gap: 2,
  },
  dishName: {
    fontSize: 14, fontFamily: 'Newsreader-Bold', color: C.cream, letterSpacing: -0.2,
  },
  restName: { fontSize: 10, fontWeight: '500', color: 'rgba(252,249,248,0.6)', marginTop: 1 },
  macroRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 3 },
  macroText: { fontSize: 9, fontWeight: '600', color: 'rgba(252,249,248,0.5)', letterSpacing: 0.2 },
  calText: { fontSize: 10, fontWeight: '800', color: 'rgba(252,249,248,0.9)', marginLeft: 2 },
});
