import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

export const FALLBACK_LAT = 34.0868;
export const FALLBACK_LNG = -118.3273;

export type LocationSource = 'gps' | 'fallback';

export interface LocationState {
  lat: number;
  lng: number;
  source: LocationSource;
  loading: boolean;
}

export function useLocation(): LocationState {
  const [state, setState] = useState<LocationState>({
    lat: FALLBACK_LAT,
    lng: FALLBACK_LNG,
    source: 'fallback',
    loading: false,
  });

  useEffect(() => {
    let cancelled = false;
    const t0 = Date.now();

    async function resolve() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        console.log(`[location] permission: ${Date.now() - t0}ms`);
        if (status !== 'granted' || cancelled) return;

        const lastKnown = await Location.getLastKnownPositionAsync();
        console.log(`[location] lastKnown: ${Date.now() - t0}ms (${lastKnown ? 'hit' : 'miss'})`);
        if (lastKnown && !cancelled) {
          setState({
            lat: lastKnown.coords.latitude,
            lng: lastKnown.coords.longitude,
            source: 'gps',
            loading: false,
          });
        }

        const position = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        if (!position) {
          console.log(`[location] fresh GPS timed out: ${Date.now() - t0}ms`);
          return;
        }
        console.log(`[location] fresh GPS: ${Date.now() - t0}ms`);
        if (!cancelled) {
          setState({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            source: 'gps',
            loading: false,
          });
        }
      } catch {
        console.log(`[location] failed, using fallback: ${Date.now() - t0}ms`);
      }
    }

    resolve();
    return () => { cancelled = true; };
  }, []);

  return state;
}
