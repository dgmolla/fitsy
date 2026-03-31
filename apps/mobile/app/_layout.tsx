import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { ThemeProvider } from '@/lib/theme';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    'Caslon540Italic': require('@/assets/fonts/Caslon540Italic.ttf'),
    'PlayfairDisplay-BoldItalic': require('@expo-google-fonts/playfair-display/700Bold_Italic/PlayfairDisplay_700Bold_Italic.ttf'),
    'Manrope-Bold': require('@expo-google-fonts/manrope/700Bold/Manrope_700Bold.ttf'),
  });

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
