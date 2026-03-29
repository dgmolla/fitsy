import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { useTheme } from '@/lib/theme';

function TreeGrowth() {
  const { colors } = useTheme();
  const g = colors.accent;
  const dim = colors.textTertiary;
  return (
    <View style={illStyles.wrap}>
      {/* Small sapling */}
      <View style={illStyles.stage}>
        <Ionicons name="leaf-outline" size={16} color={dim} />
        <View style={[illStyles.stem, { backgroundColor: dim }]} />
      </View>
      {/* Medium tree */}
      <View style={illStyles.stage}>
        <Ionicons name="leaf" size={24} color={colors.accentBorder} />
        <View style={[illStyles.stem, { backgroundColor: colors.accentBorder, height: 16 }]} />
      </View>
      {/* Full tree */}
      <View style={illStyles.stage}>
        <Ionicons name="leaf" size={36} color={g} />
        <View style={[illStyles.stem, { backgroundColor: g, height: 22 }]} />
      </View>
      {/* Arrow hints */}
      <View style={illStyles.arrows}>
        <Ionicons name="arrow-forward" size={14} color={dim} />
        <Ionicons name="arrow-forward" size={14} color={dim} />
      </View>
    </View>
  );
}

export default function AgeScreen() {
  const { colors } = useTheme();
  const [age, setAge] = useState('');

  const ageNum = parseInt(age, 10);
  const isValid = !isNaN(ageNum) && ageNum >= 13 && ageNum <= 99;

  return (
    <WelcomeScreen
      step={1}
      totalSteps={7}
      illustration={<TreeGrowth />}
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

const illStyles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 20 },
  stage: { alignItems: 'center' },
  stem: { width: 3, height: 10, borderRadius: 2, marginTop: -2 },
  arrows: {
    position: 'absolute',
    flexDirection: 'row',
    gap: 40,
    bottom: 14,
    left: 24,
    right: 24,
    justifyContent: 'space-between',
  },
});

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
