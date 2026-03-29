import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { ContinueButton } from '@/components/ContinueButton';
import { ProgressDots } from '@/components/ProgressDots';
import { useTheme } from '@/lib/theme';

type Unit = 'cm' | 'ft';

export default function HeightScreen() {
  const { colors } = useTheme();
  const [unit, setUnit] = useState<Unit>('cm');
  const [cm, setCm] = useState('');
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('');

  const isValidCm = (() => {
    const n = parseInt(cm, 10);
    return !isNaN(n) && n >= 100 && n <= 250;
  })();

  const isValidFtIn = (() => {
    const ft = parseInt(feet, 10);
    const inch = parseInt(inches, 10);
    return !isNaN(ft) && ft >= 3 && ft <= 8 && !isNaN(inch) && inch >= 0 && inch <= 11;
  })();

  const isValid = unit === 'cm' ? isValidCm : isValidFtIn;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <ProgressDots current={2} total={7} />
        </View>

        <View style={styles.body}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>How tall are you?</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Used to estimate your basal metabolic rate.</Text>

          <View style={[styles.toggle, { backgroundColor: colors.bgElevated }]}>
            {(['cm', 'ft'] as Unit[]).map((u) => (
              <Pressable
                key={u}
                style={[
                  styles.toggleOption,
                  unit === u && [
                    styles.toggleOptionActive,
                    {
                      backgroundColor: colors.bgCard,
                      shadowColor: colors.glassShadowColor,
                    },
                  ],
                ]}
                onPress={() => setUnit(u)}
                accessibilityRole="button"
                accessibilityLabel={u === 'cm' ? 'Centimeters' : 'Feet and inches'}
                accessibilityState={{ selected: unit === u }}
              >
                <Text
                  style={[
                    styles.toggleLabel,
                    { color: colors.textSecondary },
                    unit === u && { color: colors.textPrimary, fontWeight: '600' },
                  ]}
                >
                  {u === 'cm' ? 'cm' : 'ft / in'}
                </Text>
              </Pressable>
            ))}
          </View>

          {unit === 'cm' ? (
            <View style={[styles.inputRow, { borderColor: colors.inputBorder }]}>
              <TextInput
                style={[styles.input, { color: colors.textPrimary }]}
                keyboardType="number-pad"
                placeholder="170"
                placeholderTextColor={colors.inputPlaceholder}
                value={cm}
                onChangeText={setCm}
                maxLength={3}
                accessibilityLabel="Height in centimeters"
              />
              <Text style={[styles.unit, { color: colors.textSecondary }]}>cm</Text>
            </View>
          ) : (
            <View style={styles.ftInRow}>
              <View style={[styles.inputRow, styles.inputRowFlex, { borderColor: colors.inputBorder }]}>
                <TextInput
                  style={[styles.input, { color: colors.textPrimary }]}
                  keyboardType="number-pad"
                  placeholder="5"
                  placeholderTextColor={colors.inputPlaceholder}
                  value={feet}
                  onChangeText={setFeet}
                  maxLength={1}
                  accessibilityLabel="Feet"
                />
                <Text style={[styles.unit, { color: colors.textSecondary }]}>ft</Text>
              </View>
              <View style={[styles.inputRow, styles.inputRowFlex, { borderColor: colors.inputBorder }]}>
                <TextInput
                  style={[styles.input, { color: colors.textPrimary }]}
                  keyboardType="number-pad"
                  placeholder="9"
                  placeholderTextColor={colors.inputPlaceholder}
                  value={inches}
                  onChangeText={setInches}
                  maxLength={2}
                  accessibilityLabel="Inches"
                />
                <Text style={[styles.unit, { color: colors.textSecondary }]}>in</Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <ContinueButton
            onPress={() => router.push('/welcome/weight')}
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
    marginBottom: 32,
    lineHeight: 22,
  },
  toggle: {
    flexDirection: 'row',
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
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '500',
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
  inputRowFlex: {
    flex: 1,
  },
  ftInRow: {
    flexDirection: 'row',
    gap: 12,
  },
  input: {
    flex: 1,
    fontSize: 24,
    fontWeight: '600',
  },
  unit: {
    fontSize: 16,
  },
  footer: {
    paddingTop: 16,
  },
});
