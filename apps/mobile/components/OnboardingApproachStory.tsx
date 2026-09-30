import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { EDITORIAL, TEXT } from '@/lib/brand';
import type { TriedApproach } from '@/lib/onboardingPersonalization';

const STORIES = {
  check_online: {
    eyebrow: 'LESS MENU-TO-MENU SEARCHING',
    items: [['📋', 'Restaurant menus'], ['🔍', 'Macro searches'], ['🥗', 'Meals nearby'], ['📊', 'Nutrition in view']],
  },
  calorie_apps: {
    eyebrow: "WHEN THE APP CAN'T FIND YOUR DISH",
    items: [['📱', 'Your tracker'], ['🤔', 'Which entry?'], ['🍜', 'The actual dish'], ['📊', 'Nutrition in view']],
  },
  meal_prep: {
    eyebrow: 'ROOM FOR A NIGHT OUT',
    items: [['🥘', 'Meals at home'], ['🍕', 'Dinner out']],
    note: 'Your meal targets can come with you.',
  },
  nothing: {
    eyebrow: 'START WITH WHAT SOUNDS GOOD',
    items: [['🥙', 'Something fresh'], ['🍜', 'Something cozy'], ['🌮', 'Something fun'], ['🍲', 'Something filling']],
    note: 'A craving is all you need to begin.',
  },
} as const;

export function OnboardingApproachStory({ approach }: { approach: TriedApproach }) {
  const story = STORIES[approach];
  return <View style={styles.canvas} testID={`story-${approach}`}>
    <Text style={styles.eyebrow}>{story.eyebrow}</Text>
    <View style={styles.items}>{story.items.map(([emoji, label]) =>
      <View style={styles.item} key={label}><Text style={styles.emoji}>{emoji}</Text><Text style={styles.label}>{label}</Text></View>)}</View>
    {'note' in story && <Text style={styles.note}>{story.note}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  canvas: { backgroundColor: EDITORIAL.creamCard, borderRadius: 24, padding: 18, gap: 18 },
  eyebrow: { ...TEXT.caption, color: EDITORIAL.greenAccent, fontSize: 10 },
  items: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  item: { width: '47%', gap: 8, padding: 14, backgroundColor: EDITORIAL.cream, borderRadius: 16 },
  emoji: { fontSize: 28 },
  label: { ...TEXT.bodySmall, fontSize: 12, color: EDITORIAL.green },
  note: { ...TEXT.bodySmall, color: EDITORIAL.textMid },
});
