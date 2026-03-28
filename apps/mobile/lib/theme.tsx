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
  // Accent
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
  glassShadowColor: string;
  glassShadowOpacity: number;
  glassShadowRadius: number;
}

const darkColors: ThemeColors = {
  bg: '#0A0E14',
  bgCard: 'rgba(255,255,255,0.12)',
  bgElevated: 'rgba(255,255,255,0.15)',
  textPrimary: '#F1F3FC',
  textSecondary: 'rgba(255,255,255,0.65)',
  textTertiary: 'rgba(255,255,255,0.35)',
  accent: '#4ADE80',
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
  spinnerColor: '#4ADE80',
  glassShadowColor: '#000',
  glassShadowOpacity: 0.45,
  glassShadowRadius: 24,
};

const lightColors: ThemeColors = {
  bg: '#F6F5F3',
  bgCard: 'rgba(255,255,255,0.72)',
  bgElevated: 'rgba(255,255,255,0.55)',
  textPrimary: '#141414',
  textSecondary: 'rgba(0,0,0,0.52)',
  textTertiary: 'rgba(0,0,0,0.32)',
  accent: '#2D7D46',
  accentBg: 'rgba(45,125,70,0.07)',
  accentBorder: 'rgba(45,125,70,0.18)',
  accentOnAccent: '#FFFFFF',
  inputBg: 'rgba(255,255,255,0.70)',
  inputBorder: 'rgba(0,0,0,0.07)',
  inputText: '#141414',
  inputPlaceholder: 'rgba(0,0,0,0.22)',
  border: 'rgba(0,0,0,0.06)',
  borderSubtle: 'rgba(0,0,0,0.04)',
  error: '#DC2626',
  errorBg: 'rgba(220,38,38,0.08)',
  errorBorder: 'rgba(220,38,38,0.15)',
  warning: '#D97706',
  warningBorder: 'rgba(217,119,6,0.25)',
  warningBg: 'rgba(217,119,6,0.07)',
  tabBarBg: 'rgba(255,255,255,0.82)',
  spinnerColor: '#2D7D46',
  glassShadowColor: '#000',
  glassShadowOpacity: 0.08,
  glassShadowRadius: 20,
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
