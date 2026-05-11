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
    // Display cut, instanced from Fraunces variable with opsz=144 + wght=400
    // baked in. Matches the webapp's hero typography (font-weight: 400 +
    // opsz=auto picking the display cut). React Native 0.81 doesn't yet expose
    // `fontVariationSettings` as a style prop, so we ship a pre-instanced
    // static .ttf instead of the raw variable font.
    'Fraunces-DisplayRegular': require('@/assets/fonts/Fraunces-DisplayRegular.ttf'),
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
