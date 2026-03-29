import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { ScrollPicker, rangeValues } from '@/components/ScrollPicker';
import { saveOnboardingField } from '@/lib/onboardingStorage';

const AGE_VALUES = rangeValues(13, 99);

export default function AgeScreen() {
  const [age, setAge] = useState(25);

  return (
    <WelcomeScreen
      step={1}
      totalSteps={7}
      title="How old are you?"
      subtitle="We use your age to calculate an accurate daily calorie target. This stays private."
      onContinue={async () => {
        await saveOnboardingField('age', age);
        router.push('/welcome/height');
      }}
      canContinue={true}
    >
      <View style={styles.pickerContainer}>
        <ScrollPicker
          values={AGE_VALUES}
          value={age}
          unit="years"
          onChange={setAge}
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
