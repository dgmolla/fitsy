# GPS Integration Spec — S-54

**Status**: Approved
**Owner**: Frontend Engineer
**Sprint**: S-54
**Last updated**: 2026-03-25

---

## Summary

Replace the hardcoded Silver Lake coordinates in the search screen and API
client with real device GPS via `expo-location`. When the user grants
permission, the search uses their current position. When denied or unavailable,
it silently falls back to the Silver Lake defaults and shows a subtle indicator
so the user knows searches are not location-aware.

---

## Goals

- Use device GPS for restaurant proximity searches when available.
- Degrade gracefully when location permission is denied or the GPS fix fails.
- Display a clear (but non-intrusive) label indicating whether the app is using
  real GPS or the Silver Lake fallback.
- Keep the change fully contained to `apps/mobile/` (frontend domain).

## Non-goals

- Geocoding / reverse-geocoding the display name (out of scope for S-54).
- Background location or location updates while the app is backgrounded.
- Changing the API contract — `lat`/`lng` query params already exist.

---

## GPS Request Flow

```mermaid
flowchart TD
    A[SearchScreen mounts] --> B[Request foreground location permission]
    B --> C{Permission granted?}
    C -- Yes --> D[getCurrentPositionAsync]
    D --> E{GPS fix succeeded?}
    E -- Yes --> F[Use real coords\nlat, lng]
    E -- No / Timeout --> G[Use fallback coords\nSilver Lake 34.0868, -118.3273]
    C -- No --> G
    F --> H[setCoords state]
    G --> H
    H --> I[locationSource: 'gps' | 'fallback']
    I --> J[doFetch called with coords]
    J --> K[fetchRestaurants API call]
    I --> L{locationSource == 'fallback'?}
    L -- Yes --> M[Show fallback indicator\nin location bar]
    L -- No --> N[Show GPS coords label]
```

---

## Implementation Plan

### 1. Install `expo-location`

`expo-location` is not yet in `apps/mobile/package.json`. Install via:

```bash
npx expo install expo-location
```

The `expo install` command ensures the version is compatible with the installed
Expo SDK.

### 2. Permissions config — `apps/mobile/app.config.ts`

Add the `expo-location` plugin with permission strings for iOS and Android:

```ts
plugins: [
  "expo-router",
  [
    "expo-location",
    {
      locationWhenInUsePermission: "Fitsy uses your location to find restaurants near you.",
    },
  ],
],
```

iOS reads `NSLocationWhenInUseUsageDescription` from
`infoPlist`; the plugin handles that automatically.
Android adds `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` to the
manifest.

### 3. `useLocation` hook — `apps/mobile/lib/useLocation.ts`

Extract GPS logic into a reusable hook so the search screen stays under 200
lines.

**Interface:**

```ts
export type LocationSource = 'gps' | 'fallback';

export interface LocationState {
  lat: number;
  lng: number;
  source: LocationSource;
  loading: boolean;
}
```

**Behaviour:**
1. On mount, call `Location.requestForegroundPermissionsAsync()`.
2. If granted, call `Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })`.
3. On success, resolve to `{ lat, lng, source: 'gps' }`.
4. On any failure (denied, timeout, error), resolve to Silver Lake fallback.

### 4. Update `apps/mobile/app/(tabs)/search.tsx`

- Import and call `useLocation()`.
- Pass `{ lat, lng }` from the hook to `fetchRestaurants`.
- Update the location bar label:
  - GPS available: `"Searching near your location"`
  - Fallback: `"Searching near Silver Lake, LA"` with a subtle tint change or
    prefix to indicate the location is approximate.
- Block the initial fetch until `locationLoading` is false (avoids a fetch
  with stale coords immediately followed by another with real ones).

### 5. Tests — `apps/mobile/lib/useLocation.test.ts`

Mock `expo-location` and verify:
- Returns GPS coords when permission is granted and fix succeeds.
- Returns fallback coords when permission is denied.
- Returns fallback coords when `getCurrentPositionAsync` throws.
- `loading` transitions correctly.

---

## Fallback Coordinates

| Constant | Value |
|----------|-------|
| `FALLBACK_LAT` | `34.0868` |
| `FALLBACK_LNG` | `-118.3273` |
| Location name | Silver Lake, Los Angeles, CA |

---

## Accessibility

- Location bar text has sufficient colour contrast (≥ 4.5:1).
- Fallback indicator uses an `accessibilityLabel` that communicates the
  approximate nature of the search.

---

## Risks

| Risk | Mitigation |
|------|------------|
| GPS cold-start latency | `Accuracy.Balanced` trades precision for speed; typical fix < 2 s |
| Expo Go vs production build permissions | Test on both; `expo-location` works in Expo Go |
| User denies permission mid-session | Hook only requests once on mount; denial → fallback |
