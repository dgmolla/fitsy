import { useOnboardingStep } from '@/lib/onboardingResume';
import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { LocationPickerSheet } from '@/components/LocationPickerSheet';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { setCachedCoords } from '@/lib/locationCache';
import { MANUAL_LOCATION_KEY } from '@/lib/useLocation';
import { getOnboardingData, saveOnboardingField, type OnboardingArea } from '@/lib/onboardingStorage';
import { fetchGuidedPreview } from '@/lib/guidedPreview';
import { trackLocationPrimingShown, trackLocationPermissionGranted, trackLocationPermissionDenied } from '@/lib/analytics';

export default function LocationPermissionScreen() {
  useOnboardingStep('location-permission');
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [area, setArea] = useState<OnboardingArea>();
  useEffect(() => {
    trackLocationPrimingShown();
    void getOnboardingData().then(data => setArea(data.area));
  }, []);

  async function choose(next: OnboardingArea) {
    setPicker(false);
    setBusy(true);
    setArea(next);
    try {
      // Persist the user's area even when coverage is empty, so the waitlist
      // can submit it explicitly. A failed lookup never substitutes an area.
      await saveOnboardingField('area', next);
      await setCachedCoords(next);
      if (next.source === 'manual') await SecureStore.setItemAsync(MANUAL_LOCATION_KEY, JSON.stringify(next));
      else await SecureStore.deleteItemAsync(MANUAL_LOCATION_KEY);
      const result = await fetchGuidedPreview(next);
      router.push(result.meta.nearbyDishCount > 0 ? '/welcome/target-setup' : '/welcome/out-of-area');
    } catch { Alert.alert('Could not check this area', 'Please try again. Your selected area is saved.'); }
    finally { setBusy(false); }
  }

  async function useCurrent() {
    if (busy) return;
    setPicker(false);
    setBusy(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
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
      await choose({ lat: fix.coords.latitude, lng: fix.coords.longitude, name: 'Your location', source: 'gps' });
    } catch { Alert.alert('Location unavailable', 'Choose an area, or try your location again.'); }
    finally { setBusy(false); }
  }

  return (
    <WelcomeScreen title={"Where are we\neating?"} subtitle="Check nearby menus before setting up your plan." hideFooter canContinue onContinue={() => {}}>
      <View style={s.actions}>
        <Text style={s.area}>{area ? `Selected: ${area.name}` : 'Start with a Los Angeles neighborhood or your current location.'}</Text>
        <AnimatedPress style={s.primary} disabled={busy} onPress={() => setPicker(true)} accessibilityRole="button" testID="location-choose-area"><Text style={s.primaryText}>Choose an area</Text></AnimatedPress>
        <AnimatedPress style={s.secondary} disabled={busy} onPress={useCurrent} accessibilityRole="button" testID="location-use-current"><Text style={s.secondaryText}>Use my location</Text></AnimatedPress>
        {area && <AnimatedPress style={s.secondary} disabled={busy} onPress={() => choose(area)} accessibilityRole="button" testID="location-continue-area"><Text style={s.secondaryText}>Continue with {area.name}</Text></AnimatedPress>}
        {busy && <Text style={s.area} accessibilityLiveRegion="polite">Checking nearby dishes…</Text>}
        <Text style={s.privacy}>We remember your selected area on this device and send coordinates to Fitsy to find nearby meals. Device location is optional.</Text>
      </View>
      <LocationPickerSheet visible={picker} activeName={area?.name} onClose={() => setPicker(false)} onUseCurrent={useCurrent} onPick={loc => choose({ ...loc, source: 'manual' })} />
    </WelcomeScreen>
  );
}
const s = StyleSheet.create({
  actions: { gap: 12, marginTop: 24 },
  area: { ...TEXT.bodySmall, marginBottom: 12 },
  primary: { backgroundColor: EDITORIAL.green, padding: 18, borderRadius: 30, alignItems: 'center' },
  primaryText: { ...TEXT.cta },
  secondary: { padding: 16, borderRadius: 30, borderWidth: 1, borderColor: EDITORIAL.border, alignItems: 'center' },
  secondaryText: { ...TEXT.body, color: EDITORIAL.green, textAlign: 'center' },
  privacy: { ...TEXT.bodySmall, fontSize: 12, lineHeight: 18, marginTop: 20 },
});
