import React, { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';

export interface ThemeColors {
  // Backgrounds
  bg: string;
  bgCard: string;
  bgElevated: string;
  // Text
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  // Accent — always bright green, both modes
  accent: string;
  accentBg: string;
  accentBorder: string;
  accentOnAccent: string;
  // Input
  inputBg: string;
  inputBorder: string;
  inputText: string;
  inputPlaceholder: string;
  // Border
  border: string;
  borderSubtle: string;
  // Error
  error: string;
  errorBg: string;
  errorBorder: string;
  // Warning
  warning: string;
  warningBorder: string;
  warningBg: string;
  // Misc
  tabBarBg: string;
  spinnerColor: string;
  // Glass
  glassBg: string;
  glassBorder: string;
  glassShadowColor: string;
  glassShadowOpacity: number;
  glassShadowRadius: number;
  // Background gradient
  bgGradient: [string, string];
}

// Stitch dark palette: "The Kinetic Monolith"
const darkColors: ThemeColors = {
  bg: '#0A0E14',
  bgCard: 'rgba(255,255,255,0.12)',
  bgElevated: 'rgba(255,255,255,0.15)',
  textPrimary: '#F1F3FC',
  textSecondary: 'rgba(255,255,255,0.65)',
  textTertiary: 'rgba(255,255,255,0.35)',
  accent: '#22C55E',
  accentBg: 'rgba(74,222,128,0.12)',
  accentBorder: 'rgba(74,222,128,0.25)',
  accentOnAccent: '#0A0E14',
  inputBg: 'rgba(255,255,255,0.10)',
  inputBorder: 'rgba(255,255,255,0.15)',
  inputText: '#F1F3FC',
  inputPlaceholder: 'rgba(255,255,255,0.25)',
  border: 'rgba(255,255,255,0.12)',
  borderSubtle: 'rgba(255,255,255,0.08)',
  error: '#F87171',
  errorBg: 'rgba(248,113,113,0.12)',
  errorBorder: 'rgba(248,113,113,0.25)',
  warning: '#FCD34D',
  warningBorder: 'rgba(252,211,77,0.3)',
  warningBg: 'rgba(252,211,77,0.10)',
  tabBarBg: 'rgba(10,14,20,0.92)',
  spinnerColor: '#22C55E',
  glassBg: 'rgba(255,255,255,0.06)',
  glassBorder: 'rgba(68,72,79,0.25)',
  glassShadowColor: '#000',
  glassShadowOpacity: 0.45,
  glassShadowRadius: 24,
  bgGradient: ['#0A0E14', '#0A0E14'] as [string, string],
};

// Stitch light palette: surface #F8FAFC, on-surface #1E293B, outline-variant #E2E8F0
const lightColors: ThemeColors = {
  bg: '#F8FAFC',
  bgCard: 'rgba(255,255,255,0.7)',
  bgElevated: 'rgba(255,255,255,0.55)',
  textPrimary: '#1E293B',
  textSecondary: '#64748B',
  textTertiary: '#94A3B8',
  accent: '#22C55E',
  accentBg: 'rgba(34,197,94,0.05)',
  accentBorder: 'rgba(34,197,94,0.20)',
  accentOnAccent: '#FFFFFF',
  inputBg: 'rgba(255,255,255,0.70)',
  inputBorder: '#E2E8F0',
  inputText: '#1E293B',
  inputPlaceholder: '#94A3B8',
  border: '#E2E8F0',
  borderSubtle: 'rgba(226,232,240,0.5)',
  error: '#DC2626',
  errorBg: 'rgba(220,38,38,0.08)',
  errorBorder: 'rgba(220,38,38,0.15)',
  warning: '#D97706',
  warningBorder: 'rgba(217,119,6,0.25)',
  warningBg: 'rgba(217,119,6,0.07)',
  tabBarBg: 'rgba(248,250,252,0.85)',
  spinnerColor: '#22C55E',
  glassBg: 'rgba(255,255,255,0.7)',
  glassBorder: 'rgba(226,232,240,0.8)',
  glassShadowColor: '#000',
  glassShadowOpacity: 0.06,
  glassShadowRadius: 16,
  bgGradient: ['#F8FAFC', '#F8FAFC'] as [string, string],
};

type ThemeMode = 'light' | 'dark';

interface ThemeContextValue {
  colors: ThemeColors;
  mode: ThemeMode;
}

const ThemeContext = createContext<ThemeContextValue>({
  colors: lightColors,
  mode: 'light',
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const mode: ThemeMode = systemScheme === 'dark' ? 'dark' : 'light';

  const colors = mode === 'dark' ? darkColors : lightColors;

  return (
    <ThemeContext.Provider value={{ colors, mode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
