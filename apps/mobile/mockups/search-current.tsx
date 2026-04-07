/**
 * Search Flow Mockup — Current Design (baseline)
 *
 * Self-contained reproduction of the current search experience.
 * No API calls, no external component imports — everything inline
 * with hardcoded mock data so you can iterate on the design freely.
 *
 * To preview: temporarily import this in a route or use Expo's
 * storybook-style setup.
 *
 * Usage from app/(tabs)/search.tsx:
 *   export { default } from '@/mockups/search-current';
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

// ─── Brand constants (inline) ────────────────────────────────────────────────

const C = {
  green: '#2F8F5B',
  greenDark: '#246E47',
  white: '#FFFFFF',
  text: '#111827',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',
  textDisabled: '#D1D5DB',
  border: '#E5E7EB',
  borderLight: '#F3F4F6',
} as const;

const FONTS = {
  headline: 'PlayfairDisplay-BoldItalic',
  body: 'Manrope-Bold',
} as const;

// ─── Mock data ───────────────────────────────────────────────────────────────

interface MockRestaurant {
  id: string;
  name: string;
  address: string;
  distanceMiles: number;
  cuisineTags: string[];
  photoUrl: string;
  bestMatch: {
    name: string;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    matchScore: number;
  } | null;
}

const RESTAURANTS: MockRestaurant[] = [
  {
    id: '1',
    name: 'Evergreen Kitchen',
    address: '1424 Sunset Blvd, Silver Lake',
    distanceMiles: 1.2,
    cuisineTags: ['healthy', 'bowls'],
    photoUrl: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&q=70',
    bestMatch: { name: 'Seared Ahi Bowl', calories: 482, proteinG: 42, carbsG: 38, fatG: 14, matchScore: 0.02 },
  },
  {
    id: '2',
    name: 'The Iron Grill',
    address: '3302 Glendale Blvd, Los Angeles',
    distanceMiles: 2.8,
    cuisineTags: ['american', 'grill'],
    photoUrl: 'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=600&q=70',
    bestMatch: { name: 'High Protein Burger', calories: 520, proteinG: 38, carbsG: 12, fatG: 26, matchScore: 0.15 },
  },
  {
    id: '3',
    name: 'Mesa Verde',
    address: '2100 Echo Park Ave',
    distanceMiles: 3.1,
    cuisineTags: ['mexican', 'fresh'],
    photoUrl: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&q=70',
    bestMatch: { name: 'Grilled Chicken Bowl', calories: 610, proteinG: 45, carbsG: 52, fatG: 18, matchScore: 0.22 },
  },
  {
    id: '4',
    name: 'Harvest Market',
    address: '890 Hyperion Ave',
    distanceMiles: 1.5,
    cuisineTags: ['organic', 'salads'],
    photoUrl: 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=600&q=70',
    bestMatch: { name: 'Power Greens Salad', calories: 445, proteinG: 32, carbsG: 28, fatG: 20, matchScore: 0.08 },
  },
  {
    id: '5',
    name: 'Sakura Ramen',
    address: '4501 Melrose Ave',
    distanceMiles: 2.1,
    cuisineTags: ['japanese', 'ramen'],
    photoUrl: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600&q=70',
    bestMatch: { name: 'Tonkotsu Ramen', calories: 580, proteinG: 28, carbsG: 65, fatG: 22, matchScore: 0.30 },
  },
];

interface MacroValues {
  protein: string;
  carbs: string;
  fat: string;
  calories: string;
}

const DEFAULT_MACROS: MacroValues = {
  protein: '45',
  carbs: '60',
  fat: '12',
  calories: '550',
};

// ─── SearchHeader ────────────────────────────────────────────────────────────

function MacroBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={[h.macroBox, highlight && h.macroBoxHighlight]}>
      <Text style={[h.macroValue, highlight && h.macroValueHighlight]}>
        {value || '\u2014'}
      </Text>
      <Text style={[h.macroLabel, highlight && h.macroLabelHighlight]}>
        {label}
      </Text>
    </View>
  );
}

function SearchHeader({
  values,
  onPress,
}: {
  values: MacroValues;
  onPress: () => void;
}) {
  return (
    <View style={h.wrapper}>
      <Pressable onPress={onPress} style={h.inner}>
        <View style={h.row1}>
          <View style={h.logoLeft}>
            <Ionicons name="restaurant" size={18} color={C.green} />
            <Text style={h.logo}>fitsy</Text>
          </View>
          <View style={h.locationPill}>
            <View style={h.locationDot} />
            <Text style={h.locationText}>Silver Lake, LA</Text>
          </View>
        </View>

        <View style={h.row2}>
          <Text style={h.headline}>Crave something.</Text>
          <Text style={h.reset}>{'\u2715'}  RESET</Text>
        </View>

        <View style={h.row3}>
          <MacroBox label="PROT" value={values.protein} />
          <MacroBox label="CARB" value={values.carbs} />
          <MacroBox label="FAT" value={values.fat} />
          <MacroBox label="KCAL" value={values.calories} highlight />
        </View>
      </Pressable>
    </View>
  );
}

// ─── FilterPopup ─────────────────────────────────────────────────────────────

const MACRO_FIELDS: { key: keyof MacroValues; fullLabel: string }[] = [
  { key: 'protein', fullLabel: 'PROT' },
  { key: 'carbs', fullLabel: 'CARB' },
  { key: 'fat', fullLabel: 'FAT' },
];

function FilterPopup({
  visible,
  values,
  onApply,
  onClose,
}: {
  visible: boolean;
  values: MacroValues;
  onApply: (v: MacroValues) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<MacroValues>(values);

  const scaleAnim = useRef(new Animated.Value(0.72)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const blurOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setDraft(values);
      scaleAnim.setValue(0.72);
      opacityAnim.setValue(0);
      blurOpacity.setValue(0);

      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          damping: 14,
          stiffness: 340,
          mass: 0.72,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 160,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(blurOpacity, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, values]);

  function dismiss(cb: () => void) {
    Animated.parallel([
      Animated.timing(scaleAnim, { toValue: 0.88, duration: 130, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0, duration: 130, useNativeDriver: true }),
      Animated.timing(blurOpacity, { toValue: 0, duration: 130, useNativeDriver: true }),
    ]).start(() => cb());
  }

  const translateY = scaleAnim.interpolate({
    inputRange: [0.72, 1],
    outputRange: [-132 * 0.28, 0],
    extrapolate: 'clamp',
  });

  return (
    <Modal visible={visible} transparent animationType="none">
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: blurOpacity }]}>
        <BlurView tint="light" intensity={60} style={StyleSheet.absoluteFill as ViewStyle} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.3)' }]} />
      </Animated.View>

      <Pressable style={StyleSheet.absoluteFill} onPress={() => dismiss(onClose)} />

      <View style={f.overlay} pointerEvents="box-none">
        <Animated.View
          style={[
            f.card,
            { opacity: opacityAnim, transform: [{ scale: scaleAnim }, { translateY }] },
          ]}
        >
          <View style={f.macroRow}>
            {MACRO_FIELDS.map(({ key, fullLabel }) => (
              <View key={key} style={f.macroBox}>
                <TextInput
                  style={f.macroInput}
                  value={draft[key]}
                  onChangeText={(t) => setDraft((p) => ({ ...p, [key]: t }))}
                  keyboardType="numeric"
                  placeholder="\u2014"
                  placeholderTextColor={C.textDisabled}
                  maxLength={4}
                  textAlign="center"
                  selectionColor={C.green}
                />
                <Text style={f.macroLabel}>{fullLabel}</Text>
              </View>
            ))}
          </View>

          <View style={f.calBox}>
            <TextInput
              style={f.calInput}
              value={draft.calories}
              onChangeText={(t) => setDraft((p) => ({ ...p, calories: t }))}
              keyboardType="numeric"
              placeholder="\u2014"
              placeholderTextColor={C.textDisabled}
              maxLength={5}
              textAlign="center"
              selectionColor={C.green}
            />
            <Text style={f.calLabel}>KCAL</Text>
          </View>

          <Pressable style={f.applyBtn} onPress={() => dismiss(() => onApply(draft))}>
            <Text style={f.applyText}>Apply</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Restaurant Card ─────────────────────────────────────────────────────────

function RestaurantCard({ restaurant }: { restaurant: MockRestaurant }) {
  const bm = restaurant.bestMatch;
  return (
    <TouchableOpacity activeOpacity={0.9} style={r.container}>
      <Image source={{ uri: restaurant.photoUrl }} style={r.image} resizeMode="cover" />
      <LinearGradient colors={['transparent', 'rgba(10,14,20,0.92)']} style={r.gradient} />
      <View style={r.overlay}>
        {bm && <Text style={r.title}>{bm.name}</Text>}
        <Text style={r.meta}>
          {restaurant.name} {'\u2022'} {restaurant.distanceMiles.toFixed(1)} mi
        </Text>
        {bm && (
          <View style={r.macroRow}>
            <Text style={r.macroChip}>P {bm.proteinG}g</Text>
            <Text style={r.macroChip}>C {bm.carbsG}g</Text>
            <Text style={r.macroChip}>F {bm.fatG}g</Text>
            <Text style={r.macroCal}>{bm.calories} kcal</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function SearchMockup() {
  const [macros, setMacros] = useState<MacroValues>(DEFAULT_MACROS);
  const [filterVisible, setFilterVisible] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.white }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        <SearchHeader values={macros} onPress={() => setFilterVisible(true)} />
        {RESTAURANTS.map((rest) => (
          <RestaurantCard key={rest.id} restaurant={rest} />
        ))}
      </ScrollView>

      <FilterPopup
        visible={filterVisible}
        values={macros}
        onApply={(v) => { setFilterVisible(false); setMacros(v); }}
        onClose={() => setFilterVisible(false)}
      />
    </SafeAreaView>
  );
}

// ─── Header Styles ───────────────────────────────────────────────────────────

const h = StyleSheet.create({
  wrapper: { backgroundColor: C.white },
  inner: { paddingHorizontal: 20, paddingBottom: 22, gap: 16 },
  row1: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  logoLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  logo: { fontSize: 22, fontWeight: '800', color: C.green, letterSpacing: -0.8 },
  locationPill: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.borderLight,
    borderRadius: 14, paddingHorizontal: 11, paddingVertical: 5,
    borderWidth: 1, borderColor: C.border, gap: 5,
  },
  locationDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
  locationText: { fontSize: 11, fontWeight: '600', color: C.textSecondary },
  row2: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  headline: { fontFamily: FONTS.headline, fontSize: 28, color: C.text },
  reset: { fontSize: 11, fontWeight: '600', color: C.textTertiary, letterSpacing: 1 },
  row3: { flexDirection: 'row', gap: 8 },
  macroBox: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderRadius: 14, paddingVertical: 12, borderWidth: 1.5, borderColor: C.border,
  },
  macroBoxHighlight: { borderColor: C.green },
  macroValue: { fontFamily: FONTS.body, fontSize: 18, color: C.text, letterSpacing: -0.3 },
  macroValueHighlight: { color: C.green, fontWeight: '500' },
  macroLabel: { fontSize: 9, fontWeight: '800', color: C.textTertiary, letterSpacing: 1.5, marginTop: 2 },
  macroLabelHighlight: { color: C.greenDark },
});

// ─── Filter Styles ───────────────────────────────────────────────────────────

const f = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  card: {
    width: '100%', maxWidth: 360, borderRadius: 24, backgroundColor: C.white,
    borderWidth: 1, borderColor: C.border, paddingHorizontal: 18, paddingTop: 24, paddingBottom: 20, gap: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 24, elevation: 8,
  },
  macroRow: { flexDirection: 'row', gap: 10 },
  macroBox: { flex: 1, alignItems: 'center', borderRadius: 14, borderWidth: 1.5, borderColor: C.border, paddingVertical: 14, gap: 4 },
  macroInput: { fontSize: 22, fontWeight: '400', color: C.text, letterSpacing: -0.3, minWidth: 52, textAlign: 'center', padding: 0 },
  macroLabel: { fontSize: 9, fontWeight: '800', color: C.textTertiary, letterSpacing: 1.5 },
  calBox: { alignItems: 'center', borderRadius: 14, borderWidth: 1.5, borderColor: C.green, paddingVertical: 14, gap: 4 },
  calInput: { fontSize: 22, fontWeight: '500', color: C.green, minWidth: 60, textAlign: 'center', padding: 0 },
  calLabel: { fontSize: 9, fontWeight: '800', color: C.greenDark, letterSpacing: 1.5 },
  applyBtn: {
    borderRadius: 16, paddingVertical: 16, alignItems: 'center', backgroundColor: C.green,
    shadowColor: C.green, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 6,
  },
  applyText: { fontSize: 16, fontWeight: '700', color: C.white, letterSpacing: -0.2 },
});

// ─── Restaurant Card Styles ──────────────────────────────────────────────────

const r = StyleSheet.create({
  container: {
    height: 220, marginHorizontal: 14, marginBottom: 16, borderRadius: 20,
    overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(68,72,79,0.2)',
  },
  image: { width: '100%', height: '100%' },
  gradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 220 },
  overlay: { position: 'absolute', bottom: 18, left: 18, right: 18 },
  title: {
    fontSize: 20, fontWeight: '800', color: '#F1F3FC', letterSpacing: -0.3,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8,
  },
  meta: { fontSize: 12, fontWeight: '500', color: 'rgba(241,243,252,0.6)', marginTop: 3 },
  macroRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 6 },
  macroChip: { fontSize: 9, fontWeight: '600', color: 'rgba(241,243,252,0.4)', letterSpacing: 0.5 },
  macroCal: { fontSize: 9, fontWeight: '700', color: 'rgba(74,222,128,0.7)' },
});
