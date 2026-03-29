import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { useTheme } from '@/lib/theme';

type Unit = 'kg' | 'lbs';

export default function WeightScreen() {
  const { colors } = useTheme();
  const [unit, setUnit] = useState<Unit>('lbs');
  const [value, setValue] = useState('');

  const isValid = (() => {
    const n = parseFloat(value);
    if (isNaN(n)) return false;
    if (unit === 'kg') return n >= 30 && n <= 300;
    return n >= 66 && n <= 660;
  })();

  return (
    <WelcomeScreen
      step={3}
      totalSteps={7}
      illustration={<Image source={require('@/assets/illustrations/weight.jpg')} style={{ width: 180, height: 180, resizeMode: 'contain' }} />}
      title="What do you weigh?"
      subtitle="No judgment here. This helps us dial in your macro targets perfectly."
      onContinue={() => router.push('/welcome/activity')}
      canContinue={isValid}
    >
      {/* Toggle */}
      <View style={[styles.toggle, { backgroundColor: colors.bgElevated }]}>
        {(['lbs', 'kg'] as Unit[]).map((u) => (
          <Pressable
            key={u}
            style={[
              styles.toggleOpt,
              unit === u && [styles.toggleOptActive, { backgroundColor: colors.bgCard }],
            ]}
            onPress={() => setUnit(u)}
            accessibilityRole="button"
            accessibilityLabel={u === 'kg' ? 'Kilograms' : 'Pounds'}
            accessibilityState={{ selected: unit === u }}
          >
            <Text
              style={[
                styles.toggleTxt,
                { color: colors.textSecondary },
                unit === u && { color: colors.textPrimary, fontWeight: '600' },
              ]}
            >
              {u}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={[styles.inputRow, { backgroundColor: colors.bgCard, borderColor: colors.inputBorder }]}>
        <TextInput
          style={[styles.input, { color: colors.textPrimary }]}
          keyboardType="decimal-pad"
          placeholder={unit === 'lbs' ? '160' : '73'}
          placeholderTextColor={colors.inputPlaceholder}
          value={value}
          onChangeText={setValue}
          maxLength={5}
          accessibilityLabel={`Weight in ${unit}`}
        />
        <Text style={[styles.unit, { color: colors.textSecondary }]}>{unit}</Text>
      </View>
    </WelcomeScreen>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 4,
    marginBottom: 20,
  },
  toggleOpt: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  toggleOptActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  toggleTxt: { fontSize: 14, fontWeight: '500' },
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
});
