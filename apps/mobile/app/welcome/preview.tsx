import { useOnboardingStep } from '@/lib/onboardingResume';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { GuidedPreviewResponse, RestaurantResult } from '@fitsy/shared';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { saveOnboardingField, type OnboardingArea } from '@/lib/onboardingStorage';
import { type StoredMacroTargets } from '@/lib/macroStorage';
import { getPreviewSetup } from '@/lib/previewSetup';
import { fetchGuidedPreview } from '@/lib/guidedPreview';
import { hasSeenPreviewTour, markPreviewTourSeen, routeToPaywall } from '@/lib/teaserGate';
import { usePreviewAccess } from '@/lib/usePreviewAccess';
import { usePurchases } from '@/lib/usePurchases';
import { trackOnboardingScreenView } from '@/lib/analytics';

const STEPS = [
  ['Your meal targets', 'These numbers guide the picks below. You can edit them anytime.'],
  ['What are you craving?', 'Try one craving search to see how Fitsy finds dishes that fit.'],
  ['Three real meal picks', 'Names and macros are yours to explore. Full menus and saving come with Pro.'],
] as const;

export default function GuidedPreviewScreen() {
  useOnboardingStep('preview');
  const navigation = useNavigation();
  const [area, setArea] = useState<OnboardingArea>();
  const [targets, setTargets] = useState<StoredMacroTargets | null>(null);
  const [result, setResult] = useState<GuidedPreviewResponse | null>(null);
  const [query, setQuery] = useState('');
  const [usedQuery, setUsedQuery] = useState(false);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const access = usePreviewAccess();
  const { entitled } = usePurchases();
  const focused = useIsFocused();

  useEffect(() => {
    if (!focused || !access.ready || entitled === null) return;
    if (entitled) router.replace('/(tabs)/search');
    else if (!access.canPreview) void routeToPaywall({ replace: true });
  }, [access.ready, access.canPreview, entitled, focused]);
  useEffect(() => { trackOnboardingScreenView(`preview_tour_${step}`); }, [step]);

  const load = useCallback(async () => {
    const sequence = ++request.current;
    setBusy(true); setError(false);
    try {
      const [{ data, targets: macros }, seen] = await Promise.all([getPreviewSetup(), hasSeenPreviewTour()]);
      if (!data.area) { router.replace('/welcome/location-permission'); return; }
      const areaKey = `${data.area.lat}:${data.area.lng}`;
      const craving = data.previewArea === areaKey ? data.previewCraving ?? '' : '';
      const response = await fetchGuidedPreview(data.area, craving);
      if (sequence !== request.current) return;
      setArea(data.area); setTargets(macros); setQuery(craving); setUsedQuery(!!craving); setResult(response);
      if (seen) setStep(2);
    } catch { if (sequence === request.current) setError(true); }
    finally { if (sequence === request.current) setBusy(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); return () => { ++request.current; }; }, [load]));

  async function unlock(action: 'menu' | 'save' | 'discovery', restaurant?: RestaurantResult) {
    markPreviewTourSeen();
    try { await routeToPaywall({ intent: {
      action, restaurantId: restaurant?.id, menuItemId: restaurant?.bestMatch?.menuItemId,
      mealName: restaurant?.bestMatch?.name, nearbyDishCount: result?.meta.nearbyDishCount, areaName: area?.name,
    } }); } catch { Alert.alert('Could not open plans', 'Please try again. Your meal picks are still here.'); }
  }
  async function searchCraving() {
    if (!area || busy || !query.trim()) return;
    Keyboard.dismiss();
    if (usedQuery) { await unlock('discovery'); return; }
    setBusy(true); setError(false);
    const sequence = ++request.current;
    try {
      const response = await fetchGuidedPreview(area, query.trim());
      if (sequence !== request.current) return;
      setResult(response);
      if (response.data.length) {
        await saveOnboardingField('previewArea', `${area.lat}:${area.lng}`);
        await saveOnboardingField('previewCraving', query.trim());
        setUsedQuery(true); setStep(2);
      }
    } catch { Alert.alert('Could not search this craving', 'Please try again. Your preview search is still available.'); }
    finally { if (sequence === request.current) setBusy(false); }
  }

  if (!access.ready || !access.canPreview || entitled) return null;
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.nav}>
          {navigation.canGoBack() && <Pressable style={s.hit} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" testID="preview-back"><Ionicons name="chevron-back" size={22} color={EDITORIAL.green} /></Pressable>}
          <Text style={s.eyebrow}>YOUR FITSY PREVIEW</Text>
        </View>
        <Text style={s.title}>Cravings welcome.</Text>
        <Text style={s.detail}>{area?.name ?? 'Your chosen area'} · Within 3 miles</Text>
        <View style={s.guide} testID="preview-guide">
          <Text style={s.guideTitle}>{step + 1} / 3 · {STEPS[step]![0]}</Text>
          <Text style={s.detail}>{STEPS[step]![1]}</Text>
          {step < 2 && <Pressable style={s.hit} onPress={() => setStep(step + 1)} accessibilityRole="button" testID="preview-guide-next"><Text style={s.link}>{step === 0 ? 'Try a craving search' : 'See my meal picks'} →</Text></Pressable>}
        </View>
        <Pressable style={s.targets} onPress={() => router.dismissTo('/welcome/tuning')} accessibilityRole="button" testID="preview-edit-targets">
          <Text style={s.guideTitle}>Per meal · Tap to edit</Text>
          <Text style={s.detail}>{targets?.calories ?? '0'} kcal · {targets?.protein ?? '0'}g protein · {targets?.carbs ?? '0'}g carbs · {targets?.fat ?? '0'}g fat</Text>
        </Pressable>
        <View style={s.search}>
          <TextInput value={query} onChangeText={setQuery} style={s.input} placeholder="Try tacos, chicken, or sushi" placeholderTextColor={EDITORIAL.textSoft} returnKeyType="search" maxLength={100}
            onSubmitEditing={searchCraving} accessibilityLabel="Search a craving" testID="preview-craving" />
          <Pressable style={s.searchButton} onPress={searchCraving} disabled={busy || !query.trim()} accessibilityRole="button" accessibilityLabel={usedQuery ? 'See plans for more craving searches' : 'Search this craving'} testID="preview-search"><Ionicons name={usedQuery ? 'lock-closed-outline' : 'search'} size={20} color={EDITORIAL.cream} /></Pressable>
        </View>
        {usedQuery && <Text style={s.detail}>Your preview search is complete. Keep exploring with Pro.</Text>}
        {busy ? <Text style={s.status} testID="preview-loading">Finding real dishes nearby…</Text> : error ? (
          <View style={s.status}><Text style={s.detail}>We couldn't load your meal picks.</Text><Pressable style={s.hit} onPress={load} accessibilityRole="button" testID="preview-retry"><Text style={s.link}>Try again</Text></Pressable></View>
        ) : result?.data.length === 0 ? (
          <View style={s.status}><Text style={s.detail}>{result.meta.nearbyDishCount === 0 ? 'No dishes with nutrition in this area yet.' : 'No matches for this craving. Try another.'}</Text>
            {result.meta.nearbyDishCount === 0 && <Pressable style={s.hit} onPress={() => router.push('/welcome/location-permission')} accessibilityRole="button" testID="preview-change-area"><Text style={s.link}>Choose another area</Text></Pressable>}
          </View>
        ) : result?.data.map((restaurant, index) => {
          const meal = restaurant.bestMatch;
          if (!meal) return null;
          const source = meal.nutritionBasis === 'published' ? 'Published nutrition' : 'Estimated nutrition';
          return <View style={s.card} key={restaurant.id} testID={`preview-pick-${index + 1}`}>
            <Text style={s.eyebrow}>MEAL PICK {index + 1} · {restaurant.distanceMiles.toFixed(1)} MI</Text>
            <Text style={s.meal}>{meal.name}</Text><Text style={s.detail}>{restaurant.name}</Text>
            <Text style={s.macros}>{Math.round(meal.calories)} kcal · {Math.round(meal.proteinG)}g protein</Text>
            <Text style={s.detail}>{Math.round(meal.carbsG)}g carbs · {Math.round(meal.fatG)}g fat · {source}</Text>
            <View style={s.cardActions}>
              <Pressable style={s.hit} onPress={() => unlock('menu', restaurant)} accessibilityRole="button" testID={`preview-menu-${index + 1}`}><Text style={s.link}>See full menu with Pro</Text></Pressable>
              <Pressable style={s.hit} onPress={() => unlock('save', restaurant)} accessibilityRole="button" accessibilityLabel={`See plans to save ${meal.name}`} testID={`preview-save-${index + 1}`}><Ionicons name="bookmark-outline" size={20} color={EDITORIAL.green} /></Pressable>
            </View>
          </View>;
        })}
        {!!result?.meta.nearbyDishCount && <Text style={s.coverage} testID="preview-local-count">{result.meta.nearbyDishCount.toLocaleString()} dishes with nutrition in this area.</Text>}
        <Pressable style={s.cta} onPress={() => unlock('discovery')} accessibilityRole="button" testID="preview-see-plans"><Text style={s.ctaText}>Explore meals that fit with Pro</Text></Pressable>
        <Text style={s.coverage}>Craving search · Full menus · Saved meals</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream },
  content: { paddingHorizontal: 24, paddingBottom: 24, gap: 14 },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hit: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  eyebrow: { ...TEXT.bodySmall, fontSize: 10, letterSpacing: 1.2, color: EDITORIAL.greenMid },
  title: { ...TEXT.headline, fontSize: 34, lineHeight: 40 },
  detail: { ...TEXT.bodySmall, fontSize: 13, lineHeight: 19 },
  guide: { backgroundColor: EDITORIAL.greenAccentTint, padding: 16, borderRadius: 18, gap: 8 },
  guideTitle: { ...TEXT.body, fontSize: 14, color: EDITORIAL.green },
  targets: { paddingVertical: 10, gap: 5 },
  search: { flexDirection: 'row', borderWidth: 1, borderColor: EDITORIAL.border, borderRadius: 26, overflow: 'hidden' },
  input: { ...TEXT.body, flex: 1, paddingHorizontal: 16, minHeight: 52, fontSize: 14 },
  searchButton: { backgroundColor: EDITORIAL.green, width: 52, alignItems: 'center', justifyContent: 'center' },
  status: { paddingVertical: 24, ...TEXT.bodySmall },
  card: { borderWidth: 1, borderColor: EDITORIAL.border, backgroundColor: EDITORIAL.creamCard, borderRadius: 22, padding: 18, gap: 7 },
  meal: { ...TEXT.headline, fontSize: 23, lineHeight: 28 },
  macros: { ...TEXT.body, fontSize: 16, color: EDITORIAL.green, marginTop: 4 },
  cardActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  link: { ...TEXT.body, fontSize: 13, color: EDITORIAL.green },
  coverage: { ...TEXT.bodySmall, fontSize: 12, textAlign: 'center' },
  cta: { minHeight: 54, backgroundColor: EDITORIAL.green, borderRadius: 30, padding: 16, alignItems: 'center', justifyContent: 'center' },
  ctaText: { ...TEXT.cta, fontSize: 15, textAlign: 'center' },
});
