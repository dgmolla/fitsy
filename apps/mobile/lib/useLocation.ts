import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import {
  trackLocationError,
  trackLocationPermissionDenied,
  trackLocationTimeout,
} from './analytics';

export const FALLBACK_LAT = 34.0868;
export const FALLBACK_LNG = -118.3273;

export type LocationSource =
  | 'gps'
  | 'fallback-denied'
  | 'fallback-timeout'
  | 'fallback-error';

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
    source: 'fallback-denied',
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    const t0 = Date.now();

    async function resolve() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        console.log(`[location] permission: ${Date.now() - t0}ms`);
        if (cancelled) return;
        if (status !== 'granted') {
          trackLocationPermissionDenied({ had_last_known: false });
          setState({
            lat: FALLBACK_LAT,
            lng: FALLBACK_LNG,
            source: 'fallback-denied',
            loading: false,
          });
          return;
        }

        const lastKnown = await Location.getLastKnownPositionAsync();
        console.log(`[location] lastKnown: ${Date.now() - t0}ms (${lastKnown ? 'hit' : 'miss'})`);
        if (lastKnown && !cancelled) {
          setState({
            lat: lastKnown.coords.latitude,
            lng: lastKnown.coords.longitude,
            source: 'gps',
            loading: false,
          });
          return;
        }

        const position = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        if (cancelled) return;
        if (!position) {
          console.log(`[location] fresh GPS timed out: ${Date.now() - t0}ms`);
          trackLocationTimeout({ had_last_known: lastKnown !== null });
          setState({
            lat: FALLBACK_LAT,
            lng: FALLBACK_LNG,
            source: 'fallback-timeout',
            loading: false,
          });
          return;
        }
        console.log(`[location] fresh GPS: ${Date.now() - t0}ms`);
        setState({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          source: 'gps',
          loading: false,
        });
      } catch (err) {
        console.log(`[location] failed, using fallback: ${Date.now() - t0}ms`);
        if (cancelled) return;
        trackLocationError({
          error_message: err instanceof Error ? err.message : String(err),
        });
        setState({
          lat: FALLBACK_LAT,
          lng: FALLBACK_LNG,
          source: 'fallback-error',
          loading: false,
        });
      }
    }

    resolve();
    return () => { cancelled = true; };
  }, []);

  return state;
}
