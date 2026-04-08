import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { PostHogProvider } from 'posthog-react-native';
import { ThemeProvider } from '@/lib/theme';
import { getPostHogClient } from '@/lib/analytics';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    'Caslon540Italic': require('@/assets/fonts/Caslon540Italic.ttf'),
    'PlayfairDisplay-BoldItalic': require('@expo-google-fonts/playfair-display/700Bold_Italic/PlayfairDisplay_700Bold_Italic.ttf'),
    'Manrope-Bold': require('@expo-google-fonts/manrope/700Bold/Manrope_700Bold.ttf'),
    'Newsreader-Regular': require('@expo-google-fonts/newsreader/400Regular/Newsreader_400Regular.ttf'),
    'Newsreader-Italic': require('@expo-google-fonts/newsreader/400Regular_Italic/Newsreader_400Regular_Italic.ttf'),
    'Newsreader-Bold': require('@expo-google-fonts/newsreader/700Bold/Newsreader_700Bold.ttf'),
  });

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
