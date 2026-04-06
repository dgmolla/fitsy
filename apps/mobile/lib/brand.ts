import { TextStyle } from 'react-native';

/**
 * Centralized brand constants.
 * All color, font, and identity references should use these values
 * so changes propagate everywhere.
 */

// ─── Colors ──────────────────────────────────────────────────────────────────

export const COLORS = {
  // Brand green — muted sage, reads well on white
  green: '#2F8F5B',
  greenDark: '#246E47',
  greenLight: '#3DAE6F',
  greenBg: '#EFF6F1',

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
  confHigh: '#2F8F5B',
  confHighBg: '#EFF6F1',
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
