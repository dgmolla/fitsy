import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { onboardingPitch } from '@/lib/onboardingPersonalization';

type Pitch = ReturnType<typeof onboardingPitch>;
const mealPhoto = require('@/assets/dishes/19.jpg');
function Arrow() { return <Ionicons style={s.arrow} name="arrow-down" size={22} color={EDITORIAL.greenAccent} accessibilityElementsHidden />; }

export function OnboardingFitnessPayoff({ pitch }: { pitch: Pitch }) {
  const twoPaths = pitch.diagram === 'two_paths';
  const targets = <View style={s.row}><Ionicons name="options-outline" size={28} color={EDITORIAL.greenAccent} />
    <View style={s.copy}><Text style={s.title}>{twoPaths ? 'The same meal targets' : pitch.stages[0]}</Text><Text style={s.note}>Calories + protein</Text></View></View>;
  return <View style={s.art} testID="fitness-payoff-diagram">
    {twoPaths && <><View style={s.paths}>
      <View style={s.path}><Ionicons name="home-outline" size={34} color={EDITORIAL.greenAccent} /><Text style={s.pathText}>A meal at home</Text></View>
      <View style={s.path}><Image source={mealPhoto} style={s.pathImage} /><Text style={s.pathText}>A meal out</Text></View>
    </View><Arrow /></>}
    {targets}
    {!twoPaths && <><Arrow /><View style={s.row}>
      <Image source={mealPhoto} style={s.mealImage} />
      <View style={s.copy}><Text style={s.eyebrow}>YOUR NEXT MEAL</Text><Text style={s.title}>{pitch.stages[1]}</Text><Text style={s.note}>See nutrition before you choose.</Text></View>
    </View></>}
    <Arrow />
    <View style={[s.row, s.outcome]}><Ionicons name="locate-outline" size={30} color={EDITORIAL.greenAccent} />
      <View style={s.copy}><Text style={s.title}>{pitch.stages[2]}</Text><Text style={s.note}>Eating out can support your plan.</Text>
        <View style={s.goalTypes}>{([['barbell-outline', 'Strength'], ['scale-outline', 'Weight'], ['heart-outline', 'Balance']] as const).map(([name, label]) =>
          <View style={s.goal} key={label}><Ionicons name={name} size={14} color={EDITORIAL.greenAccent} /><Text style={s.goalLabel}>{label}</Text></View>)}</View>
      </View>
    </View>
  </View>;
}
const s = StyleSheet.create({
  art: { padding: 18, borderRadius: 26, backgroundColor: EDITORIAL.greenAccentTint, gap: 8, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 20, backgroundColor: EDITORIAL.cream },
  copy: { flex: 1, gap: 5 },
  title: { ...TEXT.body, fontSize: 15, color: EDITORIAL.green },
  note: { ...TEXT.bodySmall, fontSize: 12, color: EDITORIAL.textMid },
  eyebrow: { ...TEXT.caption, fontSize: 9, color: EDITORIAL.textSoft, marginBottom: 4 },
  arrow: { alignSelf: 'center' },
  mealImage: { width: 68, height: 88, borderRadius: 12 },
  paths: { flexDirection: 'row', gap: 12 },
  path: { flex: 1, minHeight: 104, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: EDITORIAL.cream },
  pathImage: { width: 48, height: 44, borderRadius: 10 },
  pathText: { ...TEXT.bodySmall, color: EDITORIAL.green, textAlign: 'center' },
  outcome: { backgroundColor: EDITORIAL.greenAccentTint },
  goalTypes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  goal: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  goalLabel: { ...TEXT.bodySmall, fontSize: 9, color: EDITORIAL.greenAccent },
});
