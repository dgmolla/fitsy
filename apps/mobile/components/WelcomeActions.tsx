import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedPress } from './AnimatedPress';
import { EDITORIAL, TEXT } from '@/lib/brand';

interface Props {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  secondaryLabel?: string;
  onSecondary?: () => void;
  secondaryTestID?: string;
}

export function WelcomeActions({ label, onPress, disabled, testID = 'welcome-continue', secondaryLabel, onSecondary, secondaryTestID }: Props) {
  return <>
    <AnimatedPress style={[s.primary, disabled && s.disabled]} onPress={onPress} disabled={disabled} haptic
      accessibilityRole="button" accessibilityLabel={label} testID={testID}>
      <Text style={s.primaryText}>{label}</Text><Ionicons name="arrow-forward" size={18} color={EDITORIAL.cream} />
    </AnimatedPress>
    {onSecondary && <AnimatedPress style={s.secondary} onPress={onSecondary} disabled={disabled}
      accessibilityRole="button" accessibilityLabel={secondaryLabel} testID={secondaryTestID ?? 'welcome-secondary'}>
      <Text style={s.secondaryText}>{secondaryLabel}</Text>
    </AnimatedPress>}
  </>;
}
const s = StyleSheet.create({
  primary: { minHeight: 54, paddingVertical: 17, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, borderRadius: 32, backgroundColor: EDITORIAL.green },
  primaryText: { ...TEXT.cta, flexShrink: 1, textAlign: 'center' },
  disabled: { opacity: 0.35 },
  secondary: { minHeight: 52, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { ...TEXT.body, textAlign: 'center', color: EDITORIAL.green },
});
