import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { usePurchases } from '@/lib/usePurchases';

export default function SubscriptionCheck() {
  const purchases = usePurchases();
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!purchases.ready || purchases.isUnknown) return;
    router.replace(purchases.entitled ? '/(tabs)/search' :
      purchases.isLapsed ? '/welcome/resubscribe' : '/welcome/payment');
  }, [purchases.ready, purchases.isUnknown, purchases.entitled, purchases.isLapsed]);

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try { await purchases.syncEntitlement('mismatch'); }
    finally { setRetrying(false); }
  };

  return (
    <SafeAreaView style={s.page}>
      <View style={s.content}>
        <Text style={s.title}>Checking your subscription</Text>
        <Text style={s.body}>We could not confirm your subscription just now. Try again when you are connected.</Text>
        <Pressable testID="subscription-check-retry" accessibilityRole="button" onPress={() => { void retry(); }} style={s.button}>
          <Text style={s.buttonText}>{retrying ? 'Checking...' : 'Try again'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: EDITORIAL.cream },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 32, gap: 20 },
  title: { fontFamily: FONTS.frauncesDisplayBold, fontSize: 34, color: EDITORIAL.green },
  body: { fontFamily: FONTS.nunitoSans, fontSize: 16, lineHeight: 24, color: EDITORIAL.textSoft },
  button: { backgroundColor: EDITORIAL.green, borderRadius: 30, padding: 18, alignItems: 'center' },
  buttonText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, color: EDITORIAL.cream },
});
