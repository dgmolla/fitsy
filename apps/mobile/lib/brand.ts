import { TextStyle } from 'react-native';

/**
 * Shared brand constants for the "fitsy" wordmark.
 * All logo/wordmark references should use these values
 * so changes propagate everywhere.
 */
export const BRAND = {
  name: 'fitsy',
  tagline: 'Find restaurants that fit your fitness goals',
  color: '#2D7D46',
  letterSpacing: -1,
  fontWeight: '800' as TextStyle['fontWeight'],
} as const;
