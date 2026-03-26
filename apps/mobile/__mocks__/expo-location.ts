// Auto-mock for expo-location in the Jest environment.
// The real module uses native code; this stub keeps tests pure JS.

export enum PermissionStatus {
  GRANTED = 'granted',
  DENIED = 'denied',
  UNDETERMINED = 'undetermined',
}

export enum Accuracy {
  Lowest = 1,
  Low = 2,
  Balanced = 3,
  High = 4,
  Highest = 5,
  BestForNavigation = 6,
}

export const requestForegroundPermissionsAsync = jest.fn().mockResolvedValue({
  status: PermissionStatus.GRANTED,
});

export const getCurrentPositionAsync = jest.fn().mockResolvedValue({
  coords: {
    latitude: 37.7749,
    longitude: -122.4194,
    accuracy: 10,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
  },
  timestamp: Date.now(),
});
