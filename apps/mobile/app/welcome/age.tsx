import React, { useState } from 'react';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { useTheme } from '@/lib/theme';

export default function AgeScreen() {
  const { colors } = useTheme();
  const [age, setAge] = useState('');

  const ageNum = parseInt(age, 10);
  const isValid = !isNaN(ageNum) && ageNum >= 13 && ageNum <= 99;

  return (
    <WelcomeScreen
      step={1}
      totalSteps={7}
      illustration={<Image source={require('@/assets/illustrations/age.jpg')} style={{ width: 180, height: 180, resizeMode: 'contain' }} />}
      title="How old are you?"
      subtitle="We use your age to calculate an accurate daily calorie target. This stays private."
      onContinue={() => router.push('/welcome/height')}
      canContinue={isValid}
    >
      <View style={[styles.inputRow, { backgroundColor: colors.bgCard, borderColor: colors.inputBorder }]}>
        <TextInput
          style={[styles.input, { color: colors.textPrimary }]}
          keyboardType="number-pad"
          placeholder="25"
          placeholderTextColor={colors.inputPlaceholder}
          value={age}
          onChangeText={setAge}
          maxLength={2}
          accessibilityLabel="Age"
        />
        <Text style={[styles.unit, { color: colors.textSecondary }]}>years</Text>
      </View>
      {age.length > 0 && !isValid ? (
        <Text style={[styles.error, { color: colors.error }]}>
          Age must be between 13 and 99.
        </Text>
      ) : null}
    </WelcomeScreen>
  );
}

const styles = StyleSheet.create({
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: 14,
    paddingHorizontal: 20,
    height: 64,
    gap: 8,
  },
  input: { flex: 1, fontSize: 28, fontWeight: '700' },
  unit: { fontSize: 16, fontWeight: '500' },
  error: { marginTop: 8, fontSize: 13 },
});
