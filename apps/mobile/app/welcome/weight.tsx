import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { ScrollPicker, rangeValues } from '@/components/ScrollPicker';
import { useTheme } from '@/lib/theme';
import { saveOnboardingField } from '@/lib/onboardingStorage';

type Unit = 'kg' | 'lbs';

const KG_VALUES = rangeValues(30, 200);
const LBS_VALUES = rangeValues(66, 440);

export default function WeightScreen() {
  const { colors } = useTheme();
  const [unit, setUnit] = useState<Unit>('lbs');
  const [kg, setKg] = useState(73);
  const [lbs, setLbs] = useState(160);

  return (
    <WelcomeScreen
      step={3}
      totalSteps={7}
      title="What do you weigh?"
      subtitle="No judgment here. This helps us dial in your macro targets perfectly."
      onContinue={async () => {
        const weightKg = unit === 'kg'
          ? kg
          : Math.round(lbs * 0.453592 * 10) / 10;
        await saveOnboardingField('weightKg', weightKg);
        router.push('/welcome/activity');
      }}
      canContinue={true}
    >
      {/* Unit toggle */}
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

      {/* Picker */}
      <View style={styles.pickerRow}>
        {unit === 'lbs' ? (
          <ScrollPicker values={LBS_VALUES} value={lbs} unit="lbs" onChange={setLbs} />
        ) : (
          <ScrollPicker values={KG_VALUES} value={kg} unit="kg" onChange={setKg} />
        )}
      </View>
    </WelcomeScreen>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
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
  pickerRow: {
    flexDirection: 'row',
    gap: 12,
    flex: 1,
  },
});
