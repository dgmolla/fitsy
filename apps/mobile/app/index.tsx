import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { getStoredToken } from '@/lib/authClient';

export default function Index() {
  const [destination, setDestination] = useState<'/(tabs)/search' | '/auth/login' | null>(null);

  useEffect(() => {
    getStoredToken()
      .then((token) => {
        setDestination(token ? '/(tabs)/search' : '/auth/login');
      })
      .catch(() => {
        setDestination('/auth/login');
      });
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
