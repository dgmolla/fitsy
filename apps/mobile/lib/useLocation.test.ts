/**
 * Tests for the useLocation hook.
 *
 * Uses renderHook from @testing-library/react-native to exercise the real
 * hook lifecycle (mount → effect → state updates) against the expo-location
 * mock, covering GPS success, permission denied, fallback coordinates, and
 * loading state transitions.
 */
import { renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { FALLBACK_LAT, FALLBACK_LNG, useLocation } from './useLocation';

const mockRequestPermissions = Location.requestForegroundPermissionsAsync as jest.Mock;
const mockGetPosition = Location.getCurrentPositionAsync as jest.Mock;

const GPS_COORDS = { latitude: 37.7749, longitude: -122.4194 };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useLocation', () => {
  it('exports the correct Silver Lake fallback coordinates', () => {
    expect(FALLBACK_LAT).toBe(34.0868);
    expect(FALLBACK_LNG).toBe(-118.3273);
  });

  it('starts in loading state with fallback coordinates', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetPosition.mockResolvedValue({
      coords: { ...GPS_COORDS },
      timestamp: Date.now(),
    });

    const { result, unmount } = renderHook(() => useLocation());

    // Synchronously check the initial state before any async resolution.
    expect(result.current.loading).toBe(true);
    expect(result.current.lat).toBe(FALLBACK_LAT);
    expect(result.current.lng).toBe(FALLBACK_LNG);
    expect(result.current.source).toBe('fallback');

    // Unmount then drain pending microtasks so the cancelled effect does not
    // trigger an out-of-act setState warning on the unmounted component.
    unmount();
    await waitFor(() => undefined);
  });

  it('resolves GPS coordinates when permission is granted', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetPosition.mockResolvedValue({
      coords: { ...GPS_COORDS },
      timestamp: Date.now(),
    });

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.source).toBe('gps');
    expect(result.current.lat).toBe(GPS_COORDS.latitude);
    expect(result.current.lng).toBe(GPS_COORDS.longitude);
  });

  it('falls back to Silver Lake when permission is denied', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.source).toBe('fallback');
    expect(result.current.lat).toBe(FALLBACK_LAT);
    expect(result.current.lng).toBe(FALLBACK_LNG);
  });

  it('falls back when getCurrentPositionAsync throws', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetPosition.mockRejectedValue(new Error('GPS unavailable'));

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.source).toBe('fallback');
    expect(result.current.lat).toBe(FALLBACK_LAT);
    expect(result.current.lng).toBe(FALLBACK_LNG);
  });

  it('falls back when requestForegroundPermissionsAsync throws', async () => {
    mockRequestPermissions.mockRejectedValue(new Error('Permission API error'));

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.source).toBe('fallback');
    expect(result.current.lat).toBe(FALLBACK_LAT);
    expect(result.current.lng).toBe(FALLBACK_LNG);
  });

  it('passes Accuracy.Balanced to getCurrentPositionAsync', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetPosition.mockResolvedValue({
      coords: { ...GPS_COORDS },
      timestamp: Date.now(),
    });

    const { result } = renderHook(() => useLocation());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetPosition).toHaveBeenCalledWith({
      accuracy: Location.Accuracy.Balanced,
    });
  });
});
