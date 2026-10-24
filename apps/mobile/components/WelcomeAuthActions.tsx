import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedPress } from './AnimatedPress';
import { EDITORIAL, TEXT } from '@/lib/brand';

interface Props {
  busy: boolean;
  appleLoading: boolean;
  googleLoading: boolean;
  devLoading: boolean;
  onApple: () => void;
  onGoogle: () => void;
  onDev: () => void;
}
export function WelcomeAuthActions({ busy, appleLoading, googleLoading, devLoading, onApple, onGoogle, onDev }: Props) {
  return <View style={s.buttons}>
    <AnimatedPress style={[s.button, s.apple, busy && s.dim]} onPress={onApple} disabled={busy} haptic
      accessibilityRole="button" accessibilityLabel="Continue with Apple" testID="signup-apple">
      <Ionicons name="logo-apple" size={20} color={EDITORIAL.cream} /><Text style={s.appleText}>{appleLoading ? 'Signing in...' : 'Continue with Apple'}</Text>
    </AnimatedPress>
    <AnimatedPress style={[s.button, s.google, busy && s.dim]} onPress={onGoogle} disabled={busy} haptic
      accessibilityRole="button" accessibilityLabel="Continue with Google" testID="signup-google">
      <Ionicons name="logo-google" size={20} color={EDITORIAL.text} /><Text style={s.googleText}>{googleLoading ? 'Signing in...' : 'Continue with Google'}</Text>
    </AnimatedPress>
    {__DEV__ && <AnimatedPress style={[s.button, s.google, busy && s.dim]} onPress={onDev} disabled={busy} haptic
      accessibilityRole="button" accessibilityLabel="Dev login" testID="signup-dev">
      <Ionicons name="code-slash" size={20} color={EDITORIAL.textSoft} /><Text style={s.googleText}>{devLoading ? 'Signing in...' : 'Dev Login (skip auth)'}</Text>
    </AnimatedPress>}
  </View>;
}
const s = StyleSheet.create({
  buttons: { gap: 10, marginBottom: 16 },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 54, paddingVertical: 17, paddingHorizontal: 16, borderRadius: 32 },
  apple: { backgroundColor: EDITORIAL.text },
  google: { backgroundColor: EDITORIAL.cream, borderWidth: 1, borderColor: EDITORIAL.border },
  appleText: { ...TEXT.cta, fontSize: 16, flexShrink: 1, textAlign: 'center' },
  googleText: { ...TEXT.cta, color: EDITORIAL.text, fontSize: 16, flexShrink: 1, textAlign: 'center' },
  dim: { opacity: 0.4 },
});
