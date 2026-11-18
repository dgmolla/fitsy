import React from 'react';
import { Linking, StyleSheet, Text } from 'react-native';
import { EDITORIAL, TEXT } from '@/lib/brand';

// One short line plus a tappable source, nothing more (#970).
export function StudyNote({ text, sourceLabel, url, testID }: { text: string; sourceLabel: string; url: string; testID: string }) {
  return <Text style={s.note} testID={testID}>
    {text}{' '}
    <Text style={s.link} accessibilityRole="link" accessibilityLabel={`${sourceLabel}: open the study`} testID={`${testID}-source`}
      onPress={() => { void Linking.openURL(url); }}>{sourceLabel}</Text>
  </Text>;
}

const s = StyleSheet.create({
  note: { ...TEXT.bodySmall, fontSize: 12, lineHeight: 17, color: EDITORIAL.textMid },
  link: { color: EDITORIAL.greenAccent, textDecorationLine: 'underline' },
});
