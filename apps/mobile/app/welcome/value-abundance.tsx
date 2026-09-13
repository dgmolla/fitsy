import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import type { GuidedPreviewResponse } from '@fitsy/shared';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { RestaurantPhoto } from '@/components/RestaurantPhoto';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { useOnboardingStep } from '@/lib/onboardingResume';
import { getPreviewSetup } from '@/lib/previewSetup';
import { fetchGuidedPreview } from '@/lib/guidedPreview';

export default function ValueAbundanceScreen() {
  useOnboardingStep('value-abundance');
  const [result, setResult] = useState<GuidedPreviewResponse>();
  const [name, setName] = useState('your chosen area');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  useFocusEffect(useCallback(() => {
    // A user-requested retry starts a new lookup even on the same focused screen.
    void retry;
    let live = true;
    setStatus('loading');
    void getPreviewSetup().then(async ({ data }) => {
      if (!data.area) { if (live) router.replace('/welcome/location-permission'); return; }
      const response = await fetchGuidedPreview(data.area, '', null);
      if (!live) return;
      setName(data.area.name); setResult(response); setStatus('ready');
    }).catch(() => { if (live) setStatus('error'); });
    return () => { live = false; };
  }, [retry]));
  return <WelcomeScreen progress={0.5} title={"Good food.\nMore possibilities."}
    subtitle={status === 'ready' ? `Explore menus around ${name}. Next, we'll match meals to your targets.` : 'See what is on the menu nearby.'}
    canContinue={status === 'ready' && !!result?.data.length} onContinue={() => router.push('/welcome/how-it-works')} continueLabel="About the nutrition">
    {status === 'loading' && <Text style={s.note} testID="nearby-loading">Finding nearby menu picks…</Text>}
    {status === 'error' && <View><Text style={s.note}>We couldn't load nearby picks.</Text><Pressable style={s.retry} onPress={() => setRetry(n => n + 1)} accessibilityRole="button" testID="nearby-retry"><Text style={s.link}>Try again</Text></Pressable></View>}
    {status === 'ready' && <>
      <View style={s.picks}>
        {result?.data.map((restaurant, index) => <View style={s.card} key={restaurant.id} testID={`nearby-pick-${index + 1}`}>
          <RestaurantPhoto uri={restaurant.photoUrl} name={restaurant.name} style={s.image} />
          <LinearGradient colors={['transparent', EDITORIAL.heroGrad]} style={StyleSheet.absoluteFill} />
          <View style={s.caption}><Text style={s.restaurant} numberOfLines={2}>{restaurant.name}</Text><Text style={s.meal}>Explore the menu · {restaurant.distanceMiles.toFixed(1)} mi</Text></View>
        </View>)}
      </View>
      {!!result?.meta.nearbyDishCount && <Text style={s.note}>{result.meta.nearbyDishCount.toLocaleString()} dishes with nutrition within 3 miles.</Text>}
      {!result?.data.length && <Pressable style={s.retry} onPress={() => router.back()} accessibilityRole="button" testID="nearby-change-area"><Text style={s.link}>Choose another area</Text></Pressable>}
    </>}
  </WelcomeScreen>;
}

const s = StyleSheet.create({
  picks: { gap: 12 },
  card: { height: 126, borderRadius: 18, overflow: 'hidden', backgroundColor: EDITORIAL.green },
  image: { width: '100%', height: '100%' },
  caption: { position: 'absolute', bottom: 14, left: 16, right: 16, gap: 3 },
  restaurant: { ...TEXT.body, color: EDITORIAL.cream, fontSize: 17 },
  meal: { ...TEXT.bodySmall, color: EDITORIAL.cream, fontSize: 13 },
  note: { ...TEXT.bodySmall, fontSize: 12, lineHeight: 18, marginTop: 16 },
  retry: { minHeight: 48, justifyContent: 'center' },
  link: { ...TEXT.body, color: EDITORIAL.green },
});
