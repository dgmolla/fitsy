import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { ScrollPicker, rangeValues } from '@/components/ScrollPicker';
import { saveOnboardingField } from '@/lib/onboardingStorage';

const MONTHS = rangeValues(1, 12);
const DAYS = rangeValues(1, 31);

const currentYear = new Date().getFullYear();
const YEARS = rangeValues(currentYear - 99, currentYear - 13);

const MONTH_NAMES: Record<number, string> = {
  1: 'Jan', 2: 'Feb', 3: 'Mar', 4: 'Apr', 5: 'May', 6: 'Jun',
  7: 'Jul', 8: 'Aug', 9: 'Sep', 10: 'Oct', 11: 'Nov', 12: 'Dec',
};

function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

export default function AgeScreen() {
  const defaultYear = currentYear - 25;
  const [month, setMonth] = useState(1);
  const [day, setDay] = useState(1);
  const [year, setYear] = useState(defaultYear);

  const maxDay = daysInMonth(month, year);
  const clampedDay = Math.min(day, maxDay);

  const toISODate = () => {
    const m = String(month).padStart(2, '0');
    const d = String(clampedDay).padStart(2, '0');
    return `${year}-${m}-${d}`;
  };

  return (
    <WelcomeScreen
      step={1}
      totalSteps={9}
      title="When's your birthday?"
      subtitle="We use your age to personalize your daily calorie target. This stays private."
      onContinue={async () => {
        await saveOnboardingField('birthday', toISODate());
        router.push('/welcome/height');
      }}
      canContinue={true}
    >
      <View style={styles.pickerContainer}>
        <ScrollPicker
          values={MONTHS}
          value={month}
          formatItem={(v) => MONTH_NAMES[v] ?? String(v)}
          onChange={setMonth}
        />
        <ScrollPicker
          values={rangeValues(1, maxDay)}
          value={clampedDay}
          onChange={setDay}
        />
        <ScrollPicker
          values={YEARS}
          value={year}
          onChange={setYear}
        />
      </View>
    </WelcomeScreen>
  );
}

const styles = StyleSheet.create({
  pickerContainer: {
    flexDirection: 'row',
    flex: 1,
  },
});
