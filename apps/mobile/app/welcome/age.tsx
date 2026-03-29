import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { ContinueButton } from '@/components/ContinueButton';
import { ProgressDots } from '@/components/ProgressDots';
import { useTheme } from '@/lib/theme';

export default function AgeScreen() {
  const { colors } = useTheme();
  const [age, setAge] = useState('');

  const ageNum = parseInt(age, 10);
  const isValid = !isNaN(ageNum) && ageNum >= 13 && ageNum <= 99;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <ProgressDots current={1} total={7} />
        </View>

        <View style={styles.body}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>How old are you?</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>We use this to calculate your daily calorie target.</Text>

          <View style={[styles.inputRow, { borderColor: colors.inputBorder }]}>
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
            <Text style={[styles.error, { color: colors.error }]}>Age must be between 13 and 99.</Text>
          ) : null}
        </View>

        <View style={styles.footer}>
          <ContinueButton
            onPress={() => router.push('/welcome/height')}
            disabled={!isValid}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    marginBottom: 40,
    lineHeight: 22,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 60,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 24,
    fontWeight: '600',
  },
  unit: {
    fontSize: 16,
  },
  error: {
    marginTop: 8,
    fontSize: 13,
  },
  footer: {
    paddingTop: 16,
  },
});
