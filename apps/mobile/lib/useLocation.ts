import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import {
  trackLocationError,
  trackLocationPermissionDenied,
  trackLocationTimeout,
} from './analytics';

export const FALLBACK_LAT = 34.0868;
export const FALLBACK_LNG = -118.3273;

// SecureStore keys must contain only alphanumeric, '.', '-', '_' (no ':')
// — matches the `fitsy_authToken` convention used in authClient.ts.
export const MANUAL_LOCATION_KEY = 'fitsy_manual_location';

export type LocationSource =
  | 'gps'
  | 'manual'
  | 'fallback-denied'
  | 'fallback-timeout'
  | 'fallback-error';

export interface LocationState {
  lat: number;
  lng: number;
  source: LocationSource;
  /**
   * Display name for the picked neighborhood when `source === 'manual'`.
   * Undefined for every other source — LocationBar uses static copy in
   * those cases ("Near your location", "Location off — showing Silver Lake",
   * etc.).
   */
  name?: string;
  loading: boolean;
}

export interface ManualLocation {
  name: string;
  lat: number;
  lng: number;
}

export interface UseLocationResult extends LocationState {
  /**
   * Persist a manual neighborhood override and apply it immediately.
   * Survives app restarts via SecureStore.
   */
  setManualLocation: (loc: ManualLocation) => Promise<void>;
  /**
   * Clear any manual override and re-run GPS resolution.
   */
  clearManualLocation: () => Promise<void>;
}

/**
 * Internal: parse the SecureStore payload guarded against corruption.
 * The shape is small and stable; if anything looks off we drop the value
 * rather than silently returning a half-valid override.
 */
function parseStoredManualLocation(raw: string | null): ManualLocation | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ManualLocation>;
    if (
      typeof parsed.name === 'string' &&
      typeof parsed.lat === 'number' &&
      typeof parsed.lng === 'number' &&
      Number.isFinite(parsed.lat) &&
      Number.isFinite(parsed.lng)
    ) {
      return { name: parsed.name, lat: parsed.lat, lng: parsed.lng };
    }
  } catch {
    // fall through — corrupt JSON treated as "no override"
  }
  return null;
}

export function useLocation(): UseLocationResult {
  const [state, setState] = useState<LocationState>({
    lat: FALLBACK_LAT,
    lng: FALLBACK_LNG,
    source: 'fallback-denied',
    loading: true,
  });

  // `manualOverride` mirrors the persisted SecureStore value. Setting it to
  // a non-null value short-circuits GPS resolution; setting it back to null
  // re-triggers the resolve effect.
  const [manualOverride, setManualOverride] = useState<ManualLocation | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const cancelledRef = useRef(false);

  // Step 1: hydrate manual override from SecureStore on mount before any GPS
  // work runs. This is what makes the override survive cold restarts —
  // without it the GPS effect would race ahead and stomp the persisted value.
  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(MANUAL_LOCATION_KEY)
      .then((raw) => {
        if (cancelled) return;
        const parsed = parseStoredManualLocation(raw);
        if (parsed) {
          setManualOverride(parsed);
          setState({
            lat: parsed.lat,
            lng: parsed.lng,
            source: 'manual',
            name: parsed.name,
            loading: false,
          });
        }
      })
      .catch(() => {
        // SecureStore failures are not user-facing — fall through to GPS.
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Step 2: GPS resolution. Skipped while we're still hydrating SecureStore
  // (so we don't fire two competing setStates) and skipped entirely when
  // a manual override is active (so the user's choice isn't overwritten).
  useEffect(() => {
    if (!hydrated) return;
    if (manualOverride) return;

    cancelledRef.current = false;
    const t0 = Date.now();

    async function resolve() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        console.log(`[location] permission: ${Date.now() - t0}ms`);
        if (cancelledRef.current) return;
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
        if (lastKnown && !cancelledRef.current) {
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
        if (cancelledRef.current) return;
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
        if (cancelledRef.current) return;
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

    // Show the spinner again while we re-resolve after a manual override is
    // cleared — without this the UI would flash the stale manual coordinates
    // until GPS comes back.
    setState((prev) => ({ ...prev, loading: true }));
    resolve();
    return () => {
      cancelledRef.current = true;
    };
  }, [hydrated, manualOverride]);

  const setManualLocation = useCallback(async (loc: ManualLocation) => {
    await SecureStore.setItemAsync(MANUAL_LOCATION_KEY, JSON.stringify(loc));
    setManualOverride(loc);
    setState({
      lat: loc.lat,
      lng: loc.lng,
      source: 'manual',
      name: loc.name,
      loading: false,
    });
  }, []);

  const clearManualLocation = useCallback(async () => {
    await SecureStore.deleteItemAsync(MANUAL_LOCATION_KEY);
    // Setting manualOverride to null re-triggers the GPS resolve effect.
    setManualOverride(null);
  }, []);

  return {
    ...state,
    setManualLocation,
    clearManualLocation,
  };
}
