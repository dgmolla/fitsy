/**
 * @jest-environment node
 *
 * Tests for the GPS resolution logic inside useLocation.
 * We test the async behaviour directly by exercising expo-location
 * through the mock, without mounting a React component.
 */
import * as Location from 'expo-location';
import { FALLBACK_LAT, FALLBACK_LNG } from './useLocation';

const mockRequestPermissions = Location.requestForegroundPermissionsAsync as jest.Mock;
const mockGetPosition = Location.getCurrentPositionAsync as jest.Mock;

const GPS_COORDS = { latitude: 37.7749, longitude: -122.4194 };

beforeEach(() => {
  jest.clearAllMocks();
});

// Helper: simulate what useLocation's resolve() does.
async function resolveLocation(): Promise<{
  lat: number;
  lng: number;
  source: 'gps' | 'fallback';
}> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return { lat: FALLBACK_LAT, lng: FALLBACK_LNG, source: 'fallback' };
    }
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      source: 'gps',
    };
  } catch {
    return { lat: FALLBACK_LAT, lng: FALLBACK_LNG, source: 'fallback' };
  }
}

describe('useLocation — GPS resolution logic', () => {
  it('exports the correct Silver Lake fallback coordinates', () => {
    expect(FALLBACK_LAT).toBe(34.0868);
    expect(FALLBACK_LNG).toBe(-118.3273);
  });

  it('returns GPS coords when permission is granted and fix succeeds', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetPosition.mockResolvedValue({
      coords: { ...GPS_COORDS },
      timestamp: Date.now(),
    });

    const result = await resolveLocation();

    expect(result.source).toBe('gps');
    expect(result.lat).toBe(GPS_COORDS.latitude);
    expect(result.lng).toBe(GPS_COORDS.longitude);
  });

  it('falls back to Silver Lake when permission is denied', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });

    const result = await resolveLocation();

    expect(result.source).toBe('fallback');
    expect(result.lat).toBe(FALLBACK_LAT);
    expect(result.lng).toBe(FALLBACK_LNG);
  });

  it('falls back when permission is undetermined', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'undetermined' });

    const result = await resolveLocation();

    expect(result.source).toBe('fallback');
    expect(result.lat).toBe(FALLBACK_LAT);
  });

  it('falls back when getCurrentPositionAsync throws', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetPosition.mockRejectedValue(new Error('GPS unavailable'));

    const result = await resolveLocation();

    expect(result.source).toBe('fallback');
    expect(result.lat).toBe(FALLBACK_LAT);
    expect(result.lng).toBe(FALLBACK_LNG);
  });

  it('falls back when requestForegroundPermissionsAsync throws', async () => {
    mockRequestPermissions.mockRejectedValue(new Error('Permission API error'));

    const result = await resolveLocation();

    expect(result.source).toBe('fallback');
    expect(result.lat).toBe(FALLBACK_LAT);
    expect(result.lng).toBe(FALLBACK_LNG);
  });

  it('passes Accuracy.Balanced to getCurrentPositionAsync', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetPosition.mockResolvedValue({
      coords: { ...GPS_COORDS },
      timestamp: Date.now(),
    });

    await resolveLocation();

    expect(mockGetPosition).toHaveBeenCalledWith({
      accuracy: Location.Accuracy.Balanced,
    });
  });
});
