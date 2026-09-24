import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { onboardingPitch } from '@/lib/onboardingPersonalization';
import { StoryIcon, StoryMeal, StoryNote, storyStyles as s } from './OnboardingApproachStory';

type Pitch = ReturnType<typeof onboardingPitch>;
export function OnboardingFitnessPayoff({ pitch }: { pitch: Pitch }) {
  if (pitch.approach === 'check_online') return <View style={s.canvas} testID="payoff-check_online">
    <Text style={s.eyebrow}>YOUR SHORTLIST STARTS HERE</Text>
    <View style={s.card}><View style={s.row}><StoryIcon name="options-outline" /><Text style={s.title}>Your meal targets</Text></View><View style={s.chips}><Text style={s.chip}>Calorie range</Text><Text style={s.chip}>Protein target</Text></View></View>
    <View style={s.center}><StoryIcon name="swap-vertical-outline" size={32} /></View>
    <StoryMeal compact /><StoryNote>Collected nutrition. Choices ranked around your targets.</StoryNote>
  </View>;
  if (pitch.approach === 'calorie_apps') return <View style={s.canvas} testID="payoff-calorie_apps">
    <Text style={s.eyebrow}>THE DISH, WITH MORE CONTEXT</Text><StoryMeal />
    <View style={local.details}>{([['flame-outline', 'Calories', 'See the meal’s energy'], ['barbell-outline', 'Protein', 'Compare with your target'], ['reader-outline', 'Nutrition source', 'Published or estimated']] as const).map(([icon, title, body]) =>
      <View key={title} style={s.row}><StoryIcon name={icon} size={20} /><View><Text style={s.title}>{title}</Text><StoryNote>{body}</StoryNote></View></View>)}</View>
    <StoryNote>Estimates are labeled so you know what’s behind the numbers.</StoryNote>
  </View>;
  if (pitch.approach === 'meal_prep') return <View style={s.canvas} testID="payoff-meal_prep">
    <Text style={s.eyebrow}>ONE PLAN. ROOM FOR BOTH.</Text>
    <View style={local.paths}><View style={local.path}><StoryIcon name="home-outline" size={32} /><Text style={s.title}>A meal at home</Text><StoryNote>Your prep routine</StoryNote></View>
      <View style={local.path}><StoryIcon name="restaurant-outline" size={32} /><Text style={s.title}>A meal out</Text><StoryNote>Your nearby options</StoryNote></View></View>
    <View style={local.connector}><View style={local.branch} /><View style={local.stem} /></View>
    <View style={s.card}><View style={s.row}><StoryIcon name="locate-outline" /><Text style={s.title}>The same meal targets</Text></View><StoryNote>Calories and protein, wherever you eat.</StoryNote></View>
    <Text style={local.closing}>Your routine can have a little flexibility.</Text>
  </View>;
  return <View style={s.canvas} testID="payoff-nothing">
    <Text style={s.eyebrow}>NO PERFECT ROUTINE REQUIRED</Text>
    {([['1', 'Set a starting point', 'Get help with meal targets you can edit.'], ['2', 'Find something nearby', 'Explore restaurant dishes around you.'], ['3', 'Choose your next meal', 'See the nutrition before you order.']] as const).map(([step, title, note]) =>
      <View style={s.card} key={step}><View style={s.row}><Text style={local.number}>{step}</Text><View style={local.step}><Text style={s.title}>{title}</Text><StoryNote>{note}</StoryNote></View></View></View>)}
    <StoryNote>Start small. Make it your own as you go.</StoryNote>
  </View>;
}
const local = StyleSheet.create({
  details: { gap: 16, paddingHorizontal: 4 },
  paths: { flexDirection: 'row', gap: 10 },
  path: { flex: 1, gap: 10, padding: 14, borderRadius: 16, backgroundColor: EDITORIAL.cream },
  connector: { alignItems: 'center', marginVertical: -10 },
  branch: { width: '54%', height: 16, borderBottomWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: EDITORIAL.greenAccent },
  stem: { width: 1, height: 16, backgroundColor: EDITORIAL.greenAccent },
  closing: { ...TEXT.bodySmall, textAlign: 'center', color: EDITORIAL.greenAccent },
  number: { ...TEXT.title, fontSize: 22, width: 34, color: EDITORIAL.greenAccent },
  step: { flex: 1, gap: 5 },
});
