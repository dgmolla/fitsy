import { useOnboardingStep } from '@/lib/onboardingResume';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { router, useFocusEffect } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { WelcomeActions } from '@/components/WelcomeActions';
import { OnboardingLocationMap } from '@/components/OnboardingLocationMap';
import { LocationPickerSheet } from '@/components/LocationPickerSheet';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { setCachedCoords } from '@/lib/locationCache';
import { MANUAL_LOCATION_KEY } from '@/lib/useLocation';
import { getOnboardingData, saveOnboardingField, type OnboardingArea } from '@/lib/onboardingStorage';
import { fetchGuidedPreview } from '@/lib/guidedPreview';
import { useRouteContinuation } from '@/lib/useRouteContinuation';
import { trackLocationPrimingShown, trackLocationPermissionGranted, trackLocationPermissionDenied } from '@/lib/analytics';

export default function LocationPermissionScreen() {
  useOnboardingStep('location-permission');
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [area, setArea] = useState<OnboardingArea>();
  const { begin } = useRouteContinuation();
  useEffect(() => {
    trackLocationPrimingShown();
  }, []);
  useFocusEffect(useCallback(() => {
    let current = true;
    setBusy(false);
    void getOnboardingData().then(data => { if (current) setArea(data.area); });
    return () => { current = false; };
  }, []));

  async function choose(next: OnboardingArea, isCurrent = begin()) {
    if (!isCurrent()) return;
    setPicker(false);
    setBusy(true);
    setArea(next);
    try {
      // Persist the user's area even when coverage is empty, so the waitlist
      // can submit it explicitly. A failed lookup never substitutes an area.
      await saveOnboardingField('area', next);
      await setCachedCoords(next);
      if (next.source === 'manual') await SecureStore.setItemAsync(MANUAL_LOCATION_KEY, JSON.stringify(next));
      else if (next.source === 'gps') await SecureStore.deleteItemAsync(MANUAL_LOCATION_KEY);
      const result = await fetchGuidedPreview(next, '', null);
      if (isCurrent()) router.push(result.meta.nearbyDishCount > 0 ? '/welcome/goal' : '/welcome/out-of-area');
    } catch { if (isCurrent()) Alert.alert('Could not check this area', 'Please try again. Your selected area is saved.'); }
    finally { if (isCurrent()) setBusy(false); }
  }

  async function useCurrent() {
    if (busy) return;
    const isCurrent = begin();
    setPicker(false);
    setBusy(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!isCurrent()) return;
      if (permission.status !== 'granted') {
        trackLocationPermissionDenied({ had_last_known: false });
        Alert.alert('Choose an area instead', 'You can search a neighborhood without sharing your device location.');
        setPicker(true);
        return;
      }
      trackLocationPermissionGranted();
      const fix = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Location timed out')), 8000)),
      ]);
      await choose({ lat: fix.coords.latitude, lng: fix.coords.longitude, name: 'Your location', source: 'gps' }, isCurrent);
    } catch { if (isCurrent()) Alert.alert('Location unavailable', 'Choose an area, or try your location again.'); }
    finally { if (isCurrent()) setBusy(false); }
  }

  return (
    <WelcomeScreen progress={0.14} title={"Where would you\nlike to eat?"} subtitle="Find restaurants around you." hideFooter canContinue onContinue={() => {}}
      footerContent={<WelcomeActions label={busy ? 'Checking nearby dishes…' : area ? `Continue with ${area.name}` : 'Use my location'}
        onPress={area ? () => { void choose(area); } : useCurrent} disabled={busy}
        testID={area ? 'location-continue-area' : 'location-use-current'}
        secondaryLabel={area ? 'Choose another area' : 'Choose an area instead'} onSecondary={() => setPicker(true)} secondaryTestID="location-choose-area" />}>
      <OnboardingLocationMap />
      <Text style={s.intro}>Use your location to discover nearby menus. You can change your area anytime.</Text>
      {area && <View style={s.alternate}><Pressable style={s.alternateHit} disabled={busy} onPress={useCurrent} accessibilityRole="button" testID="location-use-current"><Text style={s.alternateText}>Use my current location instead</Text></Pressable></View>}
      {busy && <Text style={s.area} accessibilityLiveRegion="polite">Checking nearby dishes…</Text>}
      <Text style={s.privacy}>Your selected area stays on this device. We use its coordinates to find nearby meals. Device location is optional.</Text>
      <LocationPickerSheet visible={picker} activeName={area?.name} onClose={() => setPicker(false)} onUseCurrent={useCurrent} onPick={loc => choose({ ...loc, source: 'manual' })} />
    </WelcomeScreen>
  );
}
const s = StyleSheet.create({
  intro: { ...TEXT.body, textAlign: 'center', marginTop: 16 },
  area: { ...TEXT.bodySmall, textAlign: 'center', marginTop: 16 },
  alternate: { alignItems: 'center', marginTop: 4 },
  alternateHit: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  alternateText: { ...TEXT.bodySmall, color: EDITORIAL.green, textAlign: 'center', textDecorationLine: 'underline' },
  privacy: { ...TEXT.bodySmall, fontSize: 12, lineHeight: 18, marginTop: 12, textAlign: 'center' },
});
