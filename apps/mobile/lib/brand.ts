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
  frauncesDisplay: 'FrauncesDisplayWonk',
  /** Heavier display cut (opsz=144, wght=600) — use on dark/photo overlays. */
  frauncesDisplayBold: 'FrauncesDisplayWonkBold',
  // Static Light/Regular cuts. RN can't read the variable `opsz` axis, so the
  // DisplayRegular file falls back to the chunky body cut at headline sizes.
  // These static instances render predictably thin.
  frauncesLight: 'Fraunces-Light',
  frauncesLightItalic: 'Fraunces-LightItalic',
  frauncesRegular: 'Fraunces-Regular',
  frauncesMedium: 'Fraunces-Medium',
  frauncesSemiBold: 'Fraunces-SemiBold',
  // Body serif — kept for any non-headline serif text and italic accents.
  newsreaderItalic: 'Newsreader-Italic',
  newsreaderRegular: 'Newsreader-Regular',
  // Body sans — matches the webapp's Nunito Sans voice (subtitles, body copy).
  nunitoSans: 'NunitoSans-Regular',
  nunitoSansSemiBold: 'NunitoSans-SemiBold',
} as const;

// ─── Text Styles ─────────────────────────────────────────────────────────────
// Centralized typographic tokens. Anchor for all onboarding/marketing surfaces
// so changes propagate. Mirror the webapp pairing (Fraunces display for hero
// headlines, Nunito Sans for body voice).

export const TEXT = {
  /** Onboarding hero headlines. Fraunces display cut, baked at opsz=144 wght=450 WONK=1. */
  headline: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 32,
    color: EDITORIAL.green,
    letterSpacing: -1,
    lineHeight: 38,
  },
  /** Mid-size editorial title (e.g. inner-card titles, sheet headers). */
  title: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 24,
    color: EDITORIAL.green,
    letterSpacing: -0.6,
    lineHeight: 28,
  },
  /** Subtitle directly under a headline. */
  subtitle: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 16,
    color: EDITORIAL.textMid,
    lineHeight: 24,
  },
  /** Default body copy. */
  body: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 15,
    color: EDITORIAL.textMid,
    lineHeight: 22,
  },
  /** Smaller body / supporting copy. */
  bodySmall: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 13,
    color: EDITORIAL.textMid,
    lineHeight: 18,
  },
  /** Selectable option labels (e.g. onboarding choice pills). */
  optionLabel: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 16,
    color: EDITORIAL.textMid,
    letterSpacing: -0.2,
  },
  /** Card / list-item title (lighter than headline, still serif). */
  cardTitle: {
    fontFamily: FONTS.frauncesSemiBold,
    fontSize: 17,
    color: EDITORIAL.cream,
    letterSpacing: -0.3,
  },
  /** Card / list-item supporting meta line. */
  cardMeta: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 11,
  },
  /** Eyebrow / numeric index caption. */
  caption: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  /** Primary CTA button label. */
  cta: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 15,
    color: EDITORIAL.cream,
  },
} as const satisfies Record<string, TextStyle>;

// ─── Brand Identity ──────────────────────────────────────────────────────────

export const BRAND = {
  name: 'fitsy',
  tagline: 'Find restaurants that fit your fitness goals',
  color: COLORS.green,
  letterSpacing: -1,
  fontWeight: '800' as TextStyle['fontWeight'],
} as const;
