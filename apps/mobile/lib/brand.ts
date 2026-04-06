import { TextStyle } from 'react-native';

/**
 * Centralized brand constants.
 * All color, font, and identity references should use these values
 * so changes propagate everywhere.
 */

// ─── Colors ──────────────────────────────────────────────────────────────────

export const COLORS = {
  // Brand green — primary accent
  green: '#22C55E',
  greenDark: '#16A34A',
  greenLight: '#4ADE80',
  greenBg: '#F0FDF4',

  // Neutrals
  white: '#FFFFFF',
  black: '#000000',
  text: '#111827',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',
  textDisabled: '#D1D5DB',

  // Borders & backgrounds
  border: '#E5E7EB',
  borderLight: '#F3F4F6',
  bgCard: '#F9FAFB',

  // Semantic
  error: '#DC2626',
  errorBg: '#FEF2F2',
  warning: '#F59E0B',
  warningBg: '#FFFBEB',

  // Confidence badges
  confHigh: '#22C55E',
  confHighBg: '#F0FDF4',
  confMedium: '#F59E0B',
  confMediumBg: '#FFFBEB',
  confLow: '#9CA3AF',
  confLowBg: '#F3F4F6',
} as const;

// ─── Fonts ───────────────────────────────────────────────────────────────────

export const FONTS = {
  headline: 'PlayfairDisplay-BoldItalic',
  body: 'Manrope-Bold',
  accent: 'Caslon540Italic',
  // System font is used for everything else (no fontFamily needed)
} as const;

// ─── Brand Identity ──────────────────────────────────────────────────────────

export const BRAND = {
  name: 'fitsy',
  tagline: 'Find restaurants that fit your fitness goals',
  color: COLORS.green,
  letterSpacing: -1,
  fontWeight: '800' as TextStyle['fontWeight'],
} as const;
