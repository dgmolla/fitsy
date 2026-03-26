import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { getStoredToken } from '@/lib/authClient';
import { getMacroTargets } from '@/lib/macroStorage';

type Destination = '/(tabs)/search' | '/auth/login' | '/macro-setup';

export default function Index() {
  const [destination, setDestination] = useState<Destination | null>(null);

  useEffect(() => {
    async function resolve() {
      try {
        const token = await getStoredToken();
        if (!token) {
          setDestination('/auth/login');
          return;
        }
        const targets = await getMacroTargets();
        setDestination(targets ? '/(tabs)/search' : '/macro-setup');
      } catch {
        setDestination('/auth/login');
      }
    }
    resolve();
  }, []);

  if (!destination) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#2D7D46" accessibilityLabel="Loading" />
      </View>
    );
  }

  return <Redirect href={destination} />;
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
