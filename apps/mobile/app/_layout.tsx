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
    'Caslon540Italic': require('@/assets/fonts/Caslon540Italic.ttf'),
    'PlayfairDisplay-BoldItalic': require('@expo-google-fonts/playfair-display/700Bold_Italic/PlayfairDisplay_700Bold_Italic.ttf'),
    'Manrope-Bold': require('@expo-google-fonts/manrope/700Bold/Manrope_700Bold.ttf'),
    'Newsreader-Regular': require('@expo-google-fonts/newsreader/400Regular/Newsreader_400Regular.ttf'),
    'Newsreader-Italic': require('@expo-google-fonts/newsreader/400Regular_Italic/Newsreader_400Regular_Italic.ttf'),
    'Newsreader-Bold': require('@expo-google-fonts/newsreader/700Bold/Newsreader_700Bold.ttf'),
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
