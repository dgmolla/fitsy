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

// ─── Editorial Cream Palette ─────────────────────────────────────────────────
// Used by search screen and downstream screens (S-91, S-92, S-93).

export const EDITORIAL = {
  // Backgrounds
  cream:     '#FDFBF7',
  creamCard: '#F5EFE8',
  creamDeep: '#EDE6DE',
  // Text
  green:     '#1B3A26',
  greenMid:  '#2A5438',
  greenAccent:'#3A7050',
  text:      '#0F1F15',
  textMid:   '#3A4F41',
  textSoft:  '#7A8C7E',
  // Borders
  border:    '#E8E2D8',
  // Gradients (on hero/cards)
  heroGrad:  'rgba(20,44,28,0.95)' as string,
  cardGrad:  'rgba(20,44,28,0.88)' as string,
  // Alpha-tinted accents — used for subtle washes on cream and dark surfaces.
  greenAccentTint: 'rgba(58,112,80,0.12)' as string,   // greenAccent @ 12% — badge wash on cream
  whiteTintLow:    'rgba(255,255,255,0.12)' as string, // white @ 12% — button on dark sort bar
} as const;

// ─── Fonts ───────────────────────────────────────────────────────────────────
// Aligned with the webapp font stack (apps/api/app/layout.tsx):
// Fraunces is the display/headline serif, Newsreader regular/italic carry the
// body-weight serif voice. System font handles everything else (no fontFamily
// needed).

export const FONTS = {
  // Display / headline — replaces former `newsreaderBold` and `headline`
  // (PlayfairDisplay-BoldItalic), so existing 28pt+ marquee titles resolve
  // to the webapp's Fraunces 700 with optical-size axis at the load step.
  frauncesBold: 'Fraunces-Bold',
  frauncesBoldItalic: 'Fraunces-BoldItalic',
  // Display cut — Fraunces variable instanced with opsz=144 + wght=400 baked
  // in. Use for hero/marquee titles to match the webapp's elegant headline
  // style (font-weight: 400 + opsz=auto in apps/api/app/landing.module.css).
  frauncesDisplay: 'Fraunces-DisplayRegular',
  // Body serif — kept for any non-headline serif text and italic accents.
  newsreaderItalic: 'Newsreader-Italic',
  newsreaderRegular: 'Newsreader-Regular',
} as const;

// ─── Brand Identity ──────────────────────────────────────────────────────────

export const BRAND = {
  name: 'fitsy',
  tagline: 'Find restaurants that fit your fitness goals',
  color: COLORS.green,
  letterSpacing: -1,
  fontWeight: '800' as TextStyle['fontWeight'],
} as const;
