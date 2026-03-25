import { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { getStoredToken } from '@/lib/authClient';

export default function RootLayout() {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    getStoredToken()
      .then((token) => {
        if (token) {
          router.replace('/(tabs)/search');
        } else {
          router.replace('/auth/login');
        }
      })
      .catch(() => {
        router.replace('/auth/login');
      })
      .finally(() => {
        setChecking(false);
      });
  }, []);

  return (
    <SafeAreaProvider>
      {checking ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#2D7D46" accessibilityLabel="Loading" />
        </View>
      ) : (
        <Stack screenOptions={{ headerShown: false }} />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
