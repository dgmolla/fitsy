import React from 'react';
import { StyleSheet, View } from 'react-native';

interface Props {
  current: number;
  total: number;
}

export function ProgressDots({ current, total }: Props) {
  return (
    <View style={styles.container}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[styles.dot, i + 1 === current ? styles.dotFilled : styles.dotEmpty]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotFilled: {
    backgroundColor: '#2D7D46',
  },
  dotEmpty: {
    backgroundColor: '#D1D5DB',
  },
});
