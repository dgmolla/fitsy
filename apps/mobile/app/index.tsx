import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { getStoredToken } from '@/lib/authClient';
import { getMacroTargets } from '@/lib/macroStorage';
import { useTheme } from '@/lib/theme';

type Destination = '/(tabs)/search' | '/welcome' | '/macro-setup';

export default function Index() {
  const { colors } = useTheme();
  const [destination, setDestination] = useState<Destination | null>(null);

  useEffect(() => {
    async function resolve() {
      try {
        const token = await getStoredToken();
        if (!token) {
          setDestination('/welcome');
          return;
        }
        const targets = await getMacroTargets();
        setDestination(targets ? '/(tabs)/search' : '/macro-setup');
      } catch {
        setDestination('/welcome');
      }
    }
    resolve();
  }, []);

  if (!destination) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={colors.spinnerColor} accessibilityLabel="Loading" />
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
