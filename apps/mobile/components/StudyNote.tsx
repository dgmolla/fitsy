import React from 'react';
import { Linking, StyleSheet, Text } from 'react-native';
import { EDITORIAL, TEXT } from '@/lib/brand';

// One short line plus tappable sources, nothing more (#970).
export function StudyNote({ text, sources, testID }: { text: string; sources: readonly { label: string; url: string }[]; testID: string }) {
  return <Text style={s.note} testID={testID}>
    {text}{' '}
    {sources.map((source, index) => <React.Fragment key={source.url}>
      {index > 0 ? ' · ' : ''}
      <Text style={s.link} accessibilityRole="link" accessibilityLabel={`${source.label}: open the study`} testID={`${testID}-${index}`}
        onPress={() => { void Linking.openURL(source.url); }}>{source.label}</Text>
    </React.Fragment>)}
  </Text>;
}

const s = StyleSheet.create({
  note: { ...TEXT.bodySmall, fontSize: 12, lineHeight: 17, color: EDITORIAL.textMid },
  link: { color: EDITORIAL.greenAccent, textDecorationLine: 'underline' },
});
