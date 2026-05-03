/**
 * Tests for the useLocation hook.
 *
 * Uses renderHook from @testing-library/react-native to exercise the real
 * hook lifecycle (mount → effect → state updates) against the expo-location
 * mock, covering GPS success, the three fallback variants (denied, timeout,
 * error), and loading state transitions. PostHog tracker calls are asserted
 * via the mocked `@/lib/analytics` module.
 */
import { renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { FALLBACK_LAT, FALLBACK_LNG, useLocation } from './useLocation';
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

const mockRequestPermissions = Location.requestForegroundPermissionsAsync as jest.Mock;
const mockGetPosition = Location.getCurrentPositionAsync as jest.Mock;
const mockGetLastKnown = Location.getLastKnownPositionAsync as jest.Mock;

const GPS_COORDS = { latitude: 37.7749, longitude: -122.4194 };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLastKnown.mockResolvedValue(null);
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

    // Advance past the 3000ms timeout.
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
});
