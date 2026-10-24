import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { useLocation, MANUAL_LOCATION_KEY, type UseLocationResult } from './useLocation';
import { getPreviewSetup } from './previewSetup';
import { saveOnboardingField, type OnboardingArea } from './onboardingStorage';
import { setCachedCoords } from './locationCache';

/** Preview searches use the area the person chose, never a silent GPS fallback. */
export function useDiscoveryLocation(preview: boolean): UseLocationResult {
  const liveLocation = useLocation({ enabled: !preview });
  const [area, setArea] = useState<OnboardingArea>();
  useFocusEffect(useCallback(() => {
    if (!preview) return;
    let live = true;
    void getPreviewSetup().then(({ data }) => {
      if (!live) return;
      if (data.area) setArea(data.area);
      else router.replace('/welcome/location-permission');
    });
    return () => { live = false; };
  }, [preview]));

  const persist = useCallback(async (next: OnboardingArea) => {
    await saveOnboardingField('area', next);
    await setCachedCoords(next);
    if (next.source === 'manual') await SecureStore.setItemAsync(MANUAL_LOCATION_KEY, JSON.stringify(next));
    else await SecureStore.deleteItemAsync(MANUAL_LOCATION_KEY);
    setArea(next);
  }, []);
  if (!preview) return liveLocation;
  return {
    lat: area?.lat ?? 0, lng: area?.lng ?? 0, name: area?.name,
    source: area?.source === 'gps' ? 'gps' : 'manual', loading: !area,
    setManualLocation: next => persist({ ...next, source: 'manual' }),
    clearManualLocation: async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Location permission not granted');
      const fix = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Location timed out')), 8000)),
      ]);
      await persist({ lat: fix.coords.latitude, lng: fix.coords.longitude, name: 'Your location', source: 'gps' });
    },
    refreshLocation: async () => null,
  };
}
