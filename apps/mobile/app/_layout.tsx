import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { PostHogProvider } from 'posthog-react-native';
import { ThemeProvider } from '@/lib/theme';
import { getPostHogClient } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import {
  trackSessionRefreshed,
  trackSessionRefreshFailed,
} from '@/lib/analytics';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    // Display / headline serif — matches the webapp's Fraunces 700.
    'Fraunces-Bold': require('@expo-google-fonts/fraunces/700Bold/Fraunces_700Bold.ttf'),
    'Fraunces-BoldItalic': require('@expo-google-fonts/fraunces/700Bold_Italic/Fraunces_700Bold_Italic.ttf'),
    // Fraunces display cut — pre-instanced from the variable source at
    // opsz=144, wght=450, WONK=1. Mirrors the webapp's hero rendering
    // (Fraunces variable with `font-optical-sizing: auto` engaging the display
    // cut at large sizes). React Native 0.81 can't drive variable axes at
    // runtime, so we ship the baked static. Re-bake via
    // `apps/mobile/scripts/bake-fraunces-display.py` if axes need to change.
    'FrauncesDisplayWonk': require('@/assets/fonts/Fraunces-Display144-450-Wonk.ttf'),
    // Static body cuts from Google Fonts — used for sub-headline serif text
    // and card titles where the display cut would render too fragile.
    'Fraunces-Regular': require('@expo-google-fonts/fraunces/400Regular/Fraunces_400Regular.ttf'),
    'Fraunces-SemiBold': require('@expo-google-fonts/fraunces/600SemiBold/Fraunces_600SemiBold.ttf'),
    // Body sans — matches the webapp's Nunito Sans body voice
    // (--font-nunito in apps/api/app/layout.tsx).
    'NunitoSans-Regular': require('@expo-google-fonts/nunito-sans/400Regular/NunitoSans_400Regular.ttf'),
    'NunitoSans-SemiBold': require('@expo-google-fonts/nunito-sans/600SemiBold/NunitoSans_600SemiBold.ttf'),
    // Body serif — kept for non-headline serif text.
    'Newsreader-Regular': require('@expo-google-fonts/newsreader/400Regular/Newsreader_400Regular.ttf'),
    'Newsreader-Italic': require('@expo-google-fonts/newsreader/400Regular_Italic/Newsreader_400Regular_Italic.ttf'),
  });

  // ─── Supabase auto-refresh wiring (S-228) ───────────────────────────────────
  // Per Supabase RN docs: only run the refresh timer while the app is in the
  // foreground. Stopping on background prevents wasted CPU + battery; starting
  // on foreground guarantees a refresh attempt right after a long resume.
  useEffect(() => {
    supabase.auth.startAutoRefresh();
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    });
    return () => {
      sub.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, []);

  // ─── PostHog: session refresh lifecycle ─────────────────────────────────────
  // TOKEN_REFRESHED → SDK successfully rotated the access token.
  // SIGNED_OUT with a prior session → refresh failed (reuse detection or
  // refresh token expired) and the SDK forced a sign-out. Both are useful
  // signals for retention dashboards.
  useEffect(() => {
    let priorSessionUserId: string | null = null;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session) {
        trackSessionRefreshed({ user_id: session.user.id });
        priorSessionUserId = session.user.id;
      } else if (event === 'SIGNED_OUT' && priorSessionUserId) {
        trackSessionRefreshFailed({ user_id: priorSessionUserId });
        priorSessionUserId = null;
      } else if (event === 'SIGNED_IN' && session) {
        priorSessionUserId = session.user.id;
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!fontsLoaded) return null;

  return (
    <PostHogProvider client={getPostHogClient()}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </ThemeProvider>
      </SafeAreaProvider>
    </PostHogProvider>
  );
}
