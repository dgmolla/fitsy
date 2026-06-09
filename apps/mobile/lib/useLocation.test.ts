/**
 * Tests for the useLocation hook.
 *
 * Uses renderHook from @testing-library/react-native to exercise the real
 * hook lifecycle (mount → effect → state updates) against the expo-location
 * mock, covering GPS success, the three fallback variants (denied, timeout,
 * error), manual override hydration / set / clear (S-227), and loading
 * state transitions. PostHog tracker calls are asserted via the mocked
 * `@/lib/analytics` module.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import {
  FALLBACK_LAT,
  FALLBACK_LNG,
  MANUAL_LOCATION_KEY,
  useLocation,
} from './useLocation';
import {
  trackLocationError,
  trackLocationPermissionDenied,
  trackLocationTimeout,
} from './analytics';

jest.mock('./analytics', () => ({
  trackLocationPermissionDenied: jest.fn(),
  trackLocationTimeout: jest.fn(),
  trackLocationError: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

const SecureStore = jest.requireMock('expo-secure-store') as {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
};

const mockRequestPermissions = Location.requestForegroundPermissionsAsync as jest.Mock;
const mockGetPosition = Location.getCurrentPositionAsync as jest.Mock;
const mockGetLastKnown = Location.getLastKnownPositionAsync as jest.Mock;

const GPS_COORDS = { latitude: 37.7749, longitude: -122.4194 };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLastKnown.mockResolvedValue(null);
  SecureStore.getItemAsync.mockResolvedValue(null);
  SecureStore.setItemAsync.mockResolvedValue(undefined);
  SecureStore.deleteItemAsync.mockResolvedValue(undefined);
});

describe('useLocation', () => {
  it('exports the correct Silver Lake fallback coordinates', () => {
    expect(FALLBACK_LAT).toBe(34.0868);
    expect(FALLBACK_LNG).toBe(-118.3273);
  });

  it('starts with fallback coordinates and loading=true synchronously', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetPosition.mockResolvedValue({
      coords: { ...GPS_COORDS },
      timestamp: Date.now(),
    });

    const { result, unmount } = renderHook(() => useLocation());

    // Initial render: loading=true, fallback coords. Source defaults to
    // 'fallback-denied' as the eventual deny-equivalent — overwritten as soon
    // as resolution finishes; we don't expose a transient 'pending' value.
    expect(result.current.loading).toBe(true);
    expect(result.current.lat).toBe(FALLBACK_LAT);
    expect(result.current.lng).toBe(FALLBACK_LNG);
    expect(result.current.source).toBe('fallback-denied');

    // Drain pending microtasks before unmount so the cancelled effect does
    // not trigger an out-of-act setState warning.
    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();
  });

  it('resolves GPS coordinates when permission is granted and lastKnown hits', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetLastKnown.mockResolvedValue({
      coords: { ...GPS_COORDS },
      timestamp: Date.now(),
    });

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.source).toBe('gps');
    });

    expect(result.current.lat).toBe(GPS_COORDS.latitude);
    expect(result.current.lng).toBe(GPS_COORDS.longitude);
    expect(mockGetPosition).not.toHaveBeenCalled();
  });

  it('resolves GPS coordinates from fresh getCurrentPosition when no lastKnown', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetLastKnown.mockResolvedValue(null);
    mockGetPosition.mockResolvedValue({
      coords: { ...GPS_COORDS },
      timestamp: Date.now(),
    });

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.source).toBe('gps');
    });

    expect(result.current.lat).toBe(GPS_COORDS.latitude);
    expect(result.current.lng).toBe(GPS_COORDS.longitude);
  });

  it('falls back to Silver Lake (denied) when permission is denied', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.source).toBe('fallback-denied');
    expect(result.current.lat).toBe(FALLBACK_LAT);
    expect(result.current.lng).toBe(FALLBACK_LNG);
    expect(trackLocationPermissionDenied).toHaveBeenCalledWith({ had_last_known: false });
    expect(trackLocationTimeout).not.toHaveBeenCalled();
    expect(trackLocationError).not.toHaveBeenCalled();
  });

  it('falls back to Silver Lake (timeout) when fresh GPS exceeds 3s', async () => {
    jest.useFakeTimers();
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetLastKnown.mockResolvedValue(null);
    // Position never resolves — timeout race wins.
    mockGetPosition.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useLocation());

    // Flush SecureStore hydration + permission + lastKnown promises so the
    // GPS-vs-setTimeout race is actually armed before we advance the clock.
    // Without this, the 3001ms advance happens before the setTimeout(3000)
    // is installed, and the test sees 'fallback-denied' from the initial state.
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(3001);
    jest.useRealTimers();

    await waitFor(() => {
      expect(result.current.source).toBe('fallback-timeout');
    });

    expect(result.current.lat).toBe(FALLBACK_LAT);
    expect(result.current.lng).toBe(FALLBACK_LNG);
    expect(trackLocationTimeout).toHaveBeenCalledWith({ had_last_known: false });
    expect(trackLocationPermissionDenied).not.toHaveBeenCalled();
    expect(trackLocationError).not.toHaveBeenCalled();
  });

  it('falls back to Silver Lake (error) when getCurrentPositionAsync throws', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetLastKnown.mockResolvedValue(null);
    mockGetPosition.mockRejectedValue(new Error('GPS unavailable'));

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.source).toBe('fallback-error');
    });

    expect(result.current.lat).toBe(FALLBACK_LAT);
    expect(result.current.lng).toBe(FALLBACK_LNG);
    expect(trackLocationError).toHaveBeenCalledWith({ error_message: 'GPS unavailable' });
    expect(trackLocationPermissionDenied).not.toHaveBeenCalled();
    expect(trackLocationTimeout).not.toHaveBeenCalled();
  });

  it('falls back to Silver Lake (error) when requestForegroundPermissionsAsync throws', async () => {
    mockRequestPermissions.mockRejectedValue(new Error('Permission API error'));

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.source).toBe('fallback-error');
    });

    expect(result.current.lat).toBe(FALLBACK_LAT);
    expect(result.current.lng).toBe(FALLBACK_LNG);
    expect(trackLocationError).toHaveBeenCalledWith({ error_message: 'Permission API error' });
  });

  it('passes Accuracy.Balanced to getCurrentPositionAsync', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetLastKnown.mockResolvedValue(null);
    mockGetPosition.mockResolvedValue({
      coords: { ...GPS_COORDS },
      timestamp: Date.now(),
    });

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.source).toBe('gps');
    });

    expect(mockGetPosition).toHaveBeenCalledWith({
      accuracy: Location.Accuracy.Balanced,
    });
  });

  // ─── Manual override (S-227) ───────────────────────────────────────────────
  // Three behaviors to lock in: (1) a persisted override hydrates on cold
  // start and short-circuits GPS; (2) setManualLocation writes to SecureStore
  // and updates state immediately; (3) clearManualLocation deletes from
  // SecureStore and re-runs GPS.

  it('hydrates manual override from SecureStore on mount and skips GPS', async () => {
    SecureStore.getItemAsync.mockResolvedValue(
      JSON.stringify({ name: 'Hollywood', lat: 34.0928, lng: -118.3287 }),
    );
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.source).toBe('manual');
    });

    expect(result.current.lat).toBe(34.0928);
    expect(result.current.lng).toBe(-118.3287);
    expect(result.current.name).toBe('Hollywood');
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith(MANUAL_LOCATION_KEY);
    // GPS path must not run while a manual override is active.
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it('ignores corrupt SecureStore payloads and falls through to GPS', async () => {
    SecureStore.getItemAsync.mockResolvedValue('not-json{');
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetPosition.mockResolvedValue({
      coords: { ...GPS_COORDS },
      timestamp: Date.now(),
    });

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.source).toBe('gps');
    });
  });

  it('setManualLocation persists the override and switches state to manual', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetPosition.mockResolvedValue({
      coords: { ...GPS_COORDS },
      timestamp: Date.now(),
    });

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.source).toBe('gps');
    });

    await act(async () => {
      await result.current.setManualLocation({
        name: 'Echo Park',
        lat: 34.0782,
        lng: -118.2606,
      });
    });

    expect(result.current.source).toBe('manual');
    expect(result.current.name).toBe('Echo Park');
    expect(result.current.lat).toBe(34.0782);
    expect(result.current.lng).toBe(-118.2606);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      MANUAL_LOCATION_KEY,
      JSON.stringify({ name: 'Echo Park', lat: 34.0782, lng: -118.2606 }),
    );
  });

  it('clearManualLocation deletes the override and re-runs GPS', async () => {
    SecureStore.getItemAsync.mockResolvedValue(
      JSON.stringify({ name: 'Hollywood', lat: 34.0928, lng: -118.3287 }),
    );
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetPosition.mockResolvedValue({
      coords: { ...GPS_COORDS },
      timestamp: Date.now(),
    });

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.source).toBe('manual');
    });

    await act(async () => {
      await result.current.clearManualLocation();
    });

    await waitFor(() => {
      expect(result.current.source).toBe('gps');
    });

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(MANUAL_LOCATION_KEY);
    expect(mockRequestPermissions).toHaveBeenCalled();
  });

  // ─── refreshLocation (pull-to-refresh) ─────────────────────────────────────
  // Four behaviors: (1) a fresh fix replaces the current coordinates and
  // returns the applied state, deliberately skipping the lastKnown shortcut
  // the mount path uses; (2) a manual override makes it a no-op; (3) a
  // transient timeout returns null and keeps the current coordinates rather
  // than bouncing to the fallback; (4) a hard permission denial applies the
  // fallback.

  it('refreshLocation acquires a fresh fix, skips lastKnown, and applies it', async () => {
    // Mount via a lastKnown hit so getCurrentPositionAsync is untouched until
    // refresh — lets us assert the refresh path reads the *fresh* position.
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetLastKnown.mockResolvedValue({
      coords: { ...GPS_COORDS },
      timestamp: Date.now(),
    });

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.source).toBe('gps');
    });

    const FRESH = { latitude: 40.7128, longitude: -74.006 };
    mockGetLastKnown.mockClear();
    mockGetPosition.mockResolvedValue({ coords: { ...FRESH }, timestamp: Date.now() });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.refreshLocation();
    });

    expect(returned).toEqual({
      lat: FRESH.latitude,
      lng: FRESH.longitude,
      source: 'gps',
      loading: false,
    });
    expect(result.current.lat).toBe(FRESH.latitude);
    expect(result.current.lng).toBe(FRESH.longitude);
    // Refresh wants a current fix — it must NOT take the lastKnown shortcut.
    expect(mockGetLastKnown).not.toHaveBeenCalled();
    expect(mockGetPosition).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Balanced });
  });

  it('refreshLocation is a no-op when a manual override is active', async () => {
    SecureStore.getItemAsync.mockResolvedValue(
      JSON.stringify({ name: 'Hollywood', lat: 34.0928, lng: -118.3287 }),
    );
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.source).toBe('manual');
    });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.refreshLocation();
    });

    expect(returned).toBeNull();
    // Manual coords untouched, GPS path never engaged.
    expect(result.current.source).toBe('manual');
    expect(result.current.lat).toBe(34.0928);
    expect(result.current.lng).toBe(-118.3287);
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockGetPosition).not.toHaveBeenCalled();
  });

  it('refreshLocation returns null and keeps current coords on timeout', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetLastKnown.mockResolvedValue({
      coords: { ...GPS_COORDS },
      timestamp: Date.now(),
    });

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.source).toBe('gps');
    });

    // Fresh position never resolves — the 3s timeout race wins.
    jest.useFakeTimers();
    mockGetPosition.mockReturnValue(new Promise(() => {}));

    let refreshPromise: Promise<unknown>;
    await act(async () => {
      refreshPromise = result.current.refreshLocation();
      // Flush the permission promise so the timeout race is armed before we
      // advance the clock.
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(3001);
    });
    jest.useRealTimers();

    await expect(refreshPromise!).resolves.toBeNull();
    // Coordinates from before the refresh are preserved.
    expect(result.current.source).toBe('gps');
    expect(result.current.lat).toBe(GPS_COORDS.latitude);
    expect(result.current.lng).toBe(GPS_COORDS.longitude);
    expect(trackLocationTimeout).toHaveBeenCalledWith({ had_last_known: false });
  });

  it('refreshLocation applies the denied fallback when permission is denied', async () => {
    // Mount in a manual override so the initial render doesn't trip the deny
    // path; then clear it isn't needed — instead mount via GPS granted, then
    // flip permissions to denied for the refresh call.
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetLastKnown.mockResolvedValue({
      coords: { ...GPS_COORDS },
      timestamp: Date.now(),
    });

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.source).toBe('gps');
    });

    mockRequestPermissions.mockResolvedValue({ status: 'denied' });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.refreshLocation();
    });

    expect(returned).toEqual({
      lat: FALLBACK_LAT,
      lng: FALLBACK_LNG,
      source: 'fallback-denied',
      loading: false,
    });
    expect(result.current.source).toBe('fallback-denied');
    expect(trackLocationPermissionDenied).toHaveBeenCalledWith({ had_last_known: false });
  });
});
