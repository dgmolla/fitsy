import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import type { ShuffleResponse } from '@fitsy/shared';
import { EDITORIAL, FONTS } from '@/lib/brand';
import type { MacroValues } from '@/lib/macroPresets';
import { ApiRequestError } from '@/lib/api';
import { fetchShuffle, shuffleTargets } from '@/lib/shuffle';
import { useShuffleFlag } from '@/lib/useShuffleFlag';
import { usePurchases } from '@/lib/usePurchases';
import { supabase } from '@/lib/supabase';
import { routeToPaywall } from '@/lib/teaserGate';

interface Props {
  values: MacroValues;
  lat: number;
  lng: number;
  locating: boolean;
  onEditTargets: () => void;
  renderSearchBar?: (action: React.ReactNode) => React.ReactNode;
}

export function ShuffleSection(props: Props) {
  const { shuffleSeed, shuffleDebug } = useLocalSearchParams<{ shuffleSeed?: string; shuffleDebug?: string }>();
  const enabled = useShuffleFlag(shuffleDebug === '1');
  const { entitled } = usePurchases();
  // Deterministic native walkthroughs use the real endpoint on a Debug build.
  // A production deep link cannot override the lottery or enable the flag.
  const seed = __DEV__ && typeof shuffleSeed === 'string' ? shuffleSeed.slice(0, 80) : undefined;
  return enabled ? <ShufflePicker key={JSON.stringify([props.values, props.lat, props.lng, entitled, seed])} {...props} seed={seed} /> : props.renderSearchBar?.(null) ?? null;
}

