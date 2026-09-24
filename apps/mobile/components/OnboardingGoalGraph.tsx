import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Circle } from 'react-native-svg';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { onboardingGoalStory } from '@/lib/onboardingPersonalization';

export function OnboardingGoalGraph({ goal }: { goal?: string }) {
  const story = onboardingGoalStory(goal);
  return <View style={s.card} testID="goal-progress-graph">
    <Text style={s.eyebrow}>YOUR ROUTINE OVER TIME</Text>
    <Text style={s.title}>{story.label}</Text>
    <View accessible accessibilityRole="image" accessibilityLabel={`Illustrative ${story.label.toLowerCase()} over time. A solid line represents a steadier routine with Fitsy. A dashed line represents a more variable routine without Fitsy. These are conceptual paths, not measured results or a forecast.`}>
      <View style={s.axisLabel}><Text style={s.axis}>More consistent</Text></View>
      <Svg width="100%" height={170} viewBox="0 0 300 170" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Line x1="8" y1="150" x2="290" y2="150" stroke={EDITORIAL.border} />
        <Line x1="8" y1="95" x2="290" y2="95" stroke={EDITORIAL.border} strokeDasharray="3 5" />
        <Line x1="8" y1="40" x2="290" y2="40" stroke={EDITORIAL.border} strokeDasharray="3 5" />
        <Path d="M 12 132 C 38 128, 43 99, 69 111 S 102 91, 127 112 S 162 88, 189 104 S 225 88, 248 103 S 272 84, 286 92" fill="none" stroke={EDITORIAL.textSoft} strokeWidth="2.5" strokeDasharray="5 6" />
        <Path d="M 12 132 C 42 128, 45 109, 72 106 S 99 88, 127 78 S 166 83, 190 62 S 241 53, 286 26" fill="none" stroke={EDITORIAL.greenAccent} strokeWidth="3.5" strokeLinecap="round" />
        <Circle cx="12" cy="132" r="4" fill={EDITORIAL.greenAccent} />
        <Circle cx="286" cy="26" r="5" fill={EDITORIAL.greenAccent} />
      </Svg>
      <View style={s.axisLabels}><Text style={s.axis}>Starting point</Text><Text style={s.axis}>Over time</Text></View>
    </View>
    <View style={s.legend}><View style={s.legendItem}><View style={s.solid} /><Text style={s.legendText}>With Fitsy</Text></View><View style={s.legendItem}><View style={s.dashed} /><Text style={s.legendText}>Without Fitsy</Text></View></View>
    <Text style={s.habit}>{story.habit}, repeated over time.</Text>
    <Text style={s.disclaimer}>Illustration only, not measured results. Progress depends on nutrition, training and consistency.</Text>
  </View>;
}
const s = StyleSheet.create({
  card: { padding: 20, borderRadius: 24, backgroundColor: EDITORIAL.creamCard, gap: 16 },
  eyebrow: { ...TEXT.caption, fontSize: 10, color: EDITORIAL.greenAccent },
  title: { ...TEXT.body, color: EDITORIAL.green },
  axisLabel: { marginBottom: 4 },
  axis: { ...TEXT.bodySmall, fontSize: 11, color: EDITORIAL.textMid },
  axisLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  legendText: { ...TEXT.bodySmall, fontSize: 12 },
  solid: { width: 20, height: 3, borderRadius: 2, backgroundColor: EDITORIAL.greenAccent },
  dashed: { width: 20, height: 0, borderTopWidth: 2, borderStyle: 'dashed', borderColor: EDITORIAL.textSoft },
  habit: { ...TEXT.bodySmall, color: EDITORIAL.greenAccent },
  disclaimer: { ...TEXT.bodySmall, fontSize: 11, lineHeight: 16, color: EDITORIAL.textMid },
});
