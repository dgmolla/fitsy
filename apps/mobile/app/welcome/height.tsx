import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { useTheme } from '@/lib/theme';

type Unit = 'cm' | 'ft';

function MountainScene() {
  const { colors } = useTheme();
  return (
    <View style={illStyles.wrap}>
      <Ionicons name="sunny-outline" size={22} color="#F59E0B" style={illStyles.sun} />
      <View style={illStyles.peaks}>
        <Ionicons name="triangle" size={28} color={colors.textTertiary} style={illStyles.peakSmall} />
        <Ionicons name="triangle" size={48} color={colors.accent} />
        <Ionicons name="triangle" size={32} color={colors.accentBorder} style={illStyles.peakSmall} />
      </View>
      <View style={[illStyles.ground, { backgroundColor: colors.accentBg }]} />
    </View>
  );
}

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
    <WelcomeScreen
      step={2}
      totalSteps={7}
      illustration={<MountainScene />}
      title="How tall are you?"
      subtitle="Used to estimate your basal metabolic rate. We keep this between us."
      onContinue={() => router.push('/welcome/weight')}
      canContinue={isValid}
    >
      {/* Toggle */}
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

      {unit === 'cm' ? (
        <View style={[styles.inputRow, { backgroundColor: colors.bgCard, borderColor: colors.inputBorder }]}>
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
        <View style={styles.ftRow}>
          <View style={[styles.inputRow, styles.flex, { backgroundColor: colors.bgCard, borderColor: colors.inputBorder }]}>
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
          <View style={[styles.inputRow, styles.flex, { backgroundColor: colors.bgCard, borderColor: colors.inputBorder }]}>
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
    </WelcomeScreen>
  );
}

const illStyles = StyleSheet.create({
  wrap: { alignItems: 'center', height: 80 },
  sun: { position: 'absolute', top: 0, right: 20 },
  peaks: { flexDirection: 'row', alignItems: 'flex-end', gap: -8, marginTop: 12 },
  peakSmall: { marginBottom: 0 },
  ground: { width: 140, height: 8, borderRadius: 4, marginTop: -2 },
});

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
  flex: { flex: 1 },
  ftRow: { flexDirection: 'row', gap: 12 },
  input: { flex: 1, fontSize: 28, fontWeight: '700' },
  unit: { fontSize: 16, fontWeight: '500' },
});