function ShufflePicker({ values, lat, lng, locating, onEditTargets, renderSearchBar, seed }: Props & { seed?: string }) {
  const [result, setResult] = useState<ShuffleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const recent = useRef<string[]>([]);
  const attempt = useRef(0);
  const targets = shuffleTargets(values);
  const hasTargets = Object.keys(targets).length > 0;
  const reset = useCallback(() => {
    request.current?.abort();
    request.current = null;
    recent.current = [];
    setResult(null);
    setError(null);
    setBusy(false);
  }, []);
  useFocusEffect(useCallback(() => reset, [reset]));
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') reset();
    });
    return () => data.subscription.unsubscribe();
  }, [reset]);

  async function shuffle() {
    if (request.current || locating || !hasTargets) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    setResult(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    const timeout = setTimeout(() => {
      if (request.current !== controller) return;
      controller.abort();
      request.current = null;
      setBusy(false);
      setError('Shuffle took too long. Check your connection and try again.');
    }, 12_000);
    try {
      const params = { lat, lng, targets, seed: seed ? `${seed}:${attempt.current++}` : Crypto.randomUUID(), excludeRecent: recent.current };
      let response = await fetchShuffle(params, controller.signal);
      // Exhausting recent picks is different from having no eligible meals.
      if (!response.data && params.excludeRecent.length && !controller.signal.aborted) {
        response = await fetchShuffle({ ...params, excludeRecent: [] }, controller.signal);
        if (request.current === controller) recent.current = [];
      }
      if (request.current !== controller || controller.signal.aborted) return;
      setResult(response);
      if (response.data?.item && !response.meta.locked) {
        recent.current = [...recent.current, response.data.item.id].slice(-5);
      }
    } catch (err) {
      if (request.current !== controller) return;
      setError(err instanceof ApiRequestError && err.status === 429
        ? 'A few too many shuffles. Wait a moment, then try again.'
        : 'We couldn’t find a pick right now. Please try again.');
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }

  const pick = result?.data;
  const locked = result?.meta.locked === true;
  const again = result !== null || error !== null;
  function viewMenu() {
    if (!pick) return;
    if (locked) {
      void routeToPaywall({ intent: { action: 'menu', restaurantId: pick.restaurant.id, restaurantName: pick.restaurant.name } })
        .catch(() => Alert.alert('Could not open plans', 'Please try again.'));
    } else {
      router.push({ pathname: `/restaurant/${pick.restaurant.id}`, params: {
        selectedItemId: pick.item?.id, distance: pick.distanceMiles.toFixed(1),
      } });
    }
  }
  const disabled = busy || locating || !hasTargets;
  const entryButton = <Pressable onPress={() => { void shuffle(); }} disabled={disabled} hitSlop={6}
    accessibilityRole="button" accessibilityLabel="Shuffle a nearby meal"
    accessibilityHint={hasTargets ? 'Find a meal for your targets' : 'Set a meal target first'}
    accessibilityState={{ disabled, busy }} testID="shuffle-button"
    style={({ pressed }) => [s.entryButton, disabled && s.disabled, pressed && s.pressed]}>
    <Ionicons name="shuffle" size={18} color={EDITORIAL.greenAccent} />
  </Pressable>;
  return <View testID="shuffle-section">
    {renderSearchBar ? renderSearchBar(entryButton) : <View style={s.entryRow}>{entryButton}</View>}
    {(busy || again || !hasTargets) && <View style={s.section}>
      {!hasTargets && <Text style={s.caption}>Set a meal target to find your first pick.</Text>}
      {busy && <View style={s.loading} accessibilityLiveRegion="polite" testID="shuffle-loading">
        <ActivityIndicator color={EDITORIAL.green} /><Text style={s.caption}>Finding your meal...</Text>
      </View>}
      {error && <Text style={s.caption} accessibilityRole="alert" testID="shuffle-error">{error}</Text>}
      {result && !pick && <View accessibilityLiveRegion="polite" testID="shuffle-empty">
        <Text style={s.title}>Nothing fits nearby</Text>
        <Text style={s.caption}>Try adjusting your meal targets or choosing another area.</Text>
      </View>}
      {pick && <View style={s.card} accessibilityLiveRegion="polite" testID="shuffle-result">
        <Text style={s.eyebrow}>YOUR SHUFFLE PICK</Text>
        <Text style={s.title} testID="shuffle-restaurant">{pick.restaurant.name}</Text>
        <Text style={s.caption} testID="shuffle-distance">{pick.distanceMiles.toFixed(1)} mi away</Text>
        {pick.availability === 'unknown' && <Text style={s.caption}>Check opening hours before you go.</Text>}
        {locked ? <View style={s.teaser} testID="shuffle-locked">
          <Ionicons name="lock-closed-outline" size={20} color={EDITORIAL.green} />
          <Text style={s.caption}>Unlock this meal and its macros with Fitsy Pro.</Text>
        </View> : <>
          <Text style={s.dish} testID="shuffle-dish">{pick.item?.name}</Text>
          {pick.macros && <>
            <View style={s.macros} testID="shuffle-macros">
              {([['calories', 'kcal'], ['proteinG', 'g protein'], ['carbsG', 'g carbs'], ['fatG', 'g fat']] as const).map(([key, label]) =>
                <Text style={s.macro} key={key} testID={`shuffle-macro-${key}`}>{pick.macros!.nutritionBasis === 'estimated' ? '≈' : ''}{Math.round(pick.macros![key])} {label}</Text>)}
            </View>
            <Text style={s.caption}>{pick.macros.nutritionBasis === 'published' ? 'Published nutrition' : 'Estimated nutrition'} · {pick.macros.confidence.toLowerCase()} confidence</Text>
          </>}
          {result.meta.fallback !== 'none' && <Text style={s.caption}>
            {result.meta.fallback === 'radius' ? `Search widened to ${result.meta.radiusMiles} miles with a wider macro range.` : 'This pick uses a wider macro range.'}
          </Text>}
        </>}
      </View>}
      <View style={s.actions}>
        {again && <Pressable onPress={() => { void shuffle(); }} disabled={disabled}
          accessibilityRole="button" accessibilityState={{ disabled, busy }}
          testID="shuffle-again" style={({ pressed }) => [s.button, disabled && s.disabled, pressed && s.pressed]}>
          <Ionicons name="shuffle" size={20} color={EDITORIAL.cream} />
          <Text style={s.buttonText}>Shuffle again</Text>
        </Pressable>}
        {pick && <Pressable onPress={viewMenu} style={s.secondary} accessibilityRole="button" testID="shuffle-view-menu"
          accessibilityHint={locked ? 'View subscription plans to unlock this meal' : 'Open the menu with your shuffled dish first'}>
          <Text style={s.secondaryText}>View menu</Text>
        </Pressable>}
        {(!hasTargets || (result && !pick)) && <Pressable onPress={onEditTargets} style={s.secondary} accessibilityRole="button" testID="shuffle-edit-targets">
          <Text style={s.secondaryText}>Adjust meal targets</Text>
        </Pressable>}
      </View>
    </View>}
  </View>;
}

const s = StyleSheet.create({
  entryRow: { marginHorizontal: 20, alignItems: 'flex-end' },
  entryButton: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: EDITORIAL.border, backgroundColor: EDITORIAL.cream, alignItems: 'center', justifyContent: 'center' },
  section: { marginHorizontal: 20, marginTop: 16, marginBottom: 8, gap: 8 },
  caption: { fontFamily: FONTS.nunitoSans, fontSize: 13, lineHeight: 19, color: EDITORIAL.textMid },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  card: { backgroundColor: EDITORIAL.creamCard, borderWidth: 1, borderColor: EDITORIAL.border, borderRadius: 18, padding: 16, gap: 8 },
  eyebrow: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 10, letterSpacing: 1.5, color: EDITORIAL.greenAccent },
  title: { fontFamily: FONTS.frauncesDisplay, fontSize: 22, color: EDITORIAL.green },
  dish: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 17, lineHeight: 23, color: EDITORIAL.text },
  macros: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  macro: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 13, color: EDITORIAL.green, paddingVertical: 5 },
  teaser: { alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  button: { minHeight: 44, borderRadius: 24, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: EDITORIAL.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 14, color: EDITORIAL.cream },
  secondary: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: EDITORIAL.border, borderRadius: 24 },
  secondaryText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 14, color: EDITORIAL.green },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});
