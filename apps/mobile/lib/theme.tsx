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
  // Background gradient
  bgGradient: [string, string];
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
  bgGradient: ['#0A0E14', '#111820'] as [string, string],
};

// Editorial cream light palette — matches search screen (S-91) and design system
const lightColors: ThemeColors = {
  bg: '#FDFBF7',
  bgCard: '#F5EFE8',
  bgElevated: '#EDE6DE',
  textPrimary: '#0F1F15',
  textSecondary: '#3A4F41',
  textTertiary: '#7A8C7E',
  accent: '#1B3A26',
  accentBg: '#EFF6F1',
  accentBorder: 'rgba(27,58,38,0.18)',
  accentOnAccent: '#FDFBF7',
  inputBg: '#F5EFE8',
  inputBorder: '#E8E2D8',
  inputText: '#0F1F15',
  inputPlaceholder: '#7A8C7E',
  border: '#E8E2D8',
  borderSubtle: '#EDE6DE',
  error: '#DC2626',
  errorBg: 'rgba(220,38,38,0.08)',
  errorBorder: 'rgba(220,38,38,0.15)',
  warning: '#D97706',
  warningBorder: 'rgba(217,119,6,0.25)',
  warningBg: 'rgba(217,119,6,0.07)',
  tabBarBg: '#FDFBF7',
  spinnerColor: '#1B3A26',
  glassShadowColor: '#1B3A26',
  glassShadowOpacity: 0.06,
  glassShadowRadius: 16,
  bgGradient: ['#FDFBF7', '#F5EFE8'] as [string, string],
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
