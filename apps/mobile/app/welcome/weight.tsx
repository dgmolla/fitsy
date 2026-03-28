import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { ContinueButton } from '@/components/ContinueButton';
import { ProgressDots } from '@/components/ProgressDots';

type Unit = 'kg' | 'lbs';

export default function WeightScreen() {
  const [unit, setUnit] = useState<Unit>('lbs');
  const [value, setValue] = useState('');

  const isValid = (() => {
    const n = parseFloat(value);
    if (isNaN(n)) return false;
    if (unit === 'kg') return n >= 30 && n <= 300;
    return n >= 66 && n <= 660;
  })();

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <ProgressDots current={3} total={7} />
        </View>

        <View style={styles.body}>
          <Text style={styles.title}>What is your weight?</Text>
          <Text style={styles.subtitle}>Used to personalize your daily macro targets.</Text>

          <View style={styles.toggle}>
            {(['lbs', 'kg'] as Unit[]).map((u) => (
              <Pressable
                key={u}
                style={[styles.toggleOption, unit === u && styles.toggleOptionActive]}
                onPress={() => setUnit(u)}
                accessibilityRole="button"
                accessibilityLabel={u === 'kg' ? 'Kilograms' : 'Pounds'}
                accessibilityState={{ selected: unit === u }}
              >
                <Text style={[styles.toggleLabel, unit === u && styles.toggleLabelActive]}>
                  {u}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              placeholder={unit === 'lbs' ? '160' : '73'}
              placeholderTextColor="#9CA3AF"
              value={value}
              onChangeText={setValue}
              maxLength={5}
              accessibilityLabel={`Weight in ${unit}`}
            />
            <Text style={styles.unit}>{unit}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <ContinueButton
            onPress={() => router.push('/welcome/activity')}
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
    backgroundColor: '#FFFFFF',
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
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    marginBottom: 32,
    lineHeight: 22,
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    padding: 4,
    marginBottom: 28,
  },
  toggleOption: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  toggleOptionActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
  },
  toggleLabelActive: {
    color: '#111827',
    fontWeight: '600',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 60,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 24,
    fontWeight: '600',
    color: '#111827',
  },
  unit: {
    fontSize: 16,
    color: '#6B7280',
  },
  footer: {
    paddingTop: 16,
  },
});
