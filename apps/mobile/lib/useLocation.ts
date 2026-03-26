import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

// Silver Lake, LA — default fallback when GPS is unavailable.
export const FALLBACK_LAT = 34.0868;
export const FALLBACK_LNG = -118.3273;

export type LocationSource = 'gps' | 'fallback';

export interface LocationState {
  lat: number;
  lng: number;
  source: LocationSource;
  loading: boolean;
}

const FALLBACK_STATE: LocationState = {
  lat: FALLBACK_LAT,
  lng: FALLBACK_LNG,
  source: 'fallback',
  loading: false,
};

/**
 * Requests foreground location permission and resolves the current device
 * position. Falls back to Silver Lake coordinates when permission is denied
 * or the GPS fix fails.
 */
export function useLocation(): LocationState {
  const [state, setState] = useState<LocationState>({
    lat: FALLBACK_LAT,
    lng: FALLBACK_LNG,
    source: 'fallback',
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();

        if (status !== 'granted') {
          if (!cancelled) setState(FALLBACK_STATE);
          return;
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (!cancelled) {
          setState({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            source: 'gps',
            loading: false,
          });
        }
      } catch {
        // Permission error, GPS unavailable, or timeout — use fallback.
        if (!cancelled) setState(FALLBACK_STATE);
      }
    }

    resolve();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
