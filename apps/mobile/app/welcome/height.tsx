import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { ScrollPicker, rangeValues } from '@/components/ScrollPicker';
import { useTheme } from '@/lib/theme';
import { saveOnboardingField } from '@/lib/onboardingStorage';

type Unit = 'cm' | 'ft';

const CM_VALUES = rangeValues(100, 250);
const FEET_VALUES = rangeValues(3, 8);
const INCHES_VALUES = rangeValues(0, 11);

export default function HeightScreen() {
  const { colors } = useTheme();
  const [unit, setUnit] = useState<Unit>('cm');
  const [cm, setCm] = useState(170);
  const [feet, setFeet] = useState(5);
  const [inches, setInches] = useState(9);

  return (
    <WelcomeScreen
      step={2}
      totalSteps={7}
      title="How tall are you?"
      subtitle="Used to estimate your basal metabolic rate. We keep this between us."
      onContinue={async () => {
        const heightCm = unit === 'cm'
          ? cm
          : Math.round(feet * 30.48 + inches * 2.54);
        await saveOnboardingField('heightCm', heightCm);
        router.push('/welcome/weight');
      }}
      canContinue={true}
    >
      {/* Unit toggle */}
      <View style={[styles.toggle, { backgroundColor: colors.bgElevated }]}>
        {(['cm', 'ft'] as Unit[]).map((u) => (
          <Pressable
            key={u}
            style={[
              styles.toggleOpt,
              unit === u && [styles.toggleOptActive, { backgroundColor: colors.bgCard }],
            ]}
            onPress={() => setUnit(u)}
            accessibilityRole="button"
            accessibilityLabel={u === 'cm' ? 'Centimeters' : 'Feet and inches'}
            accessibilityState={{ selected: unit === u }}
          >
            <Text
              style={[
                styles.toggleTxt,
                { color: colors.textSecondary },
                unit === u && { color: colors.textPrimary, fontWeight: '600' },
              ]}
            >
              {u === 'cm' ? 'cm' : 'ft / in'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Pickers */}
      <View style={styles.pickerRow}>
        {unit === 'cm' ? (
          <ScrollPicker values={CM_VALUES} value={cm} unit="cm" onChange={setCm} />
        ) : (
          <>
            <ScrollPicker values={FEET_VALUES} value={feet} unit="ft" onChange={setFeet} />
            <ScrollPicker values={INCHES_VALUES} value={inches} unit="in" onChange={setInches} />
          </>
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
