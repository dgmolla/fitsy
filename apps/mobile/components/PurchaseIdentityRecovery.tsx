import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EDITORIAL, FONTS } from '@/lib/brand';

export function PurchaseIdentityRecovery({ onRetry }: { onRetry: () => void }) {
  return (
    <SafeAreaView style={s.page}>
      <View style={s.content}>
        <Text style={s.title}>Checking your account</Text>
        <Text style={s.body}>We could not confirm your sign-in just now. Try again when you are connected.</Text>
        <Pressable testID="purchase-identity-retry" accessibilityRole="button" onPress={onRetry} style={s.button}>
          <Text style={s.buttonText}>Try again</Text>
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
