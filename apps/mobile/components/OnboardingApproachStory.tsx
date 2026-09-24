import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, TEXT } from '@/lib/brand';
import type { TriedApproach } from '@/lib/onboardingPersonalization';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
export function StoryIcon({ name, size = 24 }: { name: IconName; size?: number }) {
  return <Ionicons name={name} size={size} color={EDITORIAL.greenAccent} accessibilityElementsHidden />;
}
export function StoryNote({ children }: { children: React.ReactNode }) {
  return <Text style={storyStyles.note}>{children}</Text>;
}
export function StoryMeal({ compact = false }: { compact?: boolean }) {
  return <View style={storyStyles.meal}>
    <Image source={require('@/assets/dishes/01.jpg')} style={compact ? storyStyles.smallPhoto : storyStyles.photo} accessibilityLabel="Illustrative restaurant bowl" />
    <View style={storyStyles.mealCopy}><Text style={storyStyles.eyebrow}>A RESTAURANT OPTION</Text><Text style={storyStyles.title}>Restaurant bowl</Text><Text style={storyStyles.note}>Calories · Protein · Source</Text></View>
  </View>;
}

export function OnboardingApproachStory({ approach }: { approach: TriedApproach }) {
  if (approach === 'check_online') return <View style={storyStyles.canvas} testID="story-check_online">
    <Text style={storyStyles.eyebrow}>YOUR RESEARCH, BROUGHT TOGETHER</Text>
    <View style={storyStyles.tabs}>{['Restaurant menu', 'Nutrition page', 'Another search'].map((label, i) =>
      <View key={label} style={[storyStyles.paper, i === 1 && storyStyles.middlePaper]}><StoryIcon name={i === 1 ? 'reader-outline' : 'globe-outline'} /><Text style={storyStyles.tabText}>{label}</Text><View style={storyStyles.line} /><View style={storyStyles.shortLine} /></View>)}</View>
    <View style={storyStyles.center}><StoryIcon name="arrow-down" /></View>
    <View style={storyStyles.card}><View style={storyStyles.row}><StoryIcon name="layers-outline" /><Text style={storyStyles.title}>One place to compare</Text></View><StoryNote>Restaurant dishes, macros and sources.</StoryNote></View>
  </View>;
  if (approach === 'calorie_apps') return <View style={storyStyles.canvas} testID="story-calorie_apps">
    <Text style={storyStyles.eyebrow}>RECOGNIZE THIS SEARCH?</Text>
    <View style={storyStyles.card}><View style={storyStyles.search}><StoryIcon name="search-outline" size={19} /><Text style={storyStyles.note}>That bowl from lunch…</Text></View>
      <View style={storyStyles.empty}><StoryIcon name="help-circle-outline" size={44} /><Text style={storyStyles.title}>Which entry is my dish?</Text><StoryNote>A generic result may not tell the whole story.</StoryNote></View></View>
    <View style={storyStyles.row}><StoryIcon name="restaurant-outline" /><StoryNote>Start with the restaurant and its menu.</StoryNote></View>
  </View>;
  if (approach === 'meal_prep') return <View style={storyStyles.canvas} testID="story-meal_prep">
    <Text style={storyStyles.eyebrow}>SOME DAYS GO TO PLAN</Text>
    <View style={storyStyles.week}>{['MON', 'TUE', 'WED'].map(day => <View key={day} style={storyStyles.day}><Text style={storyStyles.eyebrow}>{day}</Text><StoryIcon name="file-tray-full-outline" size={30} /><Text style={storyStyles.note}>Prepped</Text></View>)}</View>
    <View style={storyStyles.invite}><StoryIcon name="chatbubble-ellipses-outline" /><View style={storyStyles.mealCopy}><Text style={storyStyles.title}>“Dinner out tonight?”</Text><StoryNote>There’s a plan for that, too.</StoryNote></View></View>
    <StoryMeal compact />
  </View>;
  return <View style={storyStyles.canvas} testID="story-nothing">
    <Text style={storyStyles.eyebrow}>START WITH WHAT SOUNDS GOOD</Text>
    <View style={storyStyles.cravings}>{([['🥙', 'Something fresh'], ['🍜', 'Something cozy'], ['🌮', 'Something fun'], ['🍲', 'Something filling']] as const).map(([emoji, label]) =>
      <View style={storyStyles.craving} key={label}><Text style={storyStyles.emoji}>{emoji}</Text><Text style={storyStyles.tabText}>{label}</Text></View>)}</View>
    <View style={storyStyles.row}><StoryIcon name="compass-outline" /><StoryNote>A craving is all you need to begin.</StoryNote></View>
  </View>;
}

export const storyStyles = StyleSheet.create({
  canvas: { backgroundColor: EDITORIAL.creamCard, borderRadius: 24, padding: 18, gap: 18 },
  card: { backgroundColor: EDITORIAL.cream, borderRadius: 18, padding: 16, gap: 12 },
  eyebrow: { ...TEXT.caption, color: EDITORIAL.greenAccent, fontSize: 10 },
  title: { ...TEXT.body, color: EDITORIAL.green },
  note: { ...TEXT.bodySmall, color: EDITORIAL.textMid, flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  center: { alignItems: 'center' },
  tabs: { flexDirection: 'row', gap: 6, paddingTop: 8 },
  paper: { flex: 1, backgroundColor: EDITORIAL.cream, borderRadius: 12, padding: 10, gap: 12 },
  middlePaper: { marginTop: 12 },
  tabText: { ...TEXT.bodySmall, fontSize: 12, color: EDITORIAL.green },
  line: { height: 4, backgroundColor: EDITORIAL.creamDeep, borderRadius: 2 },
  shortLine: { height: 4, width: '65%', backgroundColor: EDITORIAL.creamDeep, borderRadius: 2 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, backgroundColor: EDITORIAL.creamCard },
  empty: { paddingVertical: 18, gap: 12, alignItems: 'center' },
  week: { flexDirection: 'row', gap: 8 },
  day: { flex: 1, alignItems: 'center', gap: 12, paddingVertical: 14, backgroundColor: EDITORIAL.cream, borderRadius: 14 },
  invite: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  meal: { overflow: 'hidden', borderRadius: 16, backgroundColor: EDITORIAL.cream },
  photo: { width: '100%', height: 130, resizeMode: 'cover' },
  smallPhoto: { width: '100%', height: 94, resizeMode: 'cover' },
  mealCopy: { flex: 1, padding: 12, gap: 5 },
  cravings: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  craving: { width: '47%', gap: 8, padding: 14, backgroundColor: EDITORIAL.cream, borderRadius: 16 },
  emoji: { fontSize: 28 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { ...TEXT.bodySmall, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, color: EDITORIAL.green, backgroundColor: EDITORIAL.greenAccentTint },
});
